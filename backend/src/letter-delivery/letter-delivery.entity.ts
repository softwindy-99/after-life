import { Contact } from 'src/contact/contact.entity';
import { BaseTable } from 'src/entity';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

export type LetterDeliveryStatus = 'sent' | 'failed';

@Entity()
@Index(['iSdelete', 'status', 'createdAt'])
export class LetterDelivery extends BaseTable {
  @Column({ length: 20 })
  status: LetterDeliveryStatus;

  @Column({ length: 255 })
  recipient: string;

  @Column({ length: 255, nullable: true })
  error?: string | null;

  @Column({ nullable: true })
  sentAt?: Date | null;

  @ManyToOne(() => Letter, { nullable: false })
  letter: Letter;

  @ManyToOne(() => Contact, { nullable: false })
  contact: Contact;

  @ManyToOne(() => User, { nullable: false })
  user: User;
}
