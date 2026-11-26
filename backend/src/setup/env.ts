import { randomBytes } from 'crypto';
import {
  chmodSync,
  statSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  realpathSync,
} from 'fs';
import { join } from 'path';
import { parse } from 'dotenv';
import webPush = require('web-push');

export type EnvMap = Record<string, string>;

export const rootDir = join(__dirname, '..', '..', '..');
export function getEnvPath(): string {
  return join(rootDir, '.env');
}

export const envExamplePath = join(rootDir, '.env.example');
let runtimeConfigured = false;

export function setRuntimeConfigured(ready: boolean): void {
  runtimeConfigured = ready;
}

export function isRuntimeConfigured(): boolean {
  return runtimeConfigured;
}

export const requiredEnvKeys = [
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'INIT_ADMIN_USERNAME',
  'INIT_ADMIN_EMAIL',
  'INIT_ADMIN_PASSWORD',
] as const;

export const generatedEnvKeys = [
  'JWT_SECRET',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_PRIVATE_KEY',
] as const;

export const runtimeRequiredKeys = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
] as const;

const runtimeManagedKeys = [
  ...runtimeRequiredKeys,
  'PORT',
  'INIT_ADMIN_USERNAME',
  'INIT_ADMIN_EMAIL',
  'INIT_ADMIN_PASSWORD',
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',
  'MAIL_SECURE',
  'WEB_PUSH_PUBLIC_KEY',
  'WEB_PUSH_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'WEB_PUSH_PROXY',
  'HTTPS_PROXY',
  'https_proxy',
  'MCP_ALLOWED_ORIGINS',
  'PUBLIC_BASE_URL',
  'RESOURCE_STORAGE_DIR',
  'RESOURCE_STORAGE_DRIVER',
  'RESOURCE_STORAGE_ENDPOINT',
  'RESOURCE_STORAGE_REGION',
  'RESOURCE_STORAGE_BUCKET',
  'RESOURCE_STORAGE_PREFIX',
  'RESOURCE_STORAGE_FORCE_PATH_STYLE',
  'RESOURCE_STORAGE_ACCESS_KEY_ID',
  'RESOURCE_STORAGE_ACCESS_KEY_SECRET',
  'DELIVERED_LETTER_RETENTION_DAYS',
  'LETTER_STATUS_CHECK_INTERVAL_MS',
  'NOTIFICATION_CHECK_INTERVAL_MS',
  'SERVER_VERSION',
  'SUPPORTED_CLIENT_VERSION_MIN',
  'SUPPORTED_CLIENT_VERSION_MAX',
] as const;

export const optionalMailEnvKeys = [
  'MAIL_HOST',
  'MAIL_PORT',
  'MAIL_USER',
  'MAIL_PASSWORD',
  'MAIL_FROM',
  'MAIL_SECURE',
] as const;

export const setupEnvKeys = [
  ...requiredEnvKeys,
  ...generatedEnvKeys,
  ...optionalMailEnvKeys,
] as const;

export const defaultEnv: EnvMap = {
  PORT: '3000',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'root',
  DB_PASSWORD: '',
  DB_NAME: 'after_life',
  JWT_SECRET: randomBytes(32).toString('hex'),
  ...createWebPushEnv(),
  MAIL_HOST: '',
  MAIL_PORT: '',
  MAIL_USER: '',
  MAIL_PASSWORD: '',
  MAIL_FROM: '',
  MAIL_SECURE: 'false',
  INIT_ADMIN_USERNAME: 'Admin',
  INIT_ADMIN_EMAIL: 'admin@example.com',
  INIT_ADMIN_PASSWORD: '',
};

function createWebPushEnv(): EnvMap {
  const keys = webPush.generateVAPIDKeys();
  return {
    WEB_PUSH_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_PRIVATE_KEY: keys.privateKey,
  };
}

export function parseEnv(content: string): EnvMap {
  return parse(content);
}

export function readEnvFile(path = getEnvPath()): EnvMap {
  if (!existsSync(path)) return {};
  const values = parseEnv(readFileSync(path, 'utf8'));
  delete values.APP_ENV;
  delete values.NODE_ENV;
  return values;
}

export function hasEnvFile(): boolean {
  return existsSync(getEnvPath());
}

export function readExampleEnv(): EnvMap {
  if (!existsSync(envExamplePath)) return {};
  return parseEnv(readFileSync(envExamplePath, 'utf8'));
}

export function getEnvTemplate(): EnvMap {
  const exampleEnv = readExampleEnv();
  const webPushEnv = createWebPushEnv();
  return {
    ...defaultEnv,
    ...exampleEnv,
    DB_PASSWORD: '',
    MAIL_PASSWORD: '',
    INIT_ADMIN_PASSWORD: '',
    JWT_SECRET:
      exampleEnv.JWT_SECRET && exampleEnv.JWT_SECRET !== 'secret'
        ? exampleEnv.JWT_SECRET
        : randomBytes(32).toString('hex'),
    WEB_PUSH_PUBLIC_KEY: exampleEnv.WEB_PUSH_PUBLIC_KEY || webPushEnv.WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY: exampleEnv.WEB_PUSH_PRIVATE_KEY || webPushEnv.WEB_PUSH_PRIVATE_KEY,
  };
}

export function loadEnvIntoProcess(): EnvMap {
  const env = readEnvFile();
  applyRuntimeEnvToProcess(env);
  return env;
}

export function applyEnvUpdates(env: EnvMap): void {
  for (const key of runtimeManagedKeys) {
    if (Object.prototype.hasOwnProperty.call(env, key)) process.env[key] = env[key];
  }
}

export function applyRuntimeEnvToProcess(env: EnvMap): void {
  for (const key of runtimeManagedKeys) {
    if (!(key in env)) delete process.env[key];
  }
  applyEnvUpdates(env);
}

export function getMissingEnvKeys(env: EnvMap): string[] {
  return requiredEnvKeys.filter((key) => {
    const value = env[key]?.trim();
    return !value;
  });
}

export function getMissingRuntimeKeys(env: EnvMap): string[] {
  return runtimeRequiredKeys.filter((key) => !env[key]?.trim());
}

export function isEnvReady(env = readEnvFile()): boolean {
  return getMissingEnvKeys(env).length === 0;
}

export function serializeEnv(env: EnvMap): string {
  const groups = [
    ['PORT'],
    ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'],
    [
      'JWT_SECRET',
      'WEB_PUSH_PUBLIC_KEY',
      'WEB_PUSH_PRIVATE_KEY',
      'WEB_PUSH_SUBJECT',
      'WEB_PUSH_PROXY',
    ],
    ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD'],
    ['INIT_ADMIN_USERNAME', 'INIT_ADMIN_EMAIL', 'INIT_ADMIN_PASSWORD'],
  ];

  const groupedKeys = new Set(groups.flat());
  const groupedContent = groups
    .map((keys) => keys.map((key) => `${key}=${serializeValue(env[key] ?? '')}`).join('\n'))
    .join('\n\n');
  const extraContent = Object.keys(env)
    .filter((key) => !groupedKeys.has(key))
    .sort()
    .map((key) => `${key}=${serializeValue(env[key] ?? '')}`)
    .join('\n');

  return `${[groupedContent, extraContent].filter(Boolean).join('\n\n')}\n`;
}

function serializeValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error('Environment values must not contain line breaks.');
  if (!/[\s#'"`]/.test(value)) return value;
  const quote = ["'", '`', '"'].find(
    (candidate) => !value.includes(candidate) && (candidate !== '"' || !/\\[nr]/.test(value)),
  );
  if (!quote) throw new Error('Environment value cannot be safely quoted.');
  return `${quote}${value}${quote}`;
}

export function writeEnvFile(env: EnvMap, selectedPath = getEnvPath()): void {
  const path = existsSync(selectedPath) ? realpathSync(selectedPath) : selectedPath;
  const nextEnv = { ...readEnvFile(selectedPath), ...env };
  replaceEnvFile(path, serializeEnv(nextEnv));
}

export function completeStartupEnv(
  selectedPath = getEnvPath(),
  examplePath = envExamplePath,
  defaults: EnvMap = {},
): void {
  const example = parseEnv(readFileSync(examplePath, 'utf8'));
  const exists = existsSync(selectedPath);
  const path = exists ? realpathSync(selectedPath) : selectedPath;
  const content = exists ? readFileSync(path, 'utf8') : '';
  const current = parseEnv(content);
  const additions = Object.entries(example)
    .filter(
      ([key]) =>
        key !== 'APP_ENV' &&
        key !== 'NODE_ENV' &&
        !Object.prototype.hasOwnProperty.call(current, key),
    )
    .map(([key, fallback]) => `${key}=${serializeValue(defaults[key] ?? fallback)}`);

  if (additions.length || !exists) {
    const separator = content && !content.endsWith('\n') ? '\n' : '';
    replaceEnvFile(path, content + separator + additions.join('\n') + '\n');
  } else if ((statSync(path).mode & 0o777) !== 0o600) {
    chmodSync(path, 0o600);
  }
}

function replaceEnvFile(path: string, content: string): void {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
