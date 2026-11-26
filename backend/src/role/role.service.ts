import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Role } from './role.entity';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Permission } from 'src/permission/permission.entity';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly repository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  findOne(query: FindOptionsWhere<Role>): Promise<Role | null> {
    return this.repository.findOne({
      where: query,
      relations: { permissions: true },
    });
  }

  findAll(): Promise<Role[]> {
    return this.repository.find({
      where: { iSdelete: 0 },
      relations: { permissions: true },
      order: { createdAt: 'ASC' },
    });
  }

  async updatePermissions(roleUuid: string, permissionUuids: string[]): Promise<Role | null> {
    const role = await this.findOne({ uuid: roleUuid, iSdelete: 0 });
    if (!role) return null;

    const permissions = permissionUuids.length
      ? await this.permissionRepository.find({
          where: permissionUuids.map((uuid) => ({ uuid, iSdelete: 0 })),
        })
      : [];

    if (permissions.length !== new Set(permissionUuids).size) {
      throw new BadRequestException('Unknown or inactive permission.');
    }
    role.permissions = permissions;
    await this.repository.save(role);
    return this.findOne({ uuid: roleUuid, iSdelete: 0 });
  }
}
