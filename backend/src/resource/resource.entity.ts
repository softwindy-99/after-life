import { BaseTable } from 'src/entity';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { StorageDriver } from './storage-config';

@Entity()
@Index(['iSdelete', 'createdAt'])
export class Resource extends BaseTable {
  @Column({ length: 255 })
  filename: string;

  @Column({ length: 100 })
  mimeType: string;

  @Column({ type: 'bigint' })
  sizeBytes: number;

  @Column({ length: 16, default: 'local' })
  storageDriver: StorageDriver;

  @Column({ length: 64, nullable: true })
  storageTarget: string | null;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @ManyToOne(() => Letter, { nullable: true })
  letter?: Letter | null;
}
