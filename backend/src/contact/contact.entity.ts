import { BaseTable } from 'src/entity';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, JoinTable, ManyToMany, ManyToOne } from 'typeorm';

@Entity()
@Index(['iSdelete', 'createdAt'])
export class Contact extends BaseTable {
  @Column({ length: 80 })
  name: string;

  @Column({ length: 100, nullable: true })
  email?: string | null;

  @Column({ length: 30, nullable: true })
  phone?: string | null;

  @Column({ length: 255, nullable: true })
  note?: string | null;

  @Column({ length: 255, default: '' })
  displaySummary: string;

  @Column({ type: 'simple-json', nullable: true })
  extra?: Record<string, unknown> | null;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @ManyToMany(() => Letter, (letter) => letter.contacts, { eager: true })
  @JoinTable()
  letters: Letter[];
}
