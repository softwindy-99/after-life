import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Permission as NeedPermission } from 'src/permission/permission.decorator';
import { ApplicationRestartService } from '../setup/application-restart.service';
import {
  MailConfigStatus,
  SendMailNotification,
  SendMailResult,
  UpdateMailConfig,
} from './mail.types';
import { MailService } from './mail.service';

@Controller('mail')
@NeedPermission('admin')
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly applicationRestartService: ApplicationRestartService,
  ) {}

  @Get('config')
  getConfig(): MailConfigStatus {
    return this.mailService.getConfigStatus();
  }

  @Put('config')
  async updateConfig(@Body() body: UpdateMailConfig): Promise<MailConfigStatus> {
    const config = await this.mailService.updateConfig(body);
    this.applicationRestartService.scheduleRestart();
    return config;
  }

  @Post('test')
  sendTest(@Body() body: { to?: string }): Promise<SendMailResult> {
    return this.mailService.sendTestMail(body.to);
  }

  @Post('notify')
  notify(@Body() body: SendMailNotification): Promise<SendMailResult> {
    return this.mailService.sendNotification(body);
  }

  @Post('verify')
  verify(): Promise<{ ok: boolean }> {
    return this.mailService.verifyTransport();
  }
}
