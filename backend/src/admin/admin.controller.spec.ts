import { AdminController } from './admin.controller';

describe('AdminController', () => {
  it('returns dashboard data', async () => {
    const adminService = {
      getDashboard: jest.fn().mockResolvedValue({ totals: { users: 1 } }),
    };
    const controller = new AdminController(adminService as any);

    await expect(controller.getDashboard()).resolves.toEqual({
      totals: { users: 1 },
    });
  });
});
