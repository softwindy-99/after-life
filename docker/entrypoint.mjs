import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire('/app/backend/package.json');
const { createConnection } = require('mysql2/promise');
const { completeStartupEnv, readEnvFile } = require('/app/backend/dist/setup/env.js');
const dataDir = '/var/lib/mysql';
const appDir = '/var/lib/after-life';
const credentialsPath = `${appDir}/mysql.json`;
const configDir = '/etc/after-life';
const envPath = `${configDir}/.env`;
const socketPath = '/run/mysqld/mysqld.sock';
const children = [];
let stopping = false;
class StartupError extends Error {}

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  children.push(child);
  child.on('error', () => {
    console.error(`Unable to start ${command}.`);
    void shutdown(1);
  });
  child.on('exit', () => {
    if (!stopping) {
      console.error(`${command} stopped unexpectedly; shutting down the container.`);
      void shutdown(1);
    }
  });
  return child;
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  // Stop the web server before letting MySQL flush its data.
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
    await new Promise((resolve) => {
      const timer = setTimeout(
        () => child.kill('SIGKILL'),
        child.spawnfile === 'mysqld' ? 45000 : 5000,
      );
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
  process.exit(code);
}

function saveCredentials(credentials) {
  const temporary = `${credentialsPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, credentialsPath);
}

async function waitForMysql(credentials) {
  for (let attempt = 0; attempt < 90 && !stopping; attempt += 1) {
    // A first start may have stopped between setting the root password and saving
    // the provisioning marker. Retry both states only until provisioning completes.
    const passwords = credentials.provisioned ? [credentials.root] : [credentials.root, ''];
    for (const password of passwords) {
      try {
        return await createConnection({
          socketPath,
          user: 'root',
          password,
          connectTimeout: 1000,
        });
      } catch {
        // Driver errors can contain credentials; emit only a safe timeout below.
      }
    }
    await delay(1000);
  }
  throw new StartupError(
    'MySQL did not become ready. Check its startup log and the two data volumes.',
  );
}

async function main() {
  mkdirSync(appDir, { recursive: true });
  chownSync(appDir, 10001, 10001);
  chmodSync(appDir, 0o700);
  mkdirSync(`${appDir}/resources`, { recursive: true });
  chownSync(`${appDir}/resources`, 10001, 10001);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync('/run/mysqld', { recursive: true });
  execFileSync('chown', ['-R', 'mysql:mysql', dataDir, '/run/mysqld']);

  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chownSync(configDir, 10001, 10001);
  chmodSync(configDir, 0o700);
  const legacyEnv = [`${configDir}/.env.pro`, `${appDir}/.env.pro`, `${appDir}/config.env`].find(
    (path) => existsSync(path),
  );
  const initialized = existsSync(`${dataDir}/mysql`);
  let credentials;
  if (existsSync(credentialsPath)) {
    credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    if (
      !/^[a-f\d]{64}$/.test(credentials.root) ||
      !/^[a-f\d]{64}$/.test(credentials.password) ||
      typeof credentials.provisioned !== 'boolean'
    ) {
      throw new StartupError('Invalid MySQL credential file. Restore the matching data volumes.');
    }
    chmodSync(credentialsPath, 0o600);
  } else {
    if (readdirSync(dataDir).length || legacyEnv) {
      throw new StartupError(
        'Missing MySQL credentials for existing data. Restore both matching volumes.',
      );
    }
    credentials = {
      root: randomBytes(32).toString('hex'),
      password: randomBytes(32).toString('hex'),
      provisioned: false,
    };
    saveCredentials(credentials);
  }

  if (!initialized) {
    if (credentials.provisioned || readdirSync(dataDir).length) {
      throw new StartupError(
        'MySQL data is missing or incomplete. Restore both matching data volumes.',
      );
    }
    console.log('Initializing the bundled MySQL server...');
    execFileSync(
      'mysqld',
      ['--no-defaults', '--initialize-insecure', '--user=mysql', `--datadir=${dataDir}`],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    );
  }

  start('mysqld', [
    '--no-defaults',
    '--user=mysql',
    `--datadir=${dataDir}`,
    `--socket=${socketPath}`,
    '--pid-file=/run/mysqld/mysqld.pid',
    '--bind-address=127.0.0.1',
    '--port=3306',
    '--mysqlx=0',
    '--skip-name-resolve',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
  ]);
  const connection = await waitForMysql(credentials);
  try {
    if (!credentials.provisioned) {
      // Passwords are generated hexadecimal strings, never caller-supplied SQL.
      await connection.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${credentials.root}'`);
      await connection.query(
        'CREATE DATABASE IF NOT EXISTS after_life CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      );
      await connection.query(
        `CREATE USER IF NOT EXISTS 'after_life'@'127.0.0.1' IDENTIFIED BY '${credentials.password}'`,
      );
      await connection.query("GRANT ALL ON after_life.* TO 'after_life'@'127.0.0.1'");
      credentials.provisioned = true;
      saveCredentials(credentials);
    }
  } finally {
    await connection.end();
  }
  if (stopping) return;

  if (!existsSync(envPath)) {
    if (legacyEnv) {
      // The previous configuration may live on a different mount. Publish the complete copy before removing the old one.
      const temporary = `${envPath}.${randomBytes(8).toString('hex')}.tmp`;
      copyFileSync(legacyEnv, temporary);
      chmodSync(temporary, 0o600);
      renameSync(temporary, envPath);
      unlinkSync(legacyEnv);
    } else {
      writeFileSync(envPath, '', { mode: 0o600 });
    }
  }
  const connectionDefaults = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'after_life',
    DB_NAME: 'after_life',
  };
  const saved = readEnvFile(envPath);
  const usesBundledDatabase = Object.entries(connectionDefaults).every(
    ([key, value]) => saved[key] === undefined || saved[key] === value,
  );
  completeStartupEnv(envPath, '/app/.env.example', {
    ...connectionDefaults,
    DB_PASSWORD: usesBundledDatabase ? credentials.password : '',
    RESOURCE_STORAGE_DIR: `${appDir}/resources`,
  });
  chownSync(envPath, 10001, 10001);
  chmodSync(envPath, 0o600);

  start('node', ['dist/main.js'], {
    cwd: '/app/backend',
    uid: 10001,
    gid: 10001,
    env: { PATH: process.env.PATH, HOME: '/home/afterlife', NODE_ENV: 'production' },
  });
  console.log('After Life is starting. Complete installation in the web console.');
}

process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(0));
main().catch((error) => {
  // Never print driver errors, configuration objects or generated passwords.
  console.error(
    error instanceof StartupError
      ? error.message
      : 'Container startup failed. Check MySQL logs, volume permissions and matching backups.',
  );
  void shutdown(1);
});
