import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from 'src/user/user.entity';

// 关系写入先锁用户，再按主键顺序锁联系人，最后锁信件。
// REST 与 MCP 必须遵循同一顺序，避免死锁以及校验后收件关系被并发修改。
// REST and MCP share user → sorted contacts → letter locking; creation time is the liveness fallback.
export async function lockOwnedUser(
  userRepository: Repository<User>,
  userUuid: string,
): Promise<User> {
  const user = await userRepository.findOne({
    where: { uuid: userUuid, iSdelete: 0 },
    select: { id: true, uuid: true, createdAt: true },
    loadEagerRelations: false,
    lock: { mode: 'pessimistic_write' },
  });
  if (!user) throw new NotFoundException('user not found');
  return user;
}

// 同一毫秒内连续写入仍推进版本，避免旧客户端误通过乐观并发校验。
// Advance the version even when multiple writes occur within one millisecond.
export function nextUpdatedAt(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}

// Shared by REST forms and MCP writes; legacy callers may omit the version.
export function assertResourceVersion(updatedAt: Date, expectedUpdatedAt?: string): void {
  if (
    expectedUpdatedAt !== undefined &&
    updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
  )
    throw new ConflictException('resource changed; read it again before updating');
}
