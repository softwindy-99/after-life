import { Test } from '@nestjs/testing';
import { MAILER_OPTIONS } from '@nestjs-modules/mailer/dist/constants/mailer.constant';
import { MailModule } from './mail.module';

describe('Mail transport startup and reload', () => {
  it('reads configuration at application creation rather than module import', async () => {
    const keys = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_SECURE'];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      for (const key of keys) delete process.env[key];
      const first = await Test.createTestingModule({ imports: [MailModule] }).compile();
      expect(first.get(MAILER_OPTIONS).transport.streamTransport).toBe(true);
      await first.close();
      Object.assign(process.env, {
        MAIL_HOST: 'smtp.example.com',
        MAIL_PORT: '465',
        MAIL_USER: 'test@example.com',
        MAIL_PASSWORD: 'test-only',
      });
      const second = await Test.createTestingModule({ imports: [MailModule] }).compile();
      expect(second.get(MAILER_OPTIONS).transport).toMatchObject({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
      });
      expect(second.get(MAILER_OPTIONS).transport.streamTransport).toBeUndefined();
      await second.close();
    } finally {
      for (const key of keys) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });
});
