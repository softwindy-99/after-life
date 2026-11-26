import { BaseTable } from 'src/entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

@Entity()
@Index(['iSdelete', 'checkedAt'])
export class CheckIn extends BaseTable {
  @Column()
  checkedAt: Date;

  @Column({ length: 120, nullable: true })
  source?: string | null;

  @Index({ unique: true })
  @Column({ length: 64, nullable: true })
  eventKey: string | null;

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
