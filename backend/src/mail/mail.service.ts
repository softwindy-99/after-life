import { BadRequestException, Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { SentMessageInfo } from 'nodemailer';
import { readEnvFile } from '../setup/env';
import { RuntimeConfigWriter } from '../setup/runtime-config.writer';
import {
  MailConfigStatus,
  SendMailNotification,
  SendMailResult,
  UpdateMailConfig,
} from './mail.types';

const REQUIRED_MAIL_KEYS = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD'] as const;

const MAIL_NOT_CONFIGURED_MESSAGE =
  'Mail server is not configured. Complete mail settings before sending email.';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configWriter: RuntimeConfigWriter,
  ) {}

  isConfigured(): boolean {
    return this.getConfigStatus().configured;
  }

  getConfigStatus(): MailConfigStatus {
    const missingKeys = REQUIRED_MAIL_KEYS.filter((key) => !process.env[key]?.trim());
    const port = Number(process.env.MAIL_PORT);
    const secure = process.env.MAIL_SECURE === 'true' || Number(process.env.MAIL_PORT) === 465;

    return {
      host: process.env.MAIL_HOST || '',
      port: Number.isFinite(port) ? port : 0,
      secure,
      user: process.env.MAIL_USER || '',
      from: this.getDefaultFrom(),
      configured: missingKeys.length === 0 && Number.isFinite(port) && port > 0,
      missingKeys,
    };
  }

  async updateConfig(payload: UpdateMailConfig): Promise<MailConfigStatus> {
    const currentEnv = readEnvFile();
    const host = this.normalizeConfigValue(payload?.host, 'host');
    const user = this.normalizeConfigValue(payload?.user, 'user');
    const from = this.normalizeConfigValue(payload?.from ?? '', 'from', false);
    const port = Number(payload?.port);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('port must be an integer between 1 and 65535');
    }
    if (typeof payload?.secure !== 'boolean') {
      throw new BadRequestException('secure must be a boolean');
    }

    const submittedPassword = this.normalizeConfigValue(payload?.password ?? '', 'password', false);
    const password = this.normalizeConfigValue(
      submittedPassword || process.env.MAIL_PASSWORD || currentEnv.MAIL_PASSWORD || '',
      'password',
    );

    const mailEnv = {
      MAIL_HOST: host,
      MAIL_PORT: String(port),
      MAIL_USER: user,
      MAIL_PASSWORD: password,
      MAIL_FROM: from,
      MAIL_SECURE: String(payload.secure),
    };

    await this.configWriter.update(mailEnv);
    return this.getConfigStatus();
  }

  async verifyTransport(): Promise<{ ok: boolean }> {
    this.ensureConfigured();
    const ok = await this.mailerService.verifyAllTransporters();
    return { ok };
  }

  async sendTestMail(to: string): Promise<SendMailResult> {
    const recipient = this.normalizeRecipient(to);
    return this.sendNotification({
      to: recipient,
      subject: 'After Life 邮件配置测试',
      text: '如果你收到了这封邮件，说明 After Life Server 的邮件发送配置已经生效。',
    });
  }

  async sendNotification(notification: SendMailNotification): Promise<SendMailResult> {
    this.ensureConfigured();
    const recipients = this.normalizeRecipients(notification.to);
    const subject = notification.subject?.trim();
    const text = notification.text?.trim();
    const html = notification.html?.trim();

    if (!subject) throw new BadRequestException('subject is required');
    if (!text && !html) {
      throw new BadRequestException('text or html is required');
    }

    const result = await this.mailerService.sendMail({
      to: recipients,
      subject,
      text,
      html,
    });

    return this.toSendMailResult(result);
  }

  private getDefaultFrom(): string {
    return process.env.MAIL_FROM || `No Reply <${process.env.MAIL_USER || ''}>`;
  }

  private normalizeConfigValue(value: unknown, field: string, required = true): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} must be a string`);
    }

    const normalized = value.trim();
    if (required && !normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    if (/[\r\n]/.test(normalized)) {
      throw new BadRequestException(`${field} must not contain line breaks`);
    }
    return normalized;
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new BadRequestException(MAIL_NOT_CONFIGURED_MESSAGE);
    }
  }

  private normalizeRecipients(to: string | string[]): string[] {
    const recipients = Array.isArray(to) ? to : [to];
    const normalized = recipients.map((recipient) => this.normalizeRecipient(recipient));

    if (normalized.length === 0) {
      throw new BadRequestException('to is required');
    }

    return [...new Set(normalized)];
  }

  private normalizeRecipient(to: string): string {
    const recipient = typeof to === 'string' ? to.trim() : '';
    if (!recipient) throw new BadRequestException('to is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new BadRequestException('to must be a valid email address');
    }
    return recipient;
  }

  private toSendMailResult(result: SentMessageInfo): SendMailResult {
    return {
      accepted: this.normalizeAddressList(result.accepted),
      rejected: this.normalizeAddressList(result.rejected),
      messageId: result.messageId,
    };
  }

  private normalizeAddressList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item));
  }
}
