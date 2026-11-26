import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BaseTable } from 'src/entity';
import { User } from 'src/user/user.entity';

@Entity()
@Index(['user', 'createdAt'])
export class McpActivity extends BaseTable {
  @Column({ length: 36 })
  authUuid: string;

  @Column({ length: 80 })
  tool: string;

  @Column({ length: 36, nullable: true })
  resourceUuid: string | null;

  @Column({ length: 16 })
  outcome: string;

  // Only allowlisted metadata; never bodies, file data, bearer values or contact methods.
  @Column({ type: 'json', nullable: true })
  details: {
    expectedUpdatedAt?: string;
    inactiveAfterMinutes?: number;
    dueAt?: string;
    resourceCount?: number;
    contactCount?: number;
  } | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  expiresAt: Date | null;

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
