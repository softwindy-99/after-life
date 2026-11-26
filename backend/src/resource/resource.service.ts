import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { Letter } from 'src/letter/letter.entity';
import { resourceUuids } from 'src/letter/letter-content';
import { User } from 'src/user/user.entity';
import { EntityManager, In, IsNull, LessThan, Repository } from 'typeorm';
import { Resource } from './resource.entity';
import { lockOwnedUser } from 'src/correspondence/transaction';
import { letterRetentionDays } from 'src/config/letter-retention';
import { ResourceStorageService } from './resource-storage.service';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_USER_BYTES = 100 * 1024 * 1024;
const INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface UploadedResource {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class ResourceService {
  constructor(
    @InjectRepository(Resource) private readonly repository: Repository<Resource>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly storage: ResourceStorageService,
  ) {}

  async upload(userUuid: string, file?: UploadedResource): Promise<{ uuid: string; url: string }> {
    if (!file?.buffer) {
      throw new BadRequestException('file is required');
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES || file.size !== file.buffer.length) {
      throw new PayloadTooLargeException('file must be between 1 byte and 10 MB');
    }
    const user = await this.userRepository.findOne({ where: { uuid: userUuid, iSdelete: 0 } });
    if (!user) throw new NotFoundException('user not found');
    const uuid = randomUUID();
    let written: Pick<Resource, 'uuid' | 'storageDriver' | 'storageTarget'> | undefined;
    try {
      await this.repository.manager.transaction(async (manager) => {
        const lockedUser = await lockOwnedUser(manager.getRepository(User), userUuid);
        const resources = manager.getRepository(Resource);
        const used = await resources
          .createQueryBuilder('resource')
          .select('COALESCE(SUM(resource.sizeBytes), 0)', 'total')
          .where('resource.userId = :userId', { userId: lockedUser.id })
          .getRawOne<{ total: string }>();
        if (Number(used?.total || 0) + file.size > MAX_USER_BYTES) {
          throw new PayloadTooLargeException('resource storage limit exceeded');
        }
        written = { uuid, ...(await this.storage.put(uuid, file.buffer)) };
        await resources.save(
          resources.create({
            uuid,
            storageDriver: written.storageDriver,
            storageTarget: written.storageTarget,
            filename: file.originalname.replace(/[\\/\r\n]/g, '_').slice(0, 255) || 'file',
            mimeType: INLINE_IMAGE_TYPES.has(file.mimetype)
              ? file.mimetype
              : 'application/octet-stream',
            sizeBytes: file.size,
            user: lockedUser,
            letter: null,
          }),
        );
      });
    } catch (error) {
      if (written) await this.storage.delete(written).catch(() => undefined);
      throw error;
    }
    return { uuid, url: this.signedPath(uuid, 15 * 60) };
  }

  async ownerAccess(uuid: string, userUuid: string): Promise<{ url: string }> {
    const resource = await this.repository.findOne({
      where: { uuid, iSdelete: 0, user: { uuid: userUuid, iSdelete: 0 } },
      relations: { letter: true, user: true },
    });
    if (!resource || resource.user?.iSdelete === 1 || resource.letter?.iSdelete === 1)
      throw new NotFoundException();
    return { url: this.signedPath(uuid, 15 * 60) };
  }

  async openSigned(
    uuid: string,
    expires: number,
    signature: string,
  ): Promise<{ resource: Resource; stream: Readable }> {
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException();
    }
    const expected = this.signature(uuid, expires);
    const provided = Buffer.from(signature || '', 'hex');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new ForbiddenException();
    }
    const resource = await this.repository.findOne({
      where: { uuid, iSdelete: 0, user: { iSdelete: 0 } },
      relations: { letter: true, user: true },
    });
    if (!resource || resource.user?.iSdelete === 1 || resource.letter?.iSdelete === 1)
      throw new NotFoundException();
    return { resource, stream: await this.storage.open(resource) };
  }

  signedPath(uuid: string, seconds: number): string {
    const expires = Math.floor(Date.now() / 1000) + seconds;
    return `/resource/${uuid}/file?expires=${expires}&signature=${this.signature(uuid, expires).toString('hex')}`;
  }

  /** 仅核对归属，不认领附件；预览与正式保存共用同一规则。
   * Validate ownership without claiming files; preview and save share this rule. */
  async validateLetterResources(
    manager: EntityManager,
    userUuid: string,
    letterId: number | undefined,
    content: string,
  ): Promise<Resource[]> {
    const repository = manager.getRepository(Resource);
    const uuids = resourceUuids(content);
    const requested = uuids.length
      ? await repository.find({
          where: { uuid: In(uuids), iSdelete: 0, user: { uuid: userUuid } },
          relations: { letter: true },
        })
      : [];
    if (
      requested.length !== uuids.length ||
      requested.some((item) => item.letter && item.letter.id !== letterId)
    ) {
      throw new BadRequestException('letter contains unavailable local resources');
    }
    return requested;
  }

  async syncLetterResources(
    manager: EntityManager,
    userUuid: string,
    letter: Letter,
    content: string,
  ): Promise<void> {
    const repository = manager.getRepository(Resource);
    const requested = await this.validateLetterResources(manager, userUuid, letter.id, content);
    const existing = await repository.find({ where: { letter: { id: letter.id }, iSdelete: 0 } });
    const kept = new Set(requested.map((item) => item.uuid.toLowerCase()));
    for (const item of existing) {
      if (!kept.has(item.uuid.toLowerCase())) {
        item.iSdelete = 1;
        await repository.save(item);
      }
    }
    for (const item of requested) {
      if (!item.letter) {
        const claimed = await repository.update(
          { id: item.id, letter: IsNull(), iSdelete: 0 },
          { letter },
        );
        if (claimed.affected !== 1) {
          throw new ConflictException('resource was linked to another letter');
        }
      }
    }
    letter.resourceCount = requested.length;
  }

  async listOwnedForLetter(
    userUuid: string,
    letterUuid: string,
    page: number,
    pageSize: number,
  ): Promise<object> {
    const letter = await this.repository.manager
      .getRepository(Letter)
      .findOne({ where: { uuid: letterUuid, user: { uuid: userUuid }, iSdelete: 0 } });
    if (!letter) throw new NotFoundException('letter not found');
    const [files, total] = await this.repository.findAndCount({
      where: { letter: { id: letter.id }, user: { uuid: userUuid }, iSdelete: 0 },
      order: { id: 'ASC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return {
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      items: files.map((file) => ({
        uuid: file.uuid,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: Number(file.sizeBytes),
      })),
      total,
    };
  }

  async totalBytes(): Promise<number> {
    const result = await this.repository
      .createQueryBuilder('resource')
      .select('COALESCE(SUM(resource.sizeBytes), 0)', 'total')
      .getRawOne<{ total: string }>();
    return Number(result?.total || 0);
  }

  async cleanup(now = new Date()): Promise<void> {
    const retentionDays = letterRetentionDays();
    const cutoff = new Date(now.getTime() - retentionDays * 86400_000);
    const letterRepository = this.repository.manager.getRepository(Letter);
    const expiredLetters = await letterRepository.find({
      where: { iSdelete: 0, lastTriggeredAt: LessThan(cutoff) },
    });
    const deactivatedUserLetters = await letterRepository.find({
      where: { iSdelete: 0, user: { iSdelete: 1 } },
    });
    for (const letter of new Map(
      [...expiredLetters, ...deactivatedUserLetters].map((item) => [item.id, item]),
    ).values()) {
      await this.repository.manager.transaction(async (manager) => {
        await manager.getRepository(Letter).update(letter.id, {
          iSdelete: 1,
          content: '',
          excerpt: '',
          deliveryEnabled: false,
        });
        await manager
          .getRepository(Resource)
          .update({ letter: { id: letter.id } }, { iSdelete: 1 });
      });
    }
    const stale = await this.repository.find({
      where: [
        { iSdelete: 1 },
        { user: { iSdelete: 1 } },
        { letter: { iSdelete: 1 } },
        { letter: IsNull(), createdAt: LessThan(new Date(now.getTime() - 86400_000)) },
      ],
      relations: { user: true, letter: true },
    });
    for (const resource of stale) {
      await this.repository.manager.transaction(async (manager) => {
        // Serialize with uploads and migration, including deactivated owners.
        await manager.getRepository(User).findOne({
          where: { id: resource.user.id },
          lock: { mode: 'pessimistic_write' },
        });
        const resources = manager.getRepository(Resource);
        const current = await resources.findOne({
          where: { uuid: resource.uuid },
          relations: { user: true, letter: true },
        });
        if (!current) return;
        const stillStale =
          current.iSdelete === 1 ||
          current.user.iSdelete === 1 ||
          current.letter?.iSdelete === 1 ||
          (!current.letter && current.createdAt < new Date(now.getTime() - 86400_000));
        if (!stillStale) return;
        await this.storage.delete(current);
        await resources.remove(current);
      });
    }
  }

  private signature(uuid: string, expires: number): Buffer {
    return createHmac('sha256', process.env.JWT_SECRET || '')
      .update(`${uuid}:${expires}`)
      .digest();
  }
}
