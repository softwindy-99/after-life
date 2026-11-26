import { BaseTable } from 'src/entity';
import { Permission } from 'src/permission/permission.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, JoinTable, ManyToMany, OneToMany } from 'typeorm';

@Entity()
export class Role extends BaseTable {
  @Index({ unique: true })
  @Column({ length: 50 })
  name: string;

  @Column({ length: 255 })
  description: string;

  @ManyToMany(() => Permission, (permission) => permission.roles, { eager: true })
  @JoinTable()
  permissions: Permission[];

  @OneToMany(() => User, (user) => user.role)
  users: User[];
}
