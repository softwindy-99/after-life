import { ConflictException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface DeliveryReviewSnapshot {
  userUuid: string;
  letterUuid: string | null;
  updatedAt: string | null;
  title: string;
  content: string;
  inactiveAfterMinutes: number;
  baselineAt: string;
  baselineSource: 'check-in' | 'account-created';
  contacts: { uuid: string; name: string; email: string | null }[];
  resourceCount: number;
  retentionDays: number;
  mailConfigured: boolean;
  publicBaseUrl: string;
}

export interface DeliveryReview {
  baselineAt: string;
  baselineSource: DeliveryReviewSnapshot['baselineSource'];
  dueAt: string;
  overdue: boolean;
  recipients: DeliveryReviewSnapshot['contacts'];
  skippedContacts: DeliveryReviewSnapshot['contacts'];
  resourceCount: number;
  retentionDays: number;
  blockers: string[];
  expiresAt: string;
  token: string | null;
}

function signature(snapshot: DeliveryReviewSnapshot, expires: number): Buffer {
  return createHmac('sha256', process.env.JWT_SECRET || '')
    .update(JSON.stringify(['letter-delivery-review', expires, snapshot]))
    .digest();
}

/** 摘要绑定实际内容和投递依据；预览不会更新签到或启用投递。
 * Bind the review to content and delivery inputs without changing liveness or delivery. */
export function createDeliveryReview(
  snapshot: DeliveryReviewSnapshot,
  now = new Date(),
): DeliveryReview {
  const dueAt = new Date(
    new Date(snapshot.baselineAt).getTime() + snapshot.inactiveAfterMinutes * 60_000,
  );
  const overdue = dueAt.getTime() <= now.getTime();
  // 未超时摘要不能跨过触发时刻继续使用，否则用户会错过立即投递的确认。
  // A future review expires at its deadline so crossing it requires overdue acknowledgement.
  const expires = Math.min(
    Math.floor(now.getTime() / 1000) + 600,
    overdue ? Infinity : Math.floor(dueAt.getTime() / 1000),
  );
  const recipients = snapshot.contacts.filter((contact) => contact.email);
  const blockers: string[] = [];
  if (!recipients.length) blockers.push('请至少选择一位有邮箱的联系人。');
  if (!snapshot.mailConfigured) blockers.push('请先在邮件服务中完成 SMTP 配置。');
  if (snapshot.resourceCount) {
    try {
      const url = new URL(snapshot.publicBaseUrl);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      blockers.push('信件包含私有附件，请先配置 HTTPS 公共访问地址。');
    }
  }
  return {
    baselineAt: snapshot.baselineAt,
    baselineSource: snapshot.baselineSource,
    dueAt: dueAt.toISOString(),
    overdue,
    recipients,
    skippedContacts: snapshot.contacts.filter((contact) => !contact.email),
    resourceCount: snapshot.resourceCount,
    retentionDays: snapshot.retentionDays,
    blockers,
    expiresAt: new Date(expires * 1000).toISOString(),
    token: blockers.length ? null : `${expires}.${signature(snapshot, expires).toString('hex')}`,
  };
}

/** 在写事务内重新核对，避免确认后内容、联系人或签到变化造成误投递。
 * Recheck inside the write transaction so intervening edits or check-ins invalidate consent. */
export function assertDeliveryReview(
  token: string | undefined,
  snapshot: DeliveryReviewSnapshot,
): void {
  const match = token?.match(/^(\d{10})\.([a-f0-9]{64})$/);
  if (
    !match ||
    Number(match[1]) <= Math.floor(Date.now() / 1000) ||
    !timingSafeEqual(Buffer.from(match[2], 'hex'), signature(snapshot, Number(match[1]))) ||
    createDeliveryReview(snapshot).blockers.length
  ) {
    throw new ConflictException('投递依据已变化或摘要已过期，请重新核对投递摘要。');
  }
}
