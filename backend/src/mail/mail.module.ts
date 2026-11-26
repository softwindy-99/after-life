import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { SetupModule } from '../setup/setup.module';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

function isMailConfigured(): boolean {
  const port = Number(process.env.MAIL_PORT);

  return Boolean(
    process.env.MAIL_HOST?.trim() &&
      process.env.MAIL_PORT?.trim() &&
      process.env.MAIL_USER?.trim() &&
      process.env.MAIL_PASSWORD?.trim() &&
      Number.isFinite(port) &&
      port > 0,
  );
}

function getMailerTransport() {
  if (!isMailConfigured()) {
    return {
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    };
  }

  return {
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    secure: process.env.MAIL_SECURE === 'true' || Number(process.env.MAIL_PORT) === 465,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD,
    },
  };
}

@Module({
  imports: [
    SetupModule,
    MailerModule.forRootAsync({
      // Resolve transport after startup configuration is applied, including reloads.
      useFactory: () => ({
        transport: getMailerTransport(),
        defaults: {
          from: process.env.MAIL_FROM || `No Reply <${process.env.MAIL_USER || ''}>`,
        },
        preview: false,
      }),
    }),
  ],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
