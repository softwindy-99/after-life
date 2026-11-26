import { SchemaPipe } from 'src/validation';
import {
  subscriptionStatusSchema,
  registerSubscriptionSchema,
  updatePreferencesSchema,
  removeSubscriptionSchema,
} from './notification.schema';
import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { Self } from 'src/permission/permission.decorator';
import { NotificationService } from './notification.service';
import {
  NotificationPreferencesInput,
  PushSubscriptionInput,
  PushSubscriptionRemovalInput,
  PushSubscriptionStatus,
} from './notification.types';

@Self()
@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('config')
  config(): { publicKey: string; configured: boolean } {
    return this.notificationService.getConfig();
  }

  @Post('subscription/status')
  status(
    @Req() request: Request,
    @Body(new SchemaPipe(subscriptionStatusSchema)) body: { endpoint: string },
  ): Promise<PushSubscriptionStatus> {
    return this.notificationService.getStatus(request.user.uuid, body.endpoint);
  }

  @Post('subscription')
  register(
    @Req() request: Request,
    @Body(new SchemaPipe(registerSubscriptionSchema))
    body: {
      subscription: PushSubscriptionInput;
      preferences?: NotificationPreferencesInput;
    },
  ): Promise<PushSubscriptionStatus> {
    return this.notificationService.register(
      request.user.uuid,
      body.subscription,
      body.preferences,
    );
  }

  @Put('subscription/preferences')
  updatePreferences(
    @Req() request: Request,
    @Body(new SchemaPipe(updatePreferencesSchema))
    body: { endpoint: string; preferences: NotificationPreferencesInput },
  ): Promise<PushSubscriptionStatus> {
    return this.notificationService.updatePreferences(
      request.user.uuid,
      body.endpoint,
      body.preferences,
    );
  }

  @Delete('subscription')
  @HttpCode(204)
  remove(
    @Req() request: Request,
    @Body(new SchemaPipe(removeSubscriptionSchema)) body: PushSubscriptionRemovalInput,
  ): Promise<void> {
    return this.notificationService.remove(request.user.uuid, body);
  }
}
