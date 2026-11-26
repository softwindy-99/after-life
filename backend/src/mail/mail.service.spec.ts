import { BadRequestException } from '@nestjs/common';
import * as setupEnv from '../setup/env';
import { MailService } from './mail.service';
import { RuntimeConfigWriter } from '../setup/runtime-config.writer';

describe('MailService', () => {
  let service: MailService;
  let mailerService: {
    verifyAllTransporters: jest.Mock;
    sendMail: jest.Mock;
  };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      MAIL_HOST: 'smtp.example.com',
      MAIL_PORT: '587',
      MAIL_USER: 'no-reply@example.com',
      MAIL_PASSWORD: 'password',
    };
    mailerService = {
      verifyAllTransporters: jest.fn(),
      sendMail: jest.fn(),
    };
    service = new MailService(mailerService as any, new RuntimeConfigWriter());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  it('returns sanitized mail config status', () => {
    expect(service.getConfigStatus()).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'no-reply@example.com',
      from: 'No Reply <no-reply@example.com>',
      configured: true,
      missingKeys: [],
    });
  });

  it('reports missing mail config keys', () => {
    process.env.MAIL_PASSWORD = '';

    expect(service.getConfigStatus()).toMatchObject({
      configured: false,
      missingKeys: ['MAIL_PASSWORD'],
    });
  });

  it('saves normalized mail config while preserving an existing password', async () => {
    process.env.MAIL_PASSWORD = '';
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();
    const applyEnvUpdates = jest.spyOn(setupEnv, 'applyEnvUpdates').mockImplementation((env) => {
      Object.assign(process.env, env);
    });
    jest.spyOn(setupEnv, 'readEnvFile').mockReturnValue({
      MAIL_PASSWORD: 'existing-password',
    });

    await expect(
      service.updateConfig({
        host: ' smtp.example.net ',
        port: 465,
        secure: true,
        user: ' mailer@example.net ',
        password: '',
        from: ' After Life <mailer@example.net> ',
      }),
    ).resolves.toEqual({
      host: 'smtp.example.net',
      port: 465,
      secure: true,
      user: 'mailer@example.net',
      from: 'After Life <mailer@example.net>',
      configured: true,
      missingKeys: [],
    });

    const expectedEnv = {
      MAIL_HOST: 'smtp.example.net',
      MAIL_PORT: '465',
      MAIL_USER: 'mailer@example.net',
      MAIL_PASSWORD: 'existing-password',
      MAIL_FROM: 'After Life <mailer@example.net>',
      MAIL_SECURE: 'true',
    };
    expect(writeEnvFile).toHaveBeenCalledWith(expectedEnv);
    expect(applyEnvUpdates).toHaveBeenCalledWith(expectedEnv);
  });

  it.each([
    [{ host: '', port: 587, secure: false, user: 'mailer@example.net', password: 'secret' }],
    [
      {
        host: 'smtp.example.net',
        port: 0,
        secure: false,
        user: 'mailer@example.net',
        password: 'secret',
      },
    ],
    [
      {
        host: 'smtp.example.net',
        port: 587,
        secure: 'false',
        user: 'mailer@example.net',
        password: 'secret',
      },
    ],
    [
      {
        host: 'smtp.example.net\nMAIL_HOST=attacker',
        port: 587,
        secure: false,
        user: 'mailer@example.net',
        password: 'secret',
      },
    ],
  ])('rejects invalid mail config without writing it', async (payload) => {
    const writeEnvFile = jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation();
    jest.spyOn(setupEnv, 'readEnvFile').mockReturnValue({});

    await expect(service.updateConfig(payload as any)).rejects.toThrow(BadRequestException);
    expect(writeEnvFile).not.toHaveBeenCalled();
  });

  it('requires a password when no saved password exists', async () => {
    jest.spyOn(setupEnv, 'readEnvFile').mockReturnValue({});
    process.env.MAIL_PASSWORD = '';

    await expect(
      service.updateConfig({
        host: 'smtp.example.net',
        port: 587,
        secure: false,
        user: 'mailer@example.net',
      }),
    ).rejects.toThrow('password is required');
  });

  it('rejects send and verify operations when mail is not configured', async () => {
    process.env.MAIL_PASSWORD = '';

    await expect(service.verifyTransport()).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sendTestMail('alice@example.com')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mailerService.verifyAllTransporters).not.toHaveBeenCalled();
    expect(mailerService.sendMail).not.toHaveBeenCalled();
  });

  it('verifies mail transport', async () => {
    mailerService.verifyAllTransporters.mockResolvedValue(true);

    await expect(service.verifyTransport()).resolves.toEqual({ ok: true });
  });

  it('sends test mail to the requested recipient', async () => {
    mailerService.sendMail.mockResolvedValue({
      accepted: ['alice@example.com'],
      rejected: [],
      messageId: 'message-1',
    });

    await expect(service.sendTestMail(' alice@example.com ')).resolves.toEqual({
      accepted: ['alice@example.com'],
      rejected: [],
      messageId: 'message-1',
    });

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: ['alice@example.com'],
      subject: 'After Life 邮件配置测试',
      text: '如果你收到了这封邮件，说明 After Life Server 的邮件发送配置已经生效。',
      html: undefined,
    });
  });

  it('sends notification mail to unique recipients', async () => {
    mailerService.sendMail.mockResolvedValue({
      accepted: ['alice@example.com', 'bob@example.com'],
      rejected: [],
    });

    await service.sendNotification({
      to: ['alice@example.com', 'bob@example.com', 'alice@example.com'],
      subject: 'Notice',
      text: 'Hello',
    });

    expect(mailerService.sendMail).toHaveBeenCalledWith({
      to: ['alice@example.com', 'bob@example.com'],
      subject: 'Notice',
      text: 'Hello',
      html: undefined,
    });
  });

  it('rejects notification without content', async () => {
    await expect(
      service.sendNotification({
        to: 'alice@example.com',
        subject: 'Notice',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid recipient', async () => {
    await expect(service.sendTestMail('not-an-email')).rejects.toBeInstanceOf(BadRequestException);
  });
});
