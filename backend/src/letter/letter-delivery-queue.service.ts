import { lockOwnedUser } from 'src/correspondence/transaction';
import { User } from 'src/user/user.entity';
import { schedulerInterval } from 'src/config/scheduler-interval';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Contact } from 'src/contact/contact.entity';
import { LetterDelivery } from 'src/letter-delivery/letter-delivery.entity';
import { MailService } from 'src/mail/mail.service';
import { Repository } from 'typeorm';
import { Letter } from './letter.entity';
import { plainLetterText, resourceUuids } from './letter-content';
import { ResourceService } from 'src/resource/resource.service';
import { letterRetentionDays } from 'src/config/letter-retention';

@Injectable()
export class LetterDeliveryQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LetterDeliveryQueueService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Letter)
    private readonly letterRepository: Repository<Letter>,
    private readonly mailService: MailService,
    private readonly resourceService: ResourceService,
  ) {}

  onModuleInit(): void {
    const intervalMs = schedulerInterval(
      process.env.LETTER_STATUS_CHECK_INTERVAL_MS,
      'LETTER_STATUS_CHECK_INTERVAL_MS',
    );
    this.timer = setInterval(() => {
      void this.processDueLetters();
    }, intervalMs);
    void this.processDueLetters();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueLetters(now = new Date()): Promise<{
    checked: number;
    sent: number;
    failed: number;
  }> {
    if (!this.mailService.isConfigured()) {
      return { checked: 0, sent: 0, failed: 0 };
    }

    if (this.running) return { checked: 0, sent: 0, failed: 0 };
    this.running = true;

    try {
      const letters = await this.letterRepository.find({
        where: {
          iSdelete: 0,
          deliveryEnabled: true,
        },
        relations: { user: true, contacts: true },
      });

      let sent = 0;
      let failed = 0;

      for (const candidate of letters) {
        if (!this.isLetterTriggerable(candidate)) continue;
        // The user lock serializes check-ins, edits, recipient changes and SMTP.
        // Re-read inside the transaction; the outer scan is only a candidate list.
        const result = await this.letterRepository.manager.transaction(async (manager) => {
          await lockOwnedUser(manager.getRepository(User), candidate.user.uuid);
          const contacts = manager.getRepository(Contact);
          const linked = await contacts.find({
            where: {
              letters: { uuid: candidate.uuid },
              user: { uuid: candidate.user.uuid },
              iSdelete: 0,
            },
            select: { id: true },
            order: { id: 'ASC' },
            loadEagerRelations: false,
          });
          for (const contact of linked)
            await contacts.findOne({
              where: { id: contact.id },
              lock: { mode: 'pessimistic_write' },
            });
          const letters = manager.getRepository(Letter);
          const letter = await letters.findOne({
            where: {
              uuid: candidate.uuid,
              iSdelete: 0,
              deliveryEnabled: true,
              user: { uuid: candidate.user.uuid, iSdelete: 0 },
            },
            relations: { user: true, contacts: true },
            lock: { mode: 'pessimistic_write' },
          });
          if (
            !letter ||
            !this.isLetterTriggerable(letter) ||
            !(await this.isUserInactive(letter, now, manager.getRepository(CheckIn)))
          )
            return { sent: 0, failed: 0 };
          const result = await this.deliverLetter(letter, manager.getRepository(LetterDelivery));
          if (result.complete && (result.sent > 0 || !letter.lastTriggeredAt)) {
            // Update only the delivery marker, never save an outer-scan snapshot.
            await letters.update({ id: letter.id }, { lastTriggeredAt: now });
          }
          return result;
        });
        sent += result.sent;
        failed += result.failed;
      }

      return { checked: letters.length, sent, failed };
    } catch (error) {
      this.logger.error(
        `letter delivery queue failed: ${error instanceof Error ? error.message : error}`,
      );
      return { checked: 0, sent: 0, failed: 1 };
    } finally {
      this.running = false;
    }
  }

  private isLetterTriggerable(letter: Letter): boolean {
    return (
      Boolean(letter.user) &&
      letter.user.iSdelete !== 1 &&
      Boolean(letter.inactiveAfterMinutes) &&
      Number(letter.inactiveAfterMinutes) > 0 &&
      Array.isArray(letter.contacts) &&
      letter.contacts.some((contact) => contact.iSdelete !== 1 && Boolean(contact.email))
    );
  }

  private async isUserInactive(
    letter: Letter,
    now: Date,
    checkIns: Repository<CheckIn>,
  ): Promise<boolean> {
    const latestCheckIn = await checkIns.findOne({
      where: { user: { uuid: letter.user.uuid }, iSdelete: 0 },
      order: { checkedAt: 'DESC' },
    });
    const lastSeenAt = latestCheckIn?.checkedAt ?? letter.user.createdAt;
    if (!lastSeenAt) return false;

    const inactiveMs = Number(letter.inactiveAfterMinutes) * 60 * 1000;
    return lastSeenAt.getTime() <= now.getTime() - inactiveMs;
  }

  private async deliverLetter(
    letter: Letter,
    deliveries: Repository<LetterDelivery>,
  ): Promise<{
    sent: number;
    failed: number;
    complete: boolean;
  }> {
    let sent = 0;
    let failed = 0;
    let eligible = 0;

    for (const contact of letter.contacts) {
      if (contact.iSdelete === 1 || !contact.email) continue;
      eligible += 1;
      if (await this.hasSuccessfulDelivery(letter, contact, deliveries)) continue;

      try {
        const result = await this.mailService.sendNotification({
          to: contact.email,
          subject: letter.title,
          text: plainLetterText(letter.content, letter.contentFormat),
          ...(letter.contentFormat === 'html' ? { html: this.deliveryHtml(letter) } : {}),
        });
        if (
          !result.accepted.some(
            (accepted) => accepted.toLowerCase() === contact.email.toLowerCase(),
          )
        ) {
          throw new Error('recipient was not accepted by mail transport');
        }
        await this.saveDelivery(letter, contact, 'sent', undefined, deliveries);
        sent += 1;
      } catch (error) {
        await this.saveDelivery(
          letter,
          contact,
          'failed',
          error instanceof Error ? error.message : String(error),
          deliveries,
        );
        failed += 1;
      }
    }

    return { sent, failed, complete: eligible > 0 && failed === 0 };
  }

  private deliveryHtml(letter: Letter): string | undefined {
    if (letter.contentFormat !== 'html') return undefined;
    const uuids = resourceUuids(letter.content);
    if (uuids.length === 0) return letter.content;
    let base: string;
    try {
      const configured = new URL(process.env.PUBLIC_BASE_URL || '');
      if (configured.protocol !== 'https:' || configured.username || configured.password) {
        throw new Error();
      }
      base = `${configured.origin}${configured.pathname.replace(/\/+$/, '')}`;
    } catch {
      throw new Error('PUBLIC_BASE_URL must be an HTTPS URL to deliver local resources');
    }
    const days = letterRetentionDays();
    return letter.content.replace(/\/resource\/([0-9a-f-]{36})(?=["'])/gi, (_match, uuid: string) =>
      `${base}${this.resourceService.signedPath(uuid, days * 86400)}`.replace(/&/g, '&amp;'),
    );
  }

  private async hasSuccessfulDelivery(
    letter: Letter,
    contact: Contact,
    deliveries: Repository<LetterDelivery>,
  ): Promise<boolean> {
    const existing = await deliveries.findOne({
      where: {
        letter: { uuid: letter.uuid },
        contact: { uuid: contact.uuid },
        status: 'sent',
        iSdelete: 0,
      },
    });
    return Boolean(existing);
  }

  private async saveDelivery(
    letter: Letter,
    contact: Contact,
    status: 'sent' | 'failed',
    error: string | undefined,
    deliveries: Repository<LetterDelivery>,
  ): Promise<void> {
    await deliveries.save(
      deliveries.create({
        letter,
        contact,
        user: letter.user,
        recipient: contact.email,
        status,
        error: error?.slice(0, 255) || null,
        sentAt: status === 'sent' ? new Date() : null,
      }),
    );
  }
}
