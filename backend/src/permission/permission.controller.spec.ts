import { PermissionController } from './permission.controller';

describe('PermissionController', () => {
  it('returns all permissions', async () => {
    const permissionService = {
      findAll: jest.fn().mockResolvedValue([{ uuid: 'perm-1' }]),
    };
    const controller = new PermissionController(permissionService as any);

    await expect(controller.findAll()).resolves.toEqual([{ uuid: 'perm-1' }]);
  });
});
