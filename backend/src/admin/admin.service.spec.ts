import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Contact } from 'src/contact/contact.entity';
import { Letter } from 'src/letter/letter.entity';
import { Role } from 'src/role/role.entity';
import { User } from 'src/user/user.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { AdminService } from './admin.service';
import { ResourceService } from 'src/resource/resource.service';

describe('AdminService', () => {
  it('builds dashboard statistics', async () => {
    const userRepository = createMockRepository();
    const letterRepository = createMockRepository();
    const contactRepository = createMockRepository();
    const roleRepository = createMockRepository();

    userRepository.find.mockResolvedValue([
      { uuid: 'user-1', role: { uuid: 'role-1', name: 'admin' } },
      { uuid: 'user-2', role: { uuid: 'role-2', name: 'user' } },
    ]);
    letterRepository.find.mockResolvedValue([{ uuid: 'letter-1' }]);
    letterRepository.count.mockResolvedValue(4);
    contactRepository.find.mockResolvedValue([
      { uuid: 'contact-1', letters: [{ uuid: 'letter-1', title: 'private title' }] },
    ]);
    contactRepository.count.mockResolvedValue(3);
    roleRepository.find.mockResolvedValue([
      {
        uuid: 'role-1',
        name: 'admin',
        permissions: [
          { name: 'admin', iSdelete: 0 },
          { name: 'self', iSdelete: 0 },
        ],
      },
      {
        uuid: 'role-2',
        name: 'user',
        permissions: [{ name: 'self', iSdelete: 0 }],
      },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Letter), useValue: letterRepository },
        { provide: getRepositoryToken(Contact), useValue: contactRepository },
        { provide: getRepositoryToken(Role), useValue: roleRepository },
        { provide: ResourceService, useValue: { totalBytes: jest.fn().mockResolvedValue(1024) } },
      ],
    }).compile();

    const service = moduleRef.get(AdminService);

    await expect(service.getDashboard()).resolves.toEqual({
      totals: {
        users: 2,
        admins: 1,
        letters: 4,
        contacts: 3,
        roles: 2,
        resourceBytes: 1024,
      },
      recentUsers: [
        { uuid: 'user-1', role: { uuid: 'role-1', name: 'admin' } },
        { uuid: 'user-2', role: { uuid: 'role-2', name: 'user' } },
      ],
      recentLetters: [
        {
          uuid: 'letter-1',
          deliveryEnabled: undefined,
          lastTriggeredAt: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        },
      ],
      roleDistribution: [
        {
          roleUuid: 'role-1',
          roleName: 'admin',
          userCount: 1,
          permissionNames: ['admin', 'self'],
        },
        {
          roleUuid: 'role-2',
          roleName: 'user',
          userCount: 1,
          permissionNames: ['self'],
        },
      ],
    });
    expect(letterRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({ content: true, title: true, excerpt: true }),
      }),
    );
    expect(contactRepository.find).not.toHaveBeenCalled();
  });
});
