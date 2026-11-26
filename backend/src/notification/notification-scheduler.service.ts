import { schedulerInterval } from 'src/config/scheduler-interval';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Letter } from 'src/letter/letter.entity';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { PushSubscriptionRecord } from './push-subscription.entity';

@Injectable()
export class NotificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(PushSubscriptionRecord)
    private readonly subscriptionRepository: Repository<PushSubscriptionRecord>,
    @InjectRepository(CheckIn)
    private readonly checkInRepository: Repository<CheckIn>,
    @InjectRepository(Letter)
    private readonly letterRepository: Repository<Letter>,
    private readonly notificationService: NotificationService,
  ) {}

  onModuleInit(): void {
    const intervalMs = schedulerInterval(
      process.env.NOTIFICATION_CHECK_INTERVAL_MS,
      'NOTIFICATION_CHECK_INTERVAL_MS',
    );
    this.timer = setInterval(() => void this.processNotifications(), intervalMs);
    void this.processNotifications();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processNotifications(now = new Date()): Promise<{
    checked: number;
    sent: number;
  }> {
    if (this.running) return { checked: 0, sent: 0 };
    this.running = true;

    try {
      await this.subscriptionRepository.delete({ iSdelete: 1 });
      const subscriptions = await this.subscriptionRepository.find({
        where: { iSdelete: 0 },
        relations: { user: true },
      });
      if (!subscriptions.length) return { checked: 0, sent: 0 };

      const letters = await this.letterRepository.find({
        where: { iSdelete: 0, deliveryEnabled: true },
        relations: { user: true, contacts: true },
      });
      const latestCheckIns = new Map<string, CheckIn | null>();
      let sent = 0;

      for (const subscription of subscriptions) {
        const userUuid = subscription.user.uuid;
        if (!latestCheckIns.has(userUuid)) {
          latestCheckIns.set(
            userUuid,
            await this.checkInRepository.findOne({
              where: { user: { uuid: userUuid }, iSdelete: 0 },
              order: { checkedAt: 'DESC' },
            }),
          );
        }
        const latestCheckIn = latestCheckIns.get(userUuid) || null;

        if (await this.sendDailyReminder(subscription, latestCheckIn, now)) sent += 1;
        if (
          await this.sendLetterWarning(
            subscription,
            letters.filter((letter) => letter.user?.uuid === userUuid),
            latestCheckIn,
            now,
          )
        ) {
          sent += 1;
        }
      }
      return { checked: subscriptions.length, sent };
    } catch (error) {
      this.logger.error(
        `notification scheduler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { checked: 0, sent: 0 };
    } finally {
      this.running = false;
    }
  }

  private async sendDailyReminder(
    subscription: PushSubscriptionRecord,
    latestCheckIn: CheckIn | null,
    now: Date,
  ): Promise<boolean> {
    if (!subscription.dailyReminderEnabled) return false;
    const localNow = this.localDateTime(now, subscription.timezone);
    if (
      localNow.time < subscription.dailyReminderTime ||
      subscription.lastDailyReminderDate === localNow.date ||
      (latestCheckIn &&
        this.localDateTime(latestCheckIn.checkedAt, subscription.timezone).date === localNow.date)
    ) {
      return false;
    }

    const sent = await this.notificationService.send(subscription, {
      title: '今天还没有签到',
      body: '花几秒确认你一切安好，持续签到会延后信件自动投递。',
      url: '/checkin',
      tag: `daily-check-in-${localNow.date}`,
    });
    if (sent) {
      subscription.lastDailyReminderDate = localNow.date;
      await this.subscriptionRepository.save(subscription);
    }
    return sent;
  }

  private async sendLetterWarning(
    subscription: PushSubscriptionRecord,
    letters: Letter[],
    latestCheckIn: CheckIn | null,
    now: Date,
  ): Promise<boolean> {
    if (!subscription.letterWarningEnabled) return false;
    const lastSeenAt = latestCheckIn?.checkedAt ?? subscription.user.createdAt;
    if (!lastSeenAt) return false;

    const warningWindowMs = subscription.letterWarningMinutes * 60 * 1000;
    const upcoming = letters
      .flatMap((letter) => {
        if (
          !letter.inactiveAfterMinutes ||
          Number(letter.inactiveAfterMinutes) <= 0 ||
          letter.lastTriggeredAt ||
          !letter.contacts?.some((contact) => contact.iSdelete !== 1 && Boolean(contact.email))
        ) {
          return [];
        }
        const dueAt = new Date(
          lastSeenAt.getTime() + Number(letter.inactiveAfterMinutes) * 60 * 1000,
        );
        const remainingMs = dueAt.getTime() - now.getTime();
        return remainingMs > 0 && remainingMs <= warningWindowMs ? [{ letter, dueAt }] : [];
      })
      .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());

    if (!upcoming.length) return false;
    const warningKey = createHash('sha256')
      .update(
        upcoming.map(({ letter, dueAt }) => `${letter.uuid}:${dueAt.toISOString()}`).join('|'),
      )
      .digest('hex');
    if (subscription.lastLetterWarningKey === warningKey) return false;

    const first = upcoming[0];
    const minutes = Math.max(1, Math.ceil((first.dueAt.getTime() - now.getTime()) / 60000));
    const sent = await this.notificationService.send(subscription, {
      title: upcoming.length === 1 ? '信件即将自动发送' : `${upcoming.length} 封信件即将自动发送`,
      body:
        upcoming.length === 1
          ? `《${first.letter.title}》预计将在 ${minutes} 分钟后触发，签到可以延后发送。`
          : `最早的《${first.letter.title}》预计将在 ${minutes} 分钟后触发。`,
      url: '/letters',
      tag: `letter-warning-${warningKey.slice(0, 16)}`,
    });
    if (sent) {
      subscription.lastLetterWarningKey = warningKey;
      await this.subscriptionRepository.save(subscription);
    }
    return sent;
  }

  private localDateTime(date: Date, timezone: string): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value || '';
    return {
      date: `${value('year')}-${value('month')}-${value('day')}`,
      time: `${value('hour')}:${value('minute')}`,
    };
  }
}
