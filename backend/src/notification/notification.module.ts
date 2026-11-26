import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from 'src/check-in/check-in.entity';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { NotificationController } from './notification.controller';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationService } from './notification.service';
import { PushSubscriptionRecord } from './push-subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscriptionRecord, User, CheckIn, Letter])],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationSchedulerService],
})
export class NotificationModule {}
