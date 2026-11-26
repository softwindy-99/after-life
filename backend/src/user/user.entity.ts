import { Auth } from 'src/auth/auth.entity';
import { Contact } from 'src/contact/contact.entity';
import { BaseTable } from 'src/entity';
import { Letter } from 'src/letter/letter.entity';
import { Role } from 'src/role/role.entity';
import { Entity, Column, Index, OneToMany, ManyToOne } from 'typeorm';

@Entity()
export class User extends BaseTable {
  /**
   * real name
   */
  @Column({ length: 50 })
  username: string;

  /**
   * password for login
   */
  @Column({ length: 256, select: false })
  password: string;

  /**
   * email for login and find password
   */
  @Index({ unique: true })
  @Column({ length: 50 })
  email: string;

  /**
   * avatar image encoded as base64
   *
   * Keep this large column out of default queries to avoid slowing down user
   * lists and profile queries.
   */
  @Column({ type: 'mediumtext', nullable: true, select: false })
  avatar?: string;

  /**
   * auths
   */
  @OneToMany(() => Auth, (auth) => auth.user)
  auths: Auth[];

  /**
   * user role
   */
  @ManyToOne(() => Role, (role) => role.users, { nullable: false, eager: true })
  role: Role;

  /**
   * letters
   */
  @OneToMany(() => Letter, (letter) => letter.user)
  letters: Letter[];

  /**
   * contacts
   */
  @OneToMany(() => Contact, (contact) => contact.user)
  contacts: Contact[];
}
