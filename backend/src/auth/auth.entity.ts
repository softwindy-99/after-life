import type { McpScope } from './auth.d';
import { BaseTable } from 'src/entity';
import { User } from 'src/user/user.entity';
import { Entity, Column, Index, ManyToOne } from 'typeorm';

@Entity()
@Index(['iSdelete', 'createdAt'])
export class Auth extends BaseTable {
  @Index({ unique: true })
  @Column({ length: 64, nullable: true })
  tokenHash: string;

  @Column({ type: 'text' })
  token: string;

  @Column({ length: 80, nullable: true })
  mcpName: string | null;

  @Column({ type: 'json', nullable: true })
  mcpScopes: McpScope[] | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  mcpExpiresAt: Date | null;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  mcpLastUsedAt: Date | null;

  @ManyToOne(() => User, (user) => user.auths)
  user: User;
}
