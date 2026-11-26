import { BaseTable } from 'src/entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

@Entity('push_subscription')
@Index(['endpointHash'], { unique: true })
@Index(['iSdelete', 'user'])
export class PushSubscriptionRecord extends BaseTable {
  @Column({ length: 64 })
  endpointHash: string;

  @Column({ type: 'text' })
  endpoint: string;

  @Column({ length: 255 })
  p256dh: string;

  @Column({ length: 255 })
  auth: string;

  @Column({ default: true })
  dailyReminderEnabled: boolean;

  @Column({ length: 5, default: '09:00' })
  dailyReminderTime: string;

  @Column({ length: 64, default: 'UTC' })
  timezone: string;

  @Column({ default: true })
  letterWarningEnabled: boolean;

  @Column({ default: 60 })
  letterWarningMinutes: number;

  @Column({ length: 10, nullable: true })
  lastDailyReminderDate?: string | null;

  @Column({ length: 64, nullable: true })
  lastLetterWarningKey?: string | null;

  @Column({ default: 0 })
  deliveryFailureCount: number;

  @Column({ type: 'datetime', nullable: true })
  firstDeliveryFailureAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastDeliveryFailureAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastDeliverySuccessAt?: Date | null;

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
