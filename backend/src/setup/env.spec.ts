import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  completeStartupEnv,
  getEnvPath,
  rootDir,
  readEnvFile,
  writeEnvFile,
  parseEnv,
  serializeEnv,
  applyRuntimeEnvToProcess,
  defaultEnv,
  getMissingEnvKeys,
  requiredEnvKeys,
} from './env';

describe('setup env helpers', () => {
  it('does not ship reusable default passwords', () => {
    expect(defaultEnv.DB_PASSWORD).toBe('');
    expect(defaultEnv.INIT_ADMIN_PASSWORD).toBe('');
  });
  it('does not require mail settings during setup', () => {
    const env = Object.fromEntries(
      requiredEnvKeys.map((key) => [key, defaultEnv[key] || `${key}_value`]),
    );

    expect(getMissingEnvKeys(env)).toEqual([]);
  });

  it('still reports missing core setup values', () => {
    expect(
      getMissingEnvKeys({
        ...defaultEnv,
        DB_PASSWORD: 'database-test-password',
        INIT_ADMIN_PASSWORD: 'new-admin-password',
        DB_HOST: '',
        MAIL_HOST: '',
        MAIL_PORT: '',
        MAIL_USER: '',
        MAIL_PASSWORD: '',
      }),
    ).toEqual(['DB_HOST']);
  });

  it('does not require users to provide JWT secret during setup', () => {
    expect(
      getMissingEnvKeys({
        ...defaultEnv,
        DB_PASSWORD: 'database-test-password',
        INIT_ADMIN_PASSWORD: 'new-admin-password',
        JWT_SECRET: '',
      }),
    ).toEqual([]);
  });

  it('provides generated Web Push keys without making them required setup input', () => {
    expect(defaultEnv.WEB_PUSH_PUBLIC_KEY).toBeTruthy();
    expect(defaultEnv.WEB_PUSH_PRIVATE_KEY).toBeTruthy();
    expect(
      getMissingEnvKeys({
        ...defaultEnv,
        DB_PASSWORD: 'database-test-password',
        INIT_ADMIN_PASSWORD: 'new-admin-password',
        WEB_PUSH_PUBLIC_KEY: '',
      }),
    ).toEqual([]);
  });

  it('clears stale settings omitted after configuration reload', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv, MAIL_HOST: 'unexpected-process-host' };
    try {
      applyRuntimeEnvToProcess({ DB_HOST: 'file-host' });
      expect(process.env.MAIL_HOST).toBeUndefined();
      expect(process.env.DB_HOST).toBe('file-host');
    } finally {
      process.env = originalEnv;
    }
  });
});

describe('environment files', () => {
  const originalEnv = process.env;
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'afterlife-env-'));
  });
  afterEach(() => {
    process.env = originalEnv;
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(['dev', 'test', 'pro', 'unknown'])('uses root .env in %s mode', (mode) => {
    process.env = { ...originalEnv, APP_ENV: mode, NODE_ENV: mode };
    expect(getEnvPath()).toBe(join(rootDir, '.env'));
  });

  it('round-trips quotes, spaces, hashes and equals signs without corrupting credentials', () => {
    const values = {
      DB_PASSWORD: 'hash# and=spaces',
      MAIL_PASSWORD: 'a"quote',
      JWT_SECRET: "it's#secret",
      WEB_PUSH_PROXY: String.raw`http://example/path\n#literal`,
    };
    expect(parseEnv(serializeEnv(values))).toMatchObject(values);
    expect(() => serializeEnv({ MAIL_PASSWORD: 'injected\nOTHER=value' })).toThrow('line breaks');
  });

  it('isolates environment files and preserves existing settings on updates', () => {
    const dev = join(directory, '.env.dev');
    const pro = join(directory, '.env');
    writeEnvFile({ DB_HOST: 'dev-host', MAIL_FROM: 'owner@example.com' }, dev);
    writeEnvFile({ DB_HOST: 'pro-host' }, pro);
    writeEnvFile({ MAIL_PASSWORD: 'secret#with spaces' }, dev);
    expect(readEnvFile(dev)).toMatchObject({
      DB_HOST: 'dev-host',
      MAIL_FROM: 'owner@example.com',
      MAIL_PASSWORD: 'secret#with spaces',
    });
    expect(readEnvFile(pro)).toMatchObject({ DB_HOST: 'pro-host' });
    expect(statSync(dev).mode & 0o777).toBe(0o600);
    writeFileSync(
      join(directory, '.env.test'),
      'APP_ENV=pro\nNODE_ENV=production\nDB_HOST=test-host\n',
    );
    expect(readEnvFile(join(directory, '.env.test'))).toEqual({ DB_HOST: 'test-host' });
    expect(readEnvFile(join(directory, '.env.missing'))).toEqual({});
  });

  it('creates the selected file from the example independently of process values', () => {
    const path = join(directory, '.env.test');
    const example = join(directory, '.env.example');
    writeFileSync(example, 'PORT=3000\nMAIL_FROM=default\nJWT_SECRET=\nAPP_ENV=dev\nNODE_ENV=test');
    process.env = { ...originalEnv, PORT: '4000', MAIL_FROM: '', JWT_SECRET: 'ambient' };
    completeStartupEnv(path, example);
    expect(parseEnv(readFileSync(path, 'utf8'))).toEqual({
      PORT: '3000',
      MAIL_FROM: 'default',
      JWT_SECRET: '',
    });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('adds new template keys through a volume link and skips subsequent writes', () => {
    const path = join(directory, '.env.test');
    const target = join(directory, 'mounted.env');
    const example = join(directory, '.env.example');
    const original = '# custom settings\nPORT=5000\nMAIL_HOST=\nCUSTOM=keep';
    writeFileSync(target, original);
    symlinkSync(target, path);
    writeFileSync(example, 'PORT=3000\nMAIL_HOST=smtp\nNEW_KEY=example\nOTHER=default');
    completeStartupEnv(path, example, { MAIL_HOST: 'override', NEW_KEY: 'container' });
    expect(readFileSync(target, 'utf8')).toBe(original + '\nNEW_KEY=container\nOTHER=default\n');
    const inode = statSync(target).ino;
    completeStartupEnv(path, example);
    expect(statSync(target).ino).toBe(inode);
    expect(readEnvFile(path).NEW_KEY).toBe('container');
  });

  it('updates a Docker volume through its symlink without replacing the link', () => {
    const target = join(directory, 'persisted.env');
    const link = join(directory, '.env');
    writeFileSync(target, 'DB_HOST=mysql\n');
    symlinkSync(target, link);
    writeEnvFile({ MAIL_HOST: 'smtp' }, link);
    expect(readEnvFile(target)).toMatchObject({ DB_HOST: 'mysql', MAIL_HOST: 'smtp' });
    expect(readFileSync(link, 'utf8')).toBe(readFileSync(target, 'utf8'));
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});
