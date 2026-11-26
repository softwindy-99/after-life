// 表结构基础类
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
@Entity()
export class BaseTable {
  /**
   * Primary key
   */
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * uuid
   */
  @PrimaryGeneratedColumn('uuid')
  uuid: string;

  /**
   * create time
   */
  @CreateDateColumn()
  createdAt: Date;

  /**
   * update time
   */
  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * delete flag
   * 0: not delete
   * 1: delete
   */
  @Column({ default: 0 })
  iSdelete: number;
}
