import { BaseTable } from 'src/entity';
import { Contact } from 'src/contact/contact.entity';
import { User } from 'src/user/user.entity';
import { Entity, Column, Index, ManyToMany, ManyToOne } from 'typeorm';

@Entity()
@Index(['iSdelete', 'createdAt'])
export class Letter extends BaseTable {
  /**
   * title
   */
  @Column({ length: 120 })
  title: string;

  /**
   * Sanitized rich HTML body. Legacy markdown/plain_text rows remain readable.
   */
  @Column({ type: 'longtext' })
  content: string;

  /**
   * current body storage format
   */
  @Column({ length: 20, default: 'html' })
  contentFormat: string;

  /**
   * preview text for list pages
   */
  @Column({ length: 255, default: '' })
  excerpt: string;

  /**
   * resource placeholder for future cover/media binding
   */
  @Column({ length: 36, nullable: true })
  coverResourceUuid?: string | null;

  /**
   * number of related resources reserved for future media support
   */
  @Column({ default: 0 })
  resourceCount: number;

  /**
   * redundant extension field for future associations
   */
  @Column({ type: 'simple-json', nullable: true })
  extra?: Record<string, unknown> | null;

  @Column({ default: false })
  deliveryEnabled: boolean;

  @Column({ nullable: true })
  inactiveAfterMinutes?: number | null;

  @Column({ nullable: true })
  lastTriggeredAt?: Date | null;

  /**
   * owner
   */
  @ManyToOne(() => User, (user) => user.letters, { nullable: false })
  user: User;

  @ManyToMany(() => Contact, (contact) => contact.letters)
  contacts: Contact[];
}
