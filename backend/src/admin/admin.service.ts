import { toUserDto } from 'src/user/user.dto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/user.entity';
import { Letter } from 'src/letter/letter.entity';
import { Contact } from 'src/contact/contact.entity';
import { Role } from 'src/role/role.entity';
import { ResourceService } from 'src/resource/resource.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Letter)
    private readonly letterRepository: Repository<Letter>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Role) private readonly roleRepository: Repository<Role>,
    private readonly resourceService: ResourceService,
  ) {}

  async getDashboard() {
    const [users, letters, roles, totalLetters, totalContacts, resourceBytes] = await Promise.all([
      this.userRepository.find({
        where: { iSdelete: 0 },
        relations: { role: true },
        order: { createdAt: 'DESC' },
      }),
      this.letterRepository.find({
        where: { iSdelete: 0 },
        select: {
          uuid: true,
          deliveryEnabled: true,
          lastTriggeredAt: true,
          createdAt: true,
          updatedAt: true,
        },
        loadEagerRelations: false,
        order: { createdAt: 'DESC' },
        take: 5,
      }),
      this.roleRepository.find({
        where: { iSdelete: 0 },
        relations: { permissions: true },
        order: { createdAt: 'ASC' },
      }),
      this.letterRepository.count({ where: { iSdelete: 0 } }),
      this.contactRepository.count({ where: { iSdelete: 0 } }),
      this.resourceService.totalBytes(),
    ]);

    const roleDistribution = roles.map((role) => ({
      roleUuid: role.uuid,
      roleName: role.name,
      userCount: users.filter((user) => user.role?.uuid === role.uuid).length,
      permissionNames: (role.permissions || [])
        .filter((permission) => permission.iSdelete === 0)
        .map((permission) => permission.name),
    }));

    return {
      totals: {
        users: users.length,
        admins: roleDistribution
          .filter((role) => role.permissionNames.includes('admin'))
          .reduce((total, role) => total + role.userCount, 0),
        letters: totalLetters,
        contacts: totalContacts,
        roles: roles.length,
        resourceBytes,
      },
      recentUsers: users.slice(0, 5).map(toUserDto),
      recentLetters: letters.map((letter) => ({
        uuid: letter.uuid,
        deliveryEnabled: letter.deliveryEnabled,
        lastTriggeredAt: letter.lastTriggeredAt,
        createdAt: letter.createdAt,
        updatedAt: letter.updatedAt,
      })),
      roleDistribution,
    };
  }
}
