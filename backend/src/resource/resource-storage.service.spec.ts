import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { User } from 'src/user/user.entity';
import { createObjectStorage } from './object-storage';
import { ResourceStorageService } from './resource-storage.service';
import { readStorageSettings, storageTarget } from './storage-config';

jest.mock('./object-storage', () => ({
  ...jest.requireActual('./object-storage'),
  createObjectStorage: jest.fn(),
}));

describe('ResourceStorageService', () => {
  const originalEnv = { ...process.env };
  let directory: string;
  let service: ResourceStorageService;
  let object: Record<string, any>;
  let repository: Record<string, any>;
  let writer: { update: jest.Mock };
  let stored: Map<string, Buffer>;
  let client: { put: jest.Mock; open: jest.Mock; delete: jest.Mock; close: jest.Mock };

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'afterlife-storage-'));
    Object.assign(process.env, {
      RESOURCE_STORAGE_DIR: directory,
      RESOURCE_STORAGE_DRIVER: 's3',
      RESOURCE_STORAGE_ENDPOINT: 'http://minio.test:9000',
      RESOURCE_STORAGE_REGION: 'us-east-1',
      RESOURCE_STORAGE_BUCKET: 'private-files',
      RESOURCE_STORAGE_PREFIX: 'after-life',
      RESOURCE_STORAGE_FORCE_PATH_STYLE: 'true',
      RESOURCE_STORAGE_ACCESS_KEY_ID: 'test-id',
      RESOURCE_STORAGE_ACCESS_KEY_SECRET: 'test-secret',
    });
    object = { id: 1, uuid: 'file-1', storageDriver: 'local', storageTarget: null, sizeBytes: 4 };
    stored = new Map();
    client = {
      put: jest.fn(async (key, body) => {
        stored.set(key, body);
      }),
      open: jest.fn(async (key) => Readable.from([stored.get(key)])),
      delete: jest.fn(async (key) => {
        stored.delete(key);
      }),
      close: jest.fn(),
    };
    (createObjectStorage as jest.Mock).mockReturnValue(client);
    repository = {
      find: jest.fn(async () => [object]),
      findOne: jest.fn(async () => object),
      count: jest.fn(async () => (object.storageDriver === 'local' ? 1 : 0)),
      update: jest.fn(async (_id, values) => {
        Object.assign(object, values);
      }),
    };
    const manager: { query: jest.Mock; getRepository: jest.Mock; transaction: jest.Mock } = {
      query: jest.fn(async () => [
        { uuid: 'owner', iSdelete: 0 },
        { uuid: 'other', iSdelete: 0 },
      ]),
      getRepository: jest.fn((entity) =>
        entity === User ? { findOne: jest.fn(async () => ({ id: 1, uuid: 'owner' })) } : repository,
      ),
      transaction: jest.fn(async (...args) => args.at(-1)(manager)),
    };
    repository.manager = manager;
    writer = {
      update: jest.fn(async (values) => {
        Object.assign(process.env, values);
      }),
    };
    service = new ResourceStorageService(repository as any, writer as any);
    await fs.writeFile(join(directory, object.uuid), 'data');
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(directory, { recursive: true, force: true });
    jest.clearAllMocks();
  });

  it('verifies a copy before switching storage and retains the local source', async () => {
    expect(await service.migrate('owner')).toEqual({ migrated: 1, remaining: 0 });
    expect(object.storageDriver).toBe('s3');
    expect(stored.get('after-life/file-1').toString()).toBe('data');
    expect(await fs.readFile(join(directory, object.uuid), 'utf8')).toBe('data');
    const stream = await service.open(object as any);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('data');
    await service.migrate('owner');
    expect(client.put).toHaveBeenCalledTimes(1);
    await service.delete(object as any);
    expect(stored.size).toBe(0);
    await expect(fs.access(join(directory, object.uuid))).rejects.toBeDefined();
  });

  it('keeps the local location when verification fails, then allows retry', async () => {
    client.open.mockResolvedValueOnce(Readable.from(['bad!']));
    await expect(service.migrate('owner')).rejects.toBeInstanceOf(BadGatewayException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(object.storageDriver).toBe('local');
    await service.migrate('owner');
    expect(object.storageDriver).toBe('s3');
  });

  it('refuses a missing or truncated source without updating metadata', async () => {
    await fs.writeFile(join(directory, object.uuid), 'x');
    await expect(service.migrate('owner')).rejects.toBeInstanceOf(ConflictException);
    expect(client.put).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('rechecks the resource after acquiring locks so deleted resources are skipped', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.migrate('owner')).resolves.toMatchObject({ migrated: 0 });
    expect(client.put).not.toHaveBeenCalled();
  });

  it('rejects target changes while allowing credential rotation without exposing keys', async () => {
    object.storageDriver = 's3';
    object.storageTarget = storageTarget(readStorageSettings());
    await expect(
      service.configure('owner', { ...readStorageSettings(), bucket: 'other-bucket' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.manager.transaction).toHaveBeenCalledWith(
      'REPEATABLE READ',
      expect.any(Function),
    );
    expect(repository.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY id FOR UPDATE'),
    );
    expect(writer.update).not.toHaveBeenCalled();
    const status = await service.configure('owner', {
      ...readStorageSettings(),
      accessKeySecret: 'rotated-secret',
    });
    expect(status.credentialsConfigured).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret');
    expect(JSON.stringify(status)).not.toContain('test-id');
    expect(process.env.RESOURCE_STORAGE_ACCESS_KEY_SECRET).toBe('rotated-secret');
    process.env.RESOURCE_STORAGE_BUCKET = 'manual-wrong-target';
    await expect(service.open(object as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('tests write/read/delete and sanitizes SDK errors', async () => {
    await expect(service.test(readStorageSettings())).resolves.toEqual({ ok: true });
    expect(stored.size).toBe(0);
    client.open.mockRejectedValueOnce(new Error('Authorization: test-secret'));
    await expect(service.test(readStorageSettings())).rejects.toThrow(
      'External storage operation failed',
    );
    expect(stored.size).toBe(0);
  });

  it('scopes storage counts to the current principal', async () => {
    await service.status('owner');
    for (const [options] of repository.count.mock.calls)
      expect(options.where.user).toEqual({ uuid: 'owner' });
  });

  it.each([
    { driver: 'unknown' },
    { endpoint: 'https://user:password@storage.test' },
    { endpoint: 'file:///private' },
    { endpoint: 'https://storage.test/path' },
    { prefix: '../files' },
    { userUuid: 'other' },
  ])('rejects malformed settings before any network or config write: %j', async (payload) => {
    await expect(service.test({ ...readStorageSettings(), ...payload })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(client.put).not.toHaveBeenCalled();
    expect(writer.update).not.toHaveBeenCalled();
  });
});
