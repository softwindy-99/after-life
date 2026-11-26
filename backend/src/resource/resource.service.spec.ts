import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ResourceService } from './resource.service';
import { User } from 'src/user/user.entity';
import { Letter } from 'src/letter/letter.entity';
import { ResourceStorageService } from './resource-storage.service';

describe('ResourceService', () => {
  let directory: string;
  let service: ResourceService;
  let resource: Record<string, any>;
  let repository: Record<string, jest.Mock | object>;
  const previousSecret = process.env.JWT_SECRET;
  const previousDirectory = process.env.RESOURCE_STORAGE_DIR;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'afterlife-resource-'));
    process.env.RESOURCE_STORAGE_DIR = directory;
    process.env.JWT_SECRET = 'resource-test-secret';
    repository = {
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      })),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        resource = value;
        return value;
      }),
      findOne: jest.fn(async () => resource),
      find: jest.fn(async () => (resource ? [resource] : [])),
      remove: jest.fn(),
    };
    const manager: { getRepository: jest.Mock; transaction: jest.Mock } = {
      getRepository: jest.fn((entity) => {
        if (entity === User)
          return {
            findOne: jest.fn().mockResolvedValue({ id: 1, uuid: 'user-1', iSdelete: 0 }),
          };
        if (entity === Letter) return { find: jest.fn().mockResolvedValue([]) };
        return repository;
      }),
      transaction: jest.fn(async (work) => work(manager)),
    };
    repository.manager = manager;
    service = new ResourceService(
      repository as any,
      {
        findOne: jest.fn().mockResolvedValue({ id: 1, uuid: 'user-1', iSdelete: 0 }),
      } as any,
      new ResourceStorageService(repository as any, {} as any),
    );
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousDirectory === undefined) delete process.env.RESOURCE_STORAGE_DIR;
    else process.env.RESOURCE_STORAGE_DIR = previousDirectory;
  });

  it('stores a private file and serves it only with a valid signed URL', async () => {
    const uploaded = await service.upload('user-1', {
      buffer: Buffer.from('private text'),
      originalname: '../letter.txt',
      mimetype: 'text/plain',
      size: 12,
    });
    expect(resource.filename).toBe('.._letter.txt');
    expect(resource.mimeType).toBe('application/octet-stream');
    const signed = new URL(uploaded.url, 'https://example.test');
    const expires = Number(signed.searchParams.get('expires'));
    const signature = signed.searchParams.get('signature') || '';
    const opened = await service.openSigned(uploaded.uuid, expires, signature);
    expect(opened.resource.uuid).toBe(uploaded.uuid);
    expect(await fs.readFile(join(directory, uploaded.uuid), 'utf8')).toBe('private text');
    opened.stream.destroy();
    await expect(
      service.openSigned(uploaded.uuid, expires - 10_000, signature),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.openSigned(uploaded.uuid, expires, '00')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('removes files belonging to a deactivated user', async () => {
    const uploaded = await service.upload('user-1', {
      buffer: Buffer.from('private text'),
      originalname: 'letter.txt',
      mimetype: 'text/plain',
      size: 12,
    });
    resource.user.iSdelete = 1;
    await service.cleanup();
    await expect(fs.access(join(directory, uploaded.uuid))).rejects.toBeDefined();
    expect(repository.remove).toHaveBeenCalled();
    await expect(service.ownerAccess(uploaded.uuid, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('clears delivered letter bodies after the retention period', async () => {
    const letterRepository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([{ id: 7, lastTriggeredAt: new Date('2026-01-01') }])
        .mockResolvedValueOnce([]),
      update: jest.fn(),
    };
    const resourceRepository = { update: jest.fn() };
    (repository.manager as any).getRepository = jest.fn((entity) =>
      entity.name === 'Letter' ? letterRepository : resourceRepository,
    );
    (repository.manager as any).transaction = jest.fn(async (work) => work(repository.manager));
    (repository.find as jest.Mock).mockResolvedValue([]);
    await service.cleanup(new Date('2026-03-01'));
    expect(letterRepository.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        content: '',
        excerpt: '',
        iSdelete: 1,
        deliveryEnabled: false,
      }),
    );
    expect(resourceRepository.update).toHaveBeenCalledWith({ letter: { id: 7 } }, { iSdelete: 1 });
  });

  it('rolls back a stored object when persistence fails', async () => {
    (repository.save as jest.Mock).mockRejectedValue(new Error('database unavailable'));
    await expect(
      service.upload('user-1', {
        buffer: Buffer.from('x'),
        originalname: 'x',
        mimetype: 'image/png',
        size: 1,
      }),
    ).rejects.toThrow('database unavailable');
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rechecks orphan eligibility under the user lock before deleting a file', async () => {
    const uploaded = await service.upload('user-1', {
      buffer: Buffer.from('x'),
      originalname: 'x',
      mimetype: 'image/png',
      size: 1,
    });
    resource.letter = { id: 4, iSdelete: 0 };
    resource.createdAt = new Date(0);
    await service.cleanup();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(await fs.readFile(join(directory, uploaded.uuid), 'utf8')).toBe('x');
  });
});
