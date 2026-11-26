import { createHash } from 'crypto';
import { lockOwnedUser } from 'src/correspondence/transaction';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/user/user.entity';
import { Repository } from 'typeorm';
import { CheckIn } from './check-in.entity';

@Injectable()
export class CheckInService {
  constructor(
    @InjectRepository(CheckIn)
    private readonly checkInRepository: Repository<CheckIn>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(userUuid: string, source?: string): Promise<CheckIn> {
    return this.checkInRepository.manager.transaction(async (manager) => {
      const user = await lockOwnedUser(manager.getRepository(User), userUuid);
      const repository = manager.getRepository(CheckIn);
      return repository.save(
        repository.create({ user, checkedAt: new Date(), source: source?.trim() || 'web' }),
      );
    });
  }

  async createDelegated(
    userUuid: string,
    authUuid: string,
    eventId: string,
    occurredAt: string,
  ): Promise<object> {
    return this.checkInRepository.manager.transaction(async (manager) => {
      const user = await lockOwnedUser(manager.getRepository(User), userUuid);
      const repository = manager.getRepository(CheckIn);
      const eventKey = createHash('sha256')
        .update(`${userUuid}:${authUuid}:${eventId}`)
        .digest('hex');
      const existing = await repository.findOne({ where: { eventKey, user: { uuid: userUuid } } });
      // checkedAt is stored with MySQL second precision; normalize retries identically.
      const observedAt = new Date(occurredAt);
      const checkedAt = new Date(Math.floor(observedAt.getTime() / 1000) * 1000);
      if (existing) {
        if (existing.checkedAt.getTime() !== checkedAt.getTime())
          throw new BadRequestException('event time cannot change');
        return {
          recorded: false,
          checkedAt: existing.checkedAt.toISOString(),
          source: existing.source,
        };
      }
      const age = Date.now() - observedAt.getTime();
      if (!Number.isFinite(age) || age < 0 || age > 5 * 60000)
        throw new BadRequestException(
          'human interaction must have occurred within the last five minutes, never in the future',
        );
      const latest = await repository.findOne({
        where: { user: { uuid: userUuid }, iSdelete: 0 },
        order: { checkedAt: 'DESC' },
      });
      if (latest && checkedAt.getTime() - latest.checkedAt.getTime() < 60000)
        return {
          recorded: false,
          checkedAt: latest.checkedAt.toISOString(),
          source: latest.source,
        };
      const saved = await repository.save(
        repository.create({ user, checkedAt, eventKey, source: `mcp:${authUuid}` }),
      );
      return { recorded: true, checkedAt: saved.checkedAt.toISOString(), source: saved.source };
    });
  }

  findLatestByUser(userUuid: string): Promise<CheckIn | null> {
    return this.checkInRepository.findOne({
      where: { user: { uuid: userUuid }, iSdelete: 0 },
      relations: { user: true },
      order: { checkedAt: 'DESC' },
    });
  }

  async getStatus(userUuid: string): Promise<{
    lastSeenAt: Date | null;
    checkIn: CheckIn | null;
    baselineAt: Date | null;
    baselineSource: 'check-in' | 'account-created';
  }> {
    const checkIn = await this.findLatestByUser(userUuid);
    const user = checkIn
      ? null
      : await this.userRepository.findOne({
          where: { uuid: userUuid, iSdelete: 0 },
          select: { createdAt: true },
          loadEagerRelations: false,
        });
    return {
      lastSeenAt: checkIn?.checkedAt ?? null,
      checkIn,
      baselineAt: checkIn?.checkedAt ?? user?.createdAt ?? null,
      baselineSource: checkIn ? 'check-in' : 'account-created',
    };
  }
}
