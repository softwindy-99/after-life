import { BadRequestException } from '@nestjs/common';
import { ApplicationRestartService } from '../setup/application-restart.service';
import { MailController } from './mail.controller';

describe('MailController', () => {
  let controller: MailController;
  let mailService: {
    getConfigStatus: jest.Mock;
    updateConfig: jest.Mock;
    sendTestMail: jest.Mock;
    sendNotification: jest.Mock;
    verifyTransport: jest.Mock;
  };
  let restartService: { scheduleRestart: jest.Mock };

  beforeEach(() => {
    mailService = {
      getConfigStatus: jest.fn(),
      updateConfig: jest.fn(),
      sendTestMail: jest.fn(),
      sendNotification: jest.fn(),
      verifyTransport: jest.fn(),
    };
    restartService = { scheduleRestart: jest.fn() };
    controller = new MailController(
      mailService as any,
      restartService as unknown as ApplicationRestartService,
    );
  });

  it('returns mail config status', () => {
    const config = { configured: true };
    mailService.getConfigStatus.mockReturnValue(config);

    expect(controller.getConfig()).toBe(config);
  });

  it('saves mail config and schedules a restart', async () => {
    const payload = {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'mailer@example.com',
      password: 'secret',
    };
    const config = { configured: true };
    mailService.updateConfig.mockReturnValue(config);

    await expect(controller.updateConfig(payload)).resolves.toBe(config);
    expect(mailService.updateConfig).toHaveBeenCalledWith(payload);
    expect(restartService.scheduleRestart).toHaveBeenCalledTimes(1);
  });

  it('does not restart when saving mail config fails', async () => {
    mailService.updateConfig.mockImplementation(() => {
      throw new BadRequestException('invalid config');
    });

    await expect(controller.updateConfig({} as any)).rejects.toThrow(BadRequestException);
    expect(restartService.scheduleRestart).not.toHaveBeenCalled();
  });

  it('sends test mail', async () => {
    const result = { accepted: ['alice@example.com'], rejected: [] as string[] };
    mailService.sendTestMail.mockResolvedValue(result);

    await expect(controller.sendTest({ to: 'alice@example.com' })).resolves.toBe(result);
    expect(mailService.sendTestMail).toHaveBeenCalledWith('alice@example.com');
  });

  it('sends notification mail', async () => {
    const payload = {
      to: 'alice@example.com',
      subject: 'Notice',
      text: 'Hello',
    };
    const result = { accepted: ['alice@example.com'], rejected: [] as string[] };
    mailService.sendNotification.mockResolvedValue(result);

    await expect(controller.notify(payload)).resolves.toBe(result);
    expect(mailService.sendNotification).toHaveBeenCalledWith(payload);
  });

  it('verifies mail transport', async () => {
    mailService.verifyTransport.mockResolvedValue({ ok: true });

    await expect(controller.verify()).resolves.toEqual({ ok: true });
  });
});
