import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AdminNewUser, AdminUpdateUser, NewUser, UpdateUser } from './user.types';
import { User } from './user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository, UpdateResult } from 'typeorm';
import { Role } from 'src/role/role.entity';
import { hashPassword } from 'src/auth/password';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly repository: Repository<User>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
  ) {}

  /**
   * @description Create a new user
   * @param {NewUser} newUser
   * @return {Promise<User>}
   */
  async create(newUser: NewUser): Promise<User> {
    const role = await this.roleRepository.findOne({
      where: { name: 'user', iSdelete: 0 },
      relations: { permissions: true },
    });
    if (!role) {
      throw new Error('default role user not found');
    }

    if (
      role.permissions?.some(
        (permission) => permission.name === 'admin' && permission.iSdelete === 0,
      )
    ) {
      throw new ForbiddenException(
        'Public registration requires a non-administrative default role.',
      );
    }
    const user = this.repository.create({
      username: newUser.username,
      email: newUser.email,
      password: await hashPassword(newUser.password),
      avatar: newUser.avatar,
      role,
    });
    return this.repository.save(user);
  }

  async createByAdmin(newUser: AdminNewUser): Promise<User> {
    const role = await this.roleRepository.findOne({
      where: { uuid: newUser.roleUuid, iSdelete: 0 },
      relations: { permissions: true },
    });
    if (!role) {
      throw new BadRequestException('role not found');
    }

    const user = this.repository.create({
      username: newUser.username,
      email: newUser.email,
      password: await hashPassword(newUser.password),
      avatar: newUser.avatar,
      role,
    });
    return this.repository.save(user);
  }

  /**
   * @description Find a user
   * @param {FindOptionsWhere<User>} query
   * @return {Promise<User | null>}
   */
  findOne(query: FindOptionsWhere<User>, relations?: string[]): Promise<User | null> {
    return this.repository.findOne({ where: query, relations });
  }

  findForAuthentication(email: string): Promise<User | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('user.email = :email', { email })
      .andWhere('user.iSdelete = :iSdelete', { iSdelete: 0 })
      .getOne();
  }

  /**
   * @description Update a user
   * @param {string} uuid
   * @param {UpdateUser} updateUser
   * @return {Promise<UpdateResult>}
   */
  async update(uuid: string, updateUser: UpdateUser): Promise<UpdateResult> {
    const payload: Partial<User> = {};
    if (typeof updateUser.username === 'string') payload.username = updateUser.username;
    if (typeof updateUser.email === 'string') payload.email = updateUser.email;
    if (typeof updateUser.avatar === 'string' || updateUser.avatar === null) {
      payload.avatar = updateUser.avatar;
    }
    if (updateUser.password) {
      payload.password = await hashPassword(updateUser.password);
    }

    const res = await this.repository.update({ uuid }, payload);
    return res;
  }

  async findAvatar(uuid: string): Promise<string | null> {
    const user = await this.repository
      .createQueryBuilder('user')
      .addSelect('user.avatar')
      .where('user.uuid = :uuid', { uuid })
      .andWhere('user.iSdelete = :iSdelete', { iSdelete: 0 })
      .getOne();

    return user?.avatar || null;
  }

  async findAdminList(options: {
    page: number;
    pageSize: number;
    keyword?: string;
    roleUuid?: string;
  }): Promise<{ data: User[]; total: number }> {
    const { page, pageSize, keyword, roleUuid } = options;
    const normalizedKeyword = keyword?.trim();

    const baseQuery: FindOptionsWhere<User> = { iSdelete: 0 };
    if (roleUuid) {
      baseQuery.role = { uuid: roleUuid };
    }

    const where = normalizedKeyword
      ? [
          {
            ...baseQuery,
            username: ILike(`%${normalizedKeyword}%`),
          },
          {
            ...baseQuery,
            email: ILike(`%${normalizedKeyword}%`),
          },
        ]
      : [baseQuery];

    const [data, total] = await this.repository.findAndCount({
      where,
      relations: { role: { permissions: true } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return { data, total };
  }

  async updateByAdmin(uuid: string, updateUser: AdminUpdateUser): Promise<User | null> {
    const { roleUuid } = updateUser;
    const payload: Partial<User> = {};
    if (typeof updateUser.username === 'string') payload.username = updateUser.username;
    if (typeof updateUser.email === 'string') payload.email = updateUser.email;
    if (typeof updateUser.avatar === 'string' || updateUser.avatar === null)
      payload.avatar = updateUser.avatar;
    if (typeof updateUser.password === 'string') payload.password = updateUser.password;

    if (payload.password) {
      payload.password = await hashPassword(payload.password);
    } else {
      delete payload.password;
    }

    if (roleUuid) {
      const role = await this.roleRepository.findOne({
        where: { uuid: roleUuid, iSdelete: 0 },
        relations: { permissions: true },
      });
      if (!role) {
        throw new BadRequestException('role not found');
      }
      payload.role = role;
    }

    await this.repository.update({ uuid, iSdelete: 0 }, payload);
    return this.findOne({ uuid, iSdelete: 0 }, ['role', 'role.permissions']);
  }
}
