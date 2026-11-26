import { BadRequestException, Logger } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { User } from 'src/user/user.entity';
import webPush = require('web-push');
import { NotificationService } from './notification.service';
import { PushSubscriptionRecord } from './push-subscription.entity';

describe('NotificationService', () => {
  let service: NotificationService;
  let subscriptionRepository: ReturnType<typeof createMockRepository>;
  let userRepository: ReturnType<typeof createMockRepository>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    subscriptionRepository = createMockRepository();
    userRepository = createMockRepository();
    process.env.WEB_PUSH_PUBLIC_KEY = 'public-key';
    process.env.WEB_PUSH_PRIVATE_KEY = 'private-key';
    process.env.INIT_ADMIN_EMAIL = 'admin@example.com';
    delete process.env.WEB_PUSH_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(PushSubscriptionRecord),
          useValue: subscriptionRepository,
        },
        { provide: getRepositoryToken(User), useValue: userRepository },
      ],
    }).compile();
    service = moduleRef.get(NotificationService);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers a browser subscription with normalized preferences', async () => {
    const user = { uuid: 'user-1' };
    userRepository.findOne.mockResolvedValue(user);
    subscriptionRepository.findOne.mockResolvedValue(null);
    subscriptionRepository.create.mockImplementation((value) => ({
      ...value,
      uuid: 'subscription-1',
      iSdelete: 0,
    }));
    subscriptionRepository.save.mockImplementation((value) => Promise.resolve(value));

    await expect(
      service.register(
        'user-1',
        {
          endpoint: ' https://push.example/subscription ',
          keys: { p256dh: 'public', auth: 'auth' },
        },
        {
          dailyReminderEnabled: false,
          dailyReminderTime: '18:30',
          timezone: 'Asia/Shanghai',
          letterWarningMinutes: 180,
        },
      ),
    ).resolves.toEqual({
      subscribed: true,
      subscriptionId: 'subscription-1',
      preferences: {
        dailyReminderEnabled: false,
        dailyReminderTime: '18:30',
        timezone: 'Asia/Shanghai',
        letterWarningEnabled: true,
        letterWarningMinutes: 180,
      },
    });

    expect(subscriptionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://push.example/subscription',
        endpointHash: createHash('sha256')
          .update('https://push.example/subscription')
          .digest('hex'),
        user,
      }),
    );
  });

  it('revives and reassigns an existing endpoint', async () => {
    const existing = {
      uuid: 'subscription-2',
      endpointHash: 'hash',
      dailyReminderEnabled: true,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: true,
      letterWarningMinutes: 60,
      iSdelete: 1,
    };
    const user = { uuid: 'user-2' };
    userRepository.findOne.mockResolvedValue(user);
    subscriptionRepository.findOne.mockResolvedValue(existing);
    subscriptionRepository.merge.mockImplementation((record, value) => ({ ...record, ...value }));
    subscriptionRepository.save.mockImplementation((value) => Promise.resolve(value));

    const result = await service.register('user-2', {
      endpoint: 'https://push.example/existing',
      keys: { p256dh: 'new-public', auth: 'new-auth' },
    });

    expect(result.subscribed).toBe(true);
    expect(subscriptionRepository.merge).toHaveBeenCalledWith(
      existing,
      expect.objectContaining({ iSdelete: 0, user }),
    );
  });

  it('reads, updates, and removes an owned subscription without exposing its keys', async () => {
    const record = {
      id: 7,
      uuid: 'subscription-1',
      iSdelete: 0,
      dailyReminderEnabled: true,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: true,
      letterWarningMinutes: 60,
    };
    subscriptionRepository.findOne.mockResolvedValue(record);
    subscriptionRepository.merge.mockImplementation((current, value) => ({ ...current, ...value }));
    subscriptionRepository.save.mockImplementation((value) => Promise.resolve(value));

    await expect(service.getStatus('user-1', 'https://push.example/one')).resolves.toEqual({
      subscribed: true,
      subscriptionId: 'subscription-1',
      preferences: {
        dailyReminderEnabled: true,
        dailyReminderTime: '09:00',
        timezone: 'UTC',
        letterWarningEnabled: true,
        letterWarningMinutes: 60,
      },
    });
    await expect(
      service.updatePreferences('user-1', 'https://push.example/one', {
        dailyReminderTime: '20:15',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        preferences: expect.objectContaining({ dailyReminderTime: '20:15' }),
      }),
    );
    await service.remove('user-1', { subscriptionId: 'subscription-1' });
    expect(subscriptionRepository.delete).toHaveBeenCalledWith({
      id: 7,
      uuid: 'subscription-1',
    });
  });

  it('rejects malformed subscriptions and preferences', async () => {
    await expect(
      service.register('user-1', {
        endpoint: 'http://push.example/insecure',
        keys: { p256dh: '', auth: '' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    userRepository.findOne.mockResolvedValue({ uuid: 'user-1' });
    subscriptionRepository.findOne.mockResolvedValue(null);
    await expect(
      service.register(
        'user-1',
        {
          endpoint: 'https://push.example/valid',
          keys: { p256dh: 'public', auth: 'auth' },
        },
        { dailyReminderTime: '25:00' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends encrypted push payloads with VAPID settings', async () => {
    const sendNotification = jest
      .spyOn(webPush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
    const subscription = {
      id: 1,
      endpoint: 'https://push.example/one',
      p256dh: 'public',
      auth: 'auth',
      iSdelete: 0,
      deliveryFailureCount: 2,
      firstDeliveryFailureAt: new Date('2026-01-01T00:00:00Z'),
      lastDeliveryFailureAt: new Date('2026-01-02T00:00:00Z'),
    } as PushSubscriptionRecord;
    const payload = { title: 'Reminder', body: 'Check in', url: '/check-in', tag: 'daily' };

    await expect(service.send(subscription, payload)).resolves.toBe(true);
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: 'public', auth: 'auth' },
      },
      JSON.stringify(payload),
      expect.objectContaining({
        timeout: 15_000,
        urgency: 'high',
        vapidDetails: expect.objectContaining({ subject: 'mailto:admin@example.com' }),
      }),
    );
    expect(subscription.deliveryFailureCount).toBe(0);
    expect(subscription.firstDeliveryFailureAt).toBeNull();
    expect(subscription.lastDeliveryFailureAt).toBeNull();
    expect(subscription.lastDeliverySuccessAt).toBeInstanceOf(Date);
    expect(subscriptionRepository.save).toHaveBeenCalledWith(subscription);
  });

  it('deletes subscriptions rejected as gone by the push service', async () => {
    jest.spyOn(webPush, 'sendNotification').mockRejectedValue({ statusCode: 410 });
    const subscription = {
      id: 9,
      uuid: 'subscription-9',
      endpoint: 'https://push.example/gone',
      p256dh: 'public',
      auth: 'auth',
      iSdelete: 0,
    } as PushSubscriptionRecord;

    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(false);
    expect(subscriptionRepository.delete).toHaveBeenCalledWith({
      id: 9,
      uuid: 'subscription-9',
    });
    expect(subscriptionRepository.save).not.toHaveBeenCalled();
  });

  it.each(['WEB_PUSH_PROXY', 'HTTPS_PROXY', 'https_proxy'] as const)(
    'uses the %s proxy setting for push delivery',
    async (proxyKey) => {
      process.env[proxyKey] = 'http://127.0.0.1:7890';
      const sendNotification = jest
        .spyOn(webPush, 'sendNotification')
        .mockResolvedValue({ statusCode: 201, headers: {}, body: '' });
      const subscription = {
        id: 12,
        endpoint: 'https://fcm.googleapis.com/subscription',
        p256dh: 'public',
        auth: 'auth',
        iSdelete: 0,
        deliveryFailureCount: 0,
      } as PushSubscriptionRecord;

      await expect(
        service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
      ).resolves.toBe(true);

      expect(sendNotification).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.objectContaining({
          proxy: 'http://127.0.0.1:7890',
          timeout: 15_000,
        }),
      );
    },
  );

  it('logs nested network failures without exposing the subscription endpoint', async () => {
    const networkError = Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' });
    jest.spyOn(webPush, 'sendNotification').mockRejectedValue(new AggregateError([networkError]));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const subscription = {
      id: 13,
      endpoint: 'https://fcm.googleapis.com/private/subscription-token',
      p256dh: 'public',
      auth: 'auth',
      iSdelete: 0,
      deliveryFailureCount: 0,
    } as PushSubscriptionRecord;

    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(false);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fcm.googleapis.com'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connect timed out'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('code ETIMEDOUT'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('subscription-token'));
  });

  it('backs off transient failures and resets the counter after a success', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00Z'));
    const sendNotification = jest
      .spyOn(webPush, 'sendNotification')
      .mockRejectedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ statusCode: 201, headers: {}, body: '' });
    const subscription = {
      id: 10,
      endpoint: 'https://push.example/retry',
      p256dh: 'public',
      auth: 'auth',
      iSdelete: 0,
      deliveryFailureCount: 0,
    } as PushSubscriptionRecord;

    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(false);
    expect(subscription.deliveryFailureCount).toBe(1);
    expect(subscription.firstDeliveryFailureAt).toEqual(new Date('2026-05-01T00:00:00Z'));

    jest.setSystemTime(new Date('2026-05-01T00:30:00Z'));
    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(false);
    expect(sendNotification).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-05-01T01:00:00Z'));
    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(true);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(subscription.deliveryFailureCount).toBe(0);
  });

  it('deletes a subscription after repeated failures across a long failure window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T00:00:00Z'));
    jest.spyOn(webPush, 'sendNotification').mockRejectedValue({ statusCode: 503 });
    const subscription = {
      id: 11,
      uuid: 'subscription-11',
      endpoint: 'https://push.example/stale',
      p256dh: 'public',
      auth: 'auth',
      iSdelete: 0,
      deliveryFailureCount: 9,
      firstDeliveryFailureAt: new Date('2026-05-01T00:00:00Z'),
      lastDeliveryFailureAt: new Date('2026-05-09T00:00:00Z'),
    } as PushSubscriptionRecord;

    await expect(
      service.send(subscription, { title: 'x', body: 'y', url: '/', tag: 'z' }),
    ).resolves.toBe(false);
    expect(subscriptionRepository.delete).toHaveBeenCalledWith({
      id: 11,
      uuid: 'subscription-11',
    });
    expect(subscriptionRepository.save).not.toHaveBeenCalled();
  });
});
