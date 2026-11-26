import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { User } from 'src/user/user.entity';
import { Repository } from 'typeorm';
import webPush = require('web-push');
import { PushSubscriptionRecord } from './push-subscription.entity';
import {
  NotificationPreferencesInput,
  PushNotificationPayload,
  PushSubscriptionInput,
  PushSubscriptionRemovalInput,
  PushSubscriptionStatus,
} from './notification.types';

const RETRY_BASE_DELAY_MS = 60 * 60 * 1000;
const RETRY_MAX_DELAY_MS = 24 * RETRY_BASE_DELAY_MS;
const FAILURE_COUNT_LIMIT = 10;
const FAILURE_COUNT_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PUSH_REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(PushSubscriptionRecord)
    private readonly subscriptionRepository: Repository<PushSubscriptionRecord>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  getConfig(): { publicKey: string; configured: boolean } {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim() || '';
    return {
      publicKey,
      configured: Boolean(publicKey && process.env.WEB_PUSH_PRIVATE_KEY?.trim()),
    };
  }

  async register(
    userUuid: string,
    subscription: PushSubscriptionInput,
    preferences: NotificationPreferencesInput = {},
  ): Promise<PushSubscriptionStatus> {
    const normalized = this.normalizeSubscription(subscription);
    const user = await this.userRepository.findOne({
      where: { uuid: userUuid, iSdelete: 0 },
    });
    if (!user) throw new NotFoundException('user not found');

    const endpointHash = this.hashEndpoint(normalized.endpoint);
    const existing = await this.subscriptionRepository.findOne({ where: { endpointHash } });
    const preferenceValues = this.normalizePreferences(preferences, existing || undefined);
    const resetDeliveryState = {
      deliveryFailureCount: 0,
      firstDeliveryFailureAt: null as Date | null,
      lastDeliveryFailureAt: null as Date | null,
      lastDeliverySuccessAt: null as Date | null,
    };
    const record = existing
      ? this.subscriptionRepository.merge(existing, {
          ...normalized,
          ...preferenceValues,
          ...resetDeliveryState,
          lastDailyReminderDate: null,
          lastLetterWarningKey: null,
          iSdelete: 0,
          user,
        })
      : this.subscriptionRepository.create({
          ...normalized,
          ...preferenceValues,
          ...resetDeliveryState,
          lastDailyReminderDate: null,
          lastLetterWarningKey: null,
          endpointHash,
          iSdelete: 0,
          user,
        });

    return this.toStatus(await this.subscriptionRepository.save(record));
  }

  async getStatus(userUuid: string, endpoint: string): Promise<PushSubscriptionStatus> {
    const record = await this.findOwnedByEndpoint(userUuid, endpoint);
    return record
      ? this.toStatus(record)
      : { subscribed: false, subscriptionId: null, preferences: null };
  }

  async updatePreferences(
    userUuid: string,
    endpoint: string,
    preferences: NotificationPreferencesInput,
  ): Promise<PushSubscriptionStatus> {
    const record = await this.findOwnedByEndpoint(userUuid, endpoint);
    if (!record) throw new NotFoundException('push subscription not found');
    const updated = this.subscriptionRepository.merge(
      record,
      this.normalizePreferences(preferences, record),
    );
    return this.toStatus(await this.subscriptionRepository.save(updated));
  }

  async remove(userUuid: string, identifier: PushSubscriptionRemovalInput): Promise<void> {
    const record = await this.findOwnedByIdentifier(userUuid, identifier);
    if (!record) return;
    await this.subscriptionRepository.delete({ id: record.id, uuid: record.uuid });
  }

  async send(
    subscription: PushSubscriptionRecord,
    payload: PushNotificationPayload,
  ): Promise<boolean> {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
    if (!publicKey || !privateKey) return false;

    const now = new Date();
    if (this.retryIsDeferred(subscription, now)) return false;

    const subject = process.env.WEB_PUSH_SUBJECT?.trim() || this.defaultVapidSubject();
    const proxy = this.resolveProxy();
    const requestOptions: webPush.RequestOptions = {
      TTL: 60 * 60,
      urgency: 'high',
      timeout: PUSH_REQUEST_TIMEOUT_MS,
      vapidDetails: { subject, publicKey, privateKey },
    };
    if (proxy) requestOptions.proxy = proxy;

    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        requestOptions,
      );
      subscription.deliveryFailureCount = 0;
      subscription.firstDeliveryFailureAt = null;
      subscription.lastDeliveryFailureAt = null;
      subscription.lastDeliverySuccessAt = now;
      await this.subscriptionRepository.save(subscription);
      return true;
    } catch (error) {
      const statusCode = this.readStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await this.subscriptionRepository.delete({
          id: subscription.id,
          uuid: subscription.uuid,
        });
        return false;
      }

      await this.recordDeliveryFailure(subscription, now);
      const endpointHost = this.endpointHost(subscription.endpoint);
      this.logger.warn(
        `push delivery failed for ${endpointHost}${
          statusCode ? ` with status ${statusCode}` : ''
        }${proxy ? ' through configured proxy' : ''}: ${this.formatDeliveryError(error)}`,
      );
      return false;
    }
  }

  private async recordDeliveryFailure(
    subscription: PushSubscriptionRecord,
    now: Date,
  ): Promise<void> {
    subscription.deliveryFailureCount = (subscription.deliveryFailureCount || 0) + 1;
    subscription.firstDeliveryFailureAt ??= now;
    subscription.lastDeliveryFailureAt = now;

    const failureAgeMs = now.getTime() - subscription.firstDeliveryFailureAt.getTime();
    const repeatedlyFailed =
      subscription.deliveryFailureCount >= FAILURE_COUNT_LIMIT &&
      failureAgeMs >= FAILURE_COUNT_MIN_AGE_MS;
    if (repeatedlyFailed || failureAgeMs >= FAILURE_MAX_AGE_MS) {
      await this.subscriptionRepository.delete({
        id: subscription.id,
        uuid: subscription.uuid,
      });
      return;
    }
    await this.subscriptionRepository.save(subscription);
  }

  private retryIsDeferred(subscription: PushSubscriptionRecord, now: Date): boolean {
    if (!subscription.lastDeliveryFailureAt || !subscription.deliveryFailureCount) return false;
    const exponent = Math.min(subscription.deliveryFailureCount - 1, 5);
    const retryDelayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** exponent, RETRY_MAX_DELAY_MS);
    return now.getTime() < subscription.lastDeliveryFailureAt.getTime() + retryDelayMs;
  }

  private normalizeSubscription(subscription: PushSubscriptionInput): {
    endpoint: string;
    p256dh: string;
    auth: string;
  } {
    const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint.trim() : '';
    const p256dh = typeof subscription?.keys?.p256dh === 'string' ? subscription.keys.p256dh : '';
    const auth = typeof subscription?.keys?.auth === 'string' ? subscription.keys.auth : '';
    if (!endpoint || endpoint.length > 4096 || !endpoint.startsWith('https://')) {
      throw new BadRequestException('a valid HTTPS push endpoint is required');
    }
    if (!p256dh || p256dh.length > 255 || !auth || auth.length > 255) {
      throw new BadRequestException('valid push subscription keys are required');
    }
    return { endpoint, p256dh, auth };
  }

  private normalizePreferences(
    input: NotificationPreferencesInput,
    fallback?: PushSubscriptionRecord,
  ): {
    dailyReminderEnabled: boolean;
    dailyReminderTime: string;
    timezone: string;
    letterWarningEnabled: boolean;
    letterWarningMinutes: number;
  } {
    const dailyReminderEnabled =
      typeof input.dailyReminderEnabled === 'boolean'
        ? input.dailyReminderEnabled
        : fallback?.dailyReminderEnabled ?? true;
    const dailyReminderTime = input.dailyReminderTime ?? fallback?.dailyReminderTime ?? '09:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyReminderTime)) {
      throw new BadRequestException('dailyReminderTime must use HH:mm format');
    }

    const timezone = input.timezone?.trim() || fallback?.timezone || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException('timezone must be a valid IANA time zone');
    }

    const letterWarningEnabled =
      typeof input.letterWarningEnabled === 'boolean'
        ? input.letterWarningEnabled
        : fallback?.letterWarningEnabled ?? true;
    const letterWarningMinutes = input.letterWarningMinutes ?? fallback?.letterWarningMinutes ?? 60;
    if (
      !Number.isInteger(letterWarningMinutes) ||
      letterWarningMinutes < 5 ||
      letterWarningMinutes > 10080
    ) {
      throw new BadRequestException('letterWarningMinutes must be between 5 and 10080');
    }

    return {
      dailyReminderEnabled,
      dailyReminderTime,
      timezone,
      letterWarningEnabled,
      letterWarningMinutes,
    };
  }

  private findOwnedByEndpoint(
    userUuid: string,
    endpoint: string,
  ): Promise<PushSubscriptionRecord | null> {
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
      throw new BadRequestException('push endpoint is required');
    }
    return this.subscriptionRepository.findOne({
      where: {
        endpointHash: this.hashEndpoint(endpoint.trim()),
        user: { uuid: userUuid },
        iSdelete: 0,
      },
      relations: { user: true },
    });
  }

  private findOwnedByIdentifier(
    userUuid: string,
    identifier: PushSubscriptionRemovalInput,
  ): Promise<PushSubscriptionRecord | null> {
    const endpoint = identifier?.endpoint?.trim();
    const subscriptionId = identifier?.subscriptionId?.trim();
    if (!endpoint && !subscriptionId) {
      throw new BadRequestException('push endpoint or subscription id is required');
    }
    return this.subscriptionRepository.findOne({
      where: endpoint
        ? {
            endpointHash: this.hashEndpoint(endpoint),
            user: { uuid: userUuid },
            iSdelete: 0,
          }
        : { uuid: subscriptionId, user: { uuid: userUuid }, iSdelete: 0 },
      relations: { user: true },
    });
  }

  private hashEndpoint(endpoint: string): string {
    return createHash('sha256').update(endpoint).digest('hex');
  }

  private toStatus(record: PushSubscriptionRecord): PushSubscriptionStatus {
    return {
      subscribed: record.iSdelete === 0,
      subscriptionId: record.uuid,
      preferences: {
        dailyReminderEnabled: record.dailyReminderEnabled,
        dailyReminderTime: record.dailyReminderTime,
        timezone: record.timezone,
        letterWarningEnabled: record.letterWarningEnabled,
        letterWarningMinutes: record.letterWarningMinutes,
      },
    };
  }

  private defaultVapidSubject(): string {
    const email = process.env.INIT_ADMIN_EMAIL?.trim() || 'admin@example.com';
    return `mailto:${email}`;
  }

  private resolveProxy(): string | undefined {
    return (
      process.env.WEB_PUSH_PROXY?.trim() ||
      process.env.HTTPS_PROXY?.trim() ||
      process.env.https_proxy?.trim() ||
      undefined
    );
  }

  private endpointHost(endpoint: string): string {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return 'unknown push service';
    }
  }

  private formatDeliveryError(error: unknown): string {
    const details = this.collectErrorDetails(error);
    return [...new Set(details)].slice(0, 8).join('; ') || 'unknown push delivery error';
  }

  private collectErrorDetails(error: unknown, depth = 0): string[] {
    if (depth > 2) return [];
    if (typeof error === 'string') return error.trim() ? [error.trim()] : [];
    if (!error || typeof error !== 'object') {
      return error === undefined || error === null ? [] : [String(error)];
    }

    const value = error as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      body?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    const details: string[] = [];
    if (typeof value.message === 'string' && value.message.trim()) {
      details.push(value.message.trim());
    }
    if (typeof value.code === 'string' && value.code.trim()) {
      details.push(`code ${value.code.trim()}`);
    }
    if (typeof value.body === 'string' && value.body.trim()) {
      details.push(`response ${this.compactLogValue(value.body)}`);
    }
    if (Array.isArray(value.errors)) {
      for (const nested of value.errors.slice(0, 4)) {
        details.push(...this.collectErrorDetails(nested, depth + 1));
      }
    }
    if (value.cause) details.push(...this.collectErrorDetails(value.cause, depth + 1));
    if (!details.length && typeof value.name === 'string' && value.name.trim()) {
      details.push(value.name.trim());
    }
    return details;
  }

  private compactLogValue(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 300 ? `${normalized.slice(0, 297)}...` : normalized;
  }

  private readStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }
}
