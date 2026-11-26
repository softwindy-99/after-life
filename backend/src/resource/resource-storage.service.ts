import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { lockOwnedUser } from 'src/correspondence/transaction';
import { RuntimeConfigWriter } from 'src/setup/runtime-config.writer';
import { User } from 'src/user/user.entity';
import { Not, Repository } from 'typeorm';
import { createObjectStorage, ObjectStorage, readObject } from './object-storage';
import { Resource } from './resource.entity';
import {
  readStorageSettings,
  StorageSettings,
  storageSettingsSchema,
  storageTarget,
  validateStorageSettings,
} from './storage-config';

export interface StorageStatus {
  driver: StorageSettings['driver'];
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  credentialsConfigured: boolean;
  writable: boolean;
  localCount: number;
  externalCount: number;
}

@Injectable()
export class ResourceStorageService {
  constructor(
    @InjectRepository(Resource) private readonly repository: Repository<Resource>,
    private readonly configWriter: RuntimeConfigWriter,
  ) {}

  private localPath(uuid: string): string {
    return join(
      process.env.RESOURCE_STORAGE_DIR || join(process.cwd(), '.codex', 'resources'),
      uuid,
    );
  }

  private key(settings: StorageSettings, uuid: string): string {
    return [settings.prefix, uuid].filter(Boolean).join('/');
  }

  async status(userUuid: string): Promise<StorageStatus> {
    const settings = readStorageSettings();
    validateStorageSettings(settings);
    const [localCount, externalCount] = await Promise.all([
      this.repository.count({ where: { storageDriver: 'local', user: { uuid: userUuid } } }),
      this.repository.count({ where: { storageDriver: Not('local'), user: { uuid: userUuid } } }),
    ]);
    // Credentials and local filesystem paths never leave the server.
    return {
      driver: settings.driver,
      endpoint: settings.endpoint,
      region: settings.region,
      bucket: settings.bucket,
      prefix: settings.prefix,
      forcePathStyle: settings.forcePathStyle,
      credentialsConfigured: Boolean(settings.accessKeyId && settings.accessKeySecret),
      writable: true,
      localCount,
      externalCount,
    };
  }

  private parseSettings(payload: unknown): StorageSettings {
    const parsed = storageSettingsSchema.safeParse(payload);
    if (!parsed.success) throw new BadRequestException('Invalid storage settings');
    const current = readStorageSettings();
    const settings = {
      ...parsed.data,
      endpoint: parsed.data.endpoint.replace(/\/$/, ''),
      accessKeyId: parsed.data.accessKeyId || current.accessKeyId,
      accessKeySecret: parsed.data.accessKeySecret || current.accessKeySecret,
    };
    validateStorageSettings(settings);
    return settings;
  }

  async configure(userUuid: string, payload: unknown): Promise<StorageStatus> {
    await this.repository.manager.transaction('REPEATABLE READ', async (manager) => {
      // Uploads and migrations hold their owner's row until file metadata commits.
      // A primary-key range lock also covers accounts created during this global change.
      const accounts: Array<{ uuid: string; iSdelete: number }> = await manager.query(
        'SELECT uuid, iSdelete FROM `user` FORCE INDEX (PRIMARY) ORDER BY id FOR UPDATE',
      );
      if (!accounts.some((account) => account.uuid === userUuid && account.iSdelete === 0)) {
        throw new NotFoundException('user not found');
      }
      const settings = this.parseSettings(payload);
      const external = await manager.getRepository(Resource).findOne({
        where: { storageDriver: Not('local') },
      });
      if (
        external &&
        (settings.driver !== external.storageDriver ||
          storageTarget(settings) !== external.storageTarget)
      )
        throw new ConflictException(
          'Existing external resources require the current storage target',
        );
      await this.configWriter.update({
        RESOURCE_STORAGE_DRIVER: settings.driver,
        RESOURCE_STORAGE_ENDPOINT: settings.endpoint,
        RESOURCE_STORAGE_REGION: settings.region,
        RESOURCE_STORAGE_BUCKET: settings.bucket,
        RESOURCE_STORAGE_PREFIX: settings.prefix,
        RESOURCE_STORAGE_FORCE_PATH_STYLE: String(settings.forcePathStyle),
        RESOURCE_STORAGE_ACCESS_KEY_ID: settings.accessKeyId,
        RESOURCE_STORAGE_ACCESS_KEY_SECRET: settings.accessKeySecret,
      });
    });
    return this.status(userUuid);
  }

  async test(payload: unknown): Promise<{ ok: true }> {
    const settings = this.parseSettings(payload);
    if (settings.driver === 'local') throw new BadRequestException('Select an external backend');
    await this.external(settings, async (client) => {
      const key = this.key(settings, `.connection-test-${randomUUID()}`);
      const body = Buffer.from(randomUUID());
      try {
        await client.put(key, body);
        const result = await readObject(await client.open(key), body.length);
        if (!body.equals(result)) throw new Error('Storage verification failed');
      } finally {
        await client.delete(key);
      }
    });
    return { ok: true };
  }

  async put(
    uuid: string,
    body: Buffer,
  ): Promise<Pick<Resource, 'storageDriver' | 'storageTarget'>> {
    const settings = readStorageSettings();
    validateStorageSettings(settings);
    if (settings.driver === 'local') {
      const path = this.localPath(uuid);
      await fs.mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
      await fs.writeFile(path, body, { flag: 'wx', mode: 0o600 });
      return { storageDriver: 'local', storageTarget: null };
    }
    await this.external(settings, (client) => client.put(this.key(settings, uuid), body));
    return { storageDriver: settings.driver, storageTarget: storageTarget(settings) };
  }

  async open(
    resource: Pick<Resource, 'uuid' | 'storageDriver' | 'storageTarget'>,
  ): Promise<Readable> {
    if (!resource.storageDriver || resource.storageDriver === 'local') {
      // Open before returning, so missing local files become a controlled 404.
      const file = await fs.open(this.localPath(resource.uuid), 'r').catch(() => {
        throw new NotFoundException();
      });
      return file.createReadStream();
    }
    const settings = this.settingsFor(resource);
    const client = createObjectStorage(settings);
    try {
      const stream = await client.open(this.key(settings, resource.uuid));
      stream.once('close', () => client.close());
      return stream;
    } catch {
      client.close();
      throw new BadGatewayException('External storage read failed');
    }
  }

  async delete(
    resource: Pick<Resource, 'uuid' | 'storageDriver' | 'storageTarget'>,
  ): Promise<void> {
    if (resource.storageDriver && resource.storageDriver !== 'local') {
      const settings = this.settingsFor(resource);
      await this.external(settings, (client) => client.delete(this.key(settings, resource.uuid)));
    }
    // Also remove any retained pre-migration local copy.
    await fs.unlink(this.localPath(resource.uuid)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async migrate(userUuid: string): Promise<{ migrated: number; remaining: number }> {
    let migrated = 0;
    const candidates = await this.repository.find({
      where: { storageDriver: 'local', user: { uuid: userUuid } },
      order: { id: 'ASC' },
      take: 10,
    });
    for (const candidate of candidates) {
      await this.repository.manager.transaction(async (manager) => {
        await lockOwnedUser(manager.getRepository(User), userUuid);
        const resources = manager.getRepository(Resource);
        const resource = await resources.findOne({
          where: { uuid: candidate.uuid, user: { uuid: userUuid } },
          lock: { mode: 'pessimistic_write' },
        });
        if (!resource || resource.storageDriver !== 'local') return;
        const settings = readStorageSettings();
        validateStorageSettings(settings);
        if (settings.driver === 'local')
          throw new BadRequestException('Select an external backend');
        const size = Number(resource.sizeBytes);
        if (!Number.isSafeInteger(size) || size < 1 || size > 10 * 1024 * 1024)
          throw new ConflictException('Invalid resource size');
        const body = await readObject(createReadStream(this.localPath(resource.uuid)), size);
        if (body.length !== size) throw new ConflictException('Local resource size mismatch');
        await this.external(settings, async (client) => {
          const key = this.key(settings, resource.uuid);
          await client.put(key, body);
          const copied = await readObject(await client.open(key), size);
          const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
          if (hash(body) !== hash(copied)) throw new Error('Storage verification failed');
        });
        await resources.update(resource.id, {
          storageDriver: settings.driver,
          storageTarget: storageTarget(settings),
        });
        // Keep the local source as a backup. A failed transaction is safe to retry.
        migrated++;
      });
    }
    return {
      migrated,
      remaining: await this.repository.count({
        where: { storageDriver: 'local', user: { uuid: userUuid } },
      }),
    };
  }

  private settingsFor(
    resource: Pick<Resource, 'storageDriver' | 'storageTarget'>,
  ): StorageSettings {
    const settings = readStorageSettings();
    validateStorageSettings(settings);
    if (
      settings.driver !== resource.storageDriver ||
      storageTarget(settings) !== resource.storageTarget
    )
      throw new ConflictException('Resource storage target does not match configured storage');
    return settings;
  }

  private async external<T>(
    settings: StorageSettings,
    work: (client: ObjectStorage) => Promise<T>,
  ): Promise<T> {
    const client = createObjectStorage(settings);
    try {
      return await work(client);
    } catch {
      // SDK errors can contain endpoints, credentials or signed request headers.
      throw new BadGatewayException(
        'External storage operation failed; check connection and permissions',
      );
    } finally {
      client.close();
    }
  }
}
