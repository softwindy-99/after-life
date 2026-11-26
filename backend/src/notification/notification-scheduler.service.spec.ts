import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Letter } from 'src/letter/letter.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationService } from './notification.service';
import { PushSubscriptionRecord } from './push-subscription.entity';

describe('NotificationSchedulerService', () => {
  let service: NotificationSchedulerService;
  let subscriptionRepository: ReturnType<typeof createMockRepository>;
  let checkInRepository: ReturnType<typeof createMockRepository>;
  let letterRepository: ReturnType<typeof createMockRepository>;
  let notificationService: { send: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    subscriptionRepository = createMockRepository();
    checkInRepository = createMockRepository();
    letterRepository = createMockRepository();
    notificationService = { send: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationSchedulerService,
        {
          provide: getRepositoryToken(PushSubscriptionRecord),
          useValue: subscriptionRepository,
        },
        { provide: getRepositoryToken(CheckIn), useValue: checkInRepository },
        { provide: getRepositoryToken(Letter), useValue: letterRepository },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();
    service = moduleRef.get(NotificationSchedulerService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('sends one daily reminder after local reminder time when the user has not checked in', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: true,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningMinutes: 60,
      lastDailyReminderDate: null as string | null,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-01T00:00:00Z') },
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([]);
    checkInRepository.findOne.mockResolvedValue({
      checkedAt: new Date('2026-05-12T08:00:00Z'),
    });
    subscriptionRepository.save.mockResolvedValue(subscription);

    await expect(service.processNotifications(new Date('2026-05-13T10:00:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 1,
    });
    expect(notificationService.send).toHaveBeenCalledWith(
      subscription,
      expect.objectContaining({ url: '/checkin', tag: 'daily-check-in-2026-05-13' }),
    );
    expect(subscription.lastDailyReminderDate).toBe('2026-05-13');
  });

  it('does not remind a user who already checked in on the local day', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: true,
      dailyReminderTime: '09:00',
      timezone: 'Asia/Shanghai',
      letterWarningMinutes: 60,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-01T00:00:00Z') },
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([]);
    checkInRepository.findOne.mockResolvedValue({
      checkedAt: new Date('2026-05-13T01:30:00Z'),
    });

    await expect(service.processNotifications(new Date('2026-05-13T10:00:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 0,
    });
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('warns before an eligible letter reaches its inactive deadline', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: true,
      letterWarningMinutes: 60,
      lastLetterWarningKey: null as string | null,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-01T00:00:00Z') },
    };
    const letter = {
      uuid: 'letter-1',
      title: 'For later',
      inactiveAfterMinutes: 90,
      deliveryEnabled: true,
      lastTriggeredAt: null as Date | null,
      user: subscription.user,
      contacts: [{ uuid: 'contact-1', email: 'person@example.com' }],
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([letter]);
    checkInRepository.findOne.mockResolvedValue({
      checkedAt: new Date('2026-05-13T10:00:00Z'),
    });
    subscriptionRepository.save.mockResolvedValue(subscription);

    await expect(service.processNotifications(new Date('2026-05-13T10:30:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 1,
    });
    expect(notificationService.send).toHaveBeenCalledWith(
      subscription,
      expect.objectContaining({
        title: '信件即将自动发送',
        body: expect.stringContaining('60 分钟后'),
        url: '/letters',
      }),
    );
    expect(subscription.lastLetterWarningKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('skips already-triggered, unsendable, and duplicate letter warnings', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: true,
      letterWarningMinutes: 60,
      lastLetterWarningKey: 'unchanged',
      user: { uuid: 'user-1', createdAt: new Date('2026-05-13T10:00:00Z') },
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 30,
        lastTriggeredAt: new Date(),
        user: subscription.user,
        contacts: [{ email: 'person@example.com' }],
      },
      {
        uuid: 'letter-2',
        inactiveAfterMinutes: 30,
        lastTriggeredAt: null,
        user: subscription.user,
        contacts: [{ email: null }],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue(null);

    await expect(service.processNotifications(new Date('2026-05-13T10:10:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 0,
    });
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('does not warn for a letter whose only email contact is soft-deleted', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: true,
      letterWarningMinutes: 60,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-13T10:00:00Z') },
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 30,
        lastTriggeredAt: null,
        user: subscription.user,
        contacts: [{ email: 'deleted@example.com', iSdelete: 1 }],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue(null);

    await expect(service.processNotifications(new Date('2026-05-13T10:10:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 0,
    });
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('skips letter warnings after the user disables that reminder', async () => {
    const subscription = {
      iSdelete: 0,
      dailyReminderEnabled: false,
      dailyReminderTime: '09:00',
      timezone: 'UTC',
      letterWarningEnabled: false,
      letterWarningMinutes: 60,
      user: { uuid: 'user-1', createdAt: new Date('2026-05-13T10:00:00Z') },
    };
    subscriptionRepository.find.mockResolvedValue([subscription]);
    letterRepository.find.mockResolvedValue([
      {
        uuid: 'letter-1',
        inactiveAfterMinutes: 30,
        lastTriggeredAt: null,
        user: subscription.user,
        contacts: [{ email: 'person@example.com' }],
      },
    ]);
    checkInRepository.findOne.mockResolvedValue(null);

    await expect(service.processNotifications(new Date('2026-05-13T10:10:00Z'))).resolves.toEqual({
      checked: 1,
      sent: 0,
    });
    expect(notificationService.send).not.toHaveBeenCalled();
  });
});
