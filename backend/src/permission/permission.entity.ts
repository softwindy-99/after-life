import { BaseTable } from 'src/entity';
import { Role } from 'src/role/role.entity';
import { Entity, Column, Index, ManyToMany } from 'typeorm';

@Entity()
export class Permission extends BaseTable {
  @Column({ length: 50 })
  @Index({ unique: true })
  name: string;

  @Column({ length: 255 })
  description: string;

  @ManyToMany(() => Role, (role) => role.permissions)
  roles: Role[];
}
