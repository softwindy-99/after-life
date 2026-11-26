import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = process.argv.includes('--built');
const startCommand = process.argv.includes('--pro') ? 'start:pro' : 'start';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const backendReadyMessage = 'Server running at port';
const backendStartupTimeoutMs = 60_000;
const processes = new Set();

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of processes) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message);
    }
  }

  process.exit(code);
}

function trackProcess(child) {
  processes.add(child);

  child.on('exit', (code) => {
    processes.delete(child);
    if (!shuttingDown) shutdown(code ?? 1);
  });

  child.on('error', (error) => {
    console.error(`[dev] Failed to start a child process: ${error.message}`);
    if (!shuttingDown) shutdown(1);
  });

  return child;
}

function waitForBackend(backend) {
  return new Promise((resolve, reject) => {
    let outputTail = '';
    let settled = false;

    const timeout = setTimeout(() => {
      finish(new Error('API did not become ready within 60 seconds.'));
    }, backendStartupTimeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      backend.stdout.off('data', inspectOutput);
      backend.stderr.off('data', inspectOutput);
      backend.off('exit', handleExit);
      backend.off('error', finish);

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    function inspectOutput(chunk) {
      if (settled) return;
      outputTail = `${outputTail}${chunk.toString()}`.slice(-backendReadyMessage.length * 2);
      if (outputTail.includes(backendReadyMessage)) finish();
    }

    function handleExit(code) {
      finish(new Error(`API process exited before it became ready (code ${code ?? 'unknown'}).`));
    }

    backend.stdout.on('data', inspectOutput);
    backend.stderr.on('data', inspectOutput);
    backend.once('exit', handleExit);
    backend.once('error', finish);
  });
}

async function main() {
  if (
    built &&
    ['backend/dist/main.js', 'frontend/dist/index.html'].some(
      (path) => !existsSync(new URL(`../${path}`, import.meta.url)),
    )
  ) {
    throw new Error('Build both applications with npm run build before npm start.');
  }
  const backend = trackProcess(
    spawn(npmCommand, ['--prefix', 'backend', 'run', built ? startCommand : 'dev'], {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: ['inherit', 'pipe', 'pipe'],
    }),
  );

  backend.stdout.pipe(process.stdout, { end: false });
  backend.stderr.pipe(process.stderr, { end: false });

  // Wait for the API, rather than a fixed delay, so the first setup request is reliable.
  await waitForBackend(backend);
  if (built || shuttingDown) return;

  console.log('[dev] API is ready. Starting the frontend...');
  trackProcess(
    spawn(npmCommand, ['--prefix', 'frontend', 'run', 'dev'], {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
    }),
  );
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

void main().catch((error) => {
  if (shuttingDown) return;
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
