import { NotFoundException } from '@nestjs/common';
import { RoleController } from './role.controller';

describe('RoleController', () => {
  let controller: RoleController;
  let roleService: {
    findAll: jest.Mock;
    updatePermissions: jest.Mock;
  };

  beforeEach(() => {
    roleService = {
      findAll: jest.fn(),
      updatePermissions: jest.fn(),
    };
    controller = new RoleController(roleService as any);
  });

  it('returns all roles', async () => {
    roleService.findAll.mockResolvedValue([
      { uuid: 'role-1', users: [{ password: 'never-expose' }], id: 123 },
    ]);

    await expect(controller.findAll()).resolves.toEqual([{ uuid: 'role-1' }]);
  });

  it('updates permissions for a role', async () => {
    roleService.updatePermissions.mockResolvedValue({ uuid: 'role-1' });

    await expect(
      controller.updatePermissions('role-1', { permissionUuids: ['perm-1'] }),
    ).resolves.toEqual({ uuid: 'role-1' });
  });

  it('throws when role does not exist', async () => {
    roleService.updatePermissions.mockResolvedValue(null);

    await expect(
      controller.updatePermissions('role-1', { permissionUuids: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
