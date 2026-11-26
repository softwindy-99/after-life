import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';

export const storageDrivers = ['local', 's3', 'oss'] as const;
export type StorageDriver = (typeof storageDrivers)[number];

const text = z
  .string()
  .trim()
  .max(2048)
  .regex(/^[^\r\n]*$/);
export const storageSettingsSchema = z
  .object({
    driver: z.enum(storageDrivers),
    endpoint: text.default(''),
    region: text.max(100).default(''),
    bucket: text.max(63).default(''),
    prefix: text.max(200).default('after-life'),
    forcePathStyle: z.boolean().default(true),
    accessKeyId: text.optional(),
    accessKeySecret: text.optional(),
  })
  .strict();

export type StorageSettings = z.infer<typeof storageSettingsSchema>;

export function readStorageSettings(env = process.env): StorageSettings {
  const parsed = storageSettingsSchema.safeParse({
    driver: env.RESOURCE_STORAGE_DRIVER || 'local',
    endpoint: env.RESOURCE_STORAGE_ENDPOINT || '',
    region: env.RESOURCE_STORAGE_REGION || '',
    bucket: env.RESOURCE_STORAGE_BUCKET || '',
    prefix: env.RESOURCE_STORAGE_PREFIX ?? 'after-life',
    forcePathStyle: env.RESOURCE_STORAGE_FORCE_PATH_STYLE !== 'false',
    accessKeyId: env.RESOURCE_STORAGE_ACCESS_KEY_ID || '',
    accessKeySecret: env.RESOURCE_STORAGE_ACCESS_KEY_SECRET || '',
  });
  if (!parsed.success) throw new BadRequestException('Invalid storage configuration');
  return parsed.data;
}

export function validateStorageSettings(settings: StorageSettings): void {
  if (
    !/^[a-zA-Z0-9/_-]*$/.test(settings.prefix) ||
    settings.prefix.startsWith('/') ||
    settings.prefix.endsWith('/')
  )
    throw new BadRequestException('Storage prefix must be a relative object key prefix');
  if (settings.driver === 'local' && !settings.endpoint) return;
  let endpoint: URL;
  try {
    endpoint = new URL(settings.endpoint);
  } catch {
    throw new BadRequestException('Storage endpoint must be an HTTP or HTTPS origin');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new BadRequestException('Storage endpoint must be an HTTP or HTTPS origin');
  if (settings.driver === 'local') return;
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(settings.bucket) ||
    !settings.region ||
    !settings.accessKeyId ||
    !settings.accessKeySecret
  )
    throw new BadRequestException('Storage bucket, region and access credentials are required');
}

export function storageTarget(settings: StorageSettings): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        settings.driver,
        settings.endpoint.replace(/\/$/, ''),
        settings.region,
        settings.bucket,
        settings.prefix,
        settings.driver === 's3' && settings.forcePathStyle,
      ]),
    )
    .digest('hex');
}
