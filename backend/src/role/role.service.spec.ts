import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Role } from './role.entity';
import { RoleService } from './role.service';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { Permission } from 'src/permission/permission.entity';

describe('RoleService', () => {
  it('finds a role with permissions relation', async () => {
    const repository = createMockRepository();
    const permissionRepository = createMockRepository();
    repository.findOne.mockResolvedValue({ name: 'admin' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: repository },
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepository,
        },
      ],
    }).compile();

    const service = moduleRef.get(RoleService);

    await expect(service.findOne({ name: 'admin' })).resolves.toEqual({
      name: 'admin',
    });
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { name: 'admin' },
      relations: { permissions: true },
    });
  });

  it('returns all active roles', async () => {
    const repository = createMockRepository();
    const permissionRepository = createMockRepository();
    repository.find.mockResolvedValue([{ name: 'admin' }]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: repository },
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepository,
        },
      ],
    }).compile();

    const service = moduleRef.get(RoleService);

    await expect(service.findAll()).resolves.toEqual([{ name: 'admin' }]);
  });

  it('updates role permissions', async () => {
    const repository = createMockRepository();
    const permissionRepository = createMockRepository();
    const role = {
      uuid: 'role-1',
      permissions: [] as Array<{ uuid: string }>,
    };
    repository.findOne
      .mockResolvedValueOnce(role)
      .mockResolvedValueOnce({ ...role, permissions: [{ uuid: 'perm-1' }] });
    permissionRepository.find.mockResolvedValue([{ uuid: 'perm-1' }]);
    repository.save.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: getRepositoryToken(Role), useValue: repository },
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepository,
        },
      ],
    }).compile();

    const service = moduleRef.get(RoleService);

    await expect(service.updatePermissions('role-1', ['perm-1'])).resolves.toEqual({
      ...role,
      permissions: [{ uuid: 'perm-1' }],
    });
  });
});
