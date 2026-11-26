import { BadRequestException, NotAcceptableException } from '@nestjs/common';
import { UpdateResult } from 'typeorm';
import { UserController } from './user.controller';

describe('UserController', () => {
  let controller: UserController;
  let userService: {
    findOne: jest.Mock;
    create: jest.Mock;
    createByAdmin: jest.Mock;
    update: jest.Mock;
    findAvatar: jest.Mock;
    findAdminList: jest.Mock;
    updateByAdmin: jest.Mock;
  };

  beforeEach(() => {
    userService = {
      findOne: jest.fn(),
      create: jest.fn(),
      createByAdmin: jest.fn(),
      update: jest.fn(),
      findAvatar: jest.fn(),
      findAdminList: jest.fn(),
      updateByAdmin: jest.fn(),
    };

    controller = new UserController(userService as any);
  });

  it('queries the current user when uuid is omitted', async () => {
    const user = { uuid: 'user-1' };
    userService.findOne.mockResolvedValue(user);

    await expect(controller.query({ uuid: undefined }, { user } as any)).resolves.toEqual(user);

    expect(userService.findOne).toHaveBeenCalledWith({
      uuid: 'user-1',
      iSdelete: 0,
    });
  });

  it('rejects querying another user', async () => {
    await expect(
      controller.query({ uuid: '22222222-2222-4222-8222-222222222222' }, {
        user: { uuid: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotAcceptableException);
  });

  it('rejects duplicate email on create', async () => {
    userService.findOne.mockResolvedValue({ uuid: 'existing' });

    await expect(
      controller.create({
        username: 'alice',
        password: 'test-password',
        email: 'alice@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a user without exposing its password hash', async () => {
    const created = {
      uuid: 'user-1',
      email: 'alice@example.com',
      password: 'stored-hash',
    };
    userService.findOne.mockResolvedValue(null);
    userService.create.mockResolvedValue(created);

    await expect(
      controller.create({
        username: 'alice',
        password: 'test-password',
        email: 'alice@example.com',
      } as any),
    ).resolves.toEqual({
      uuid: 'user-1',
      email: 'alice@example.com',
    });
    expect(userService.create).toHaveBeenCalledWith({
      username: 'alice',
      password: 'test-password',
      email: 'alice@example.com',
    });
  });

  it('creates a user with an administrator-selected role without exposing its password hash', async () => {
    userService.findOne.mockResolvedValue(null);
    userService.createByAdmin.mockResolvedValue({
      uuid: 'user-2',
      username: 'Alice',
      email: 'alice@example.com',
      password: 'stored-hash',
      role: { uuid: '11111111-1111-4111-8111-111111111111', name: 'user' },
    });

    await expect(
      controller.createByAdmin({
        username: ' Alice ',
        email: ' Alice@Example.com ',
        password: 'plain-password',
        roleUuid: ' 11111111-1111-4111-8111-111111111111 ',
      }),
    ).resolves.toEqual({
      uuid: 'user-2',
      username: 'Alice',
      email: 'alice@example.com',
      role: { uuid: '11111111-1111-4111-8111-111111111111', name: 'user' },
    });
    expect(userService.findOne).toHaveBeenCalledWith({ email: 'alice@example.com' });
    expect(userService.createByAdmin).toHaveBeenCalledWith({
      username: 'Alice',
      email: 'alice@example.com',
      password: 'plain-password',
      roleUuid: '11111111-1111-4111-8111-111111111111',
      avatar: undefined,
    });
  });

  it('rejects invalid administrator-created users before persistence', async () => {
    await expect(
      controller.createByAdmin({
        username: 'Alice',
        email: 'alice@example.com',
        password: 'short',
        roleUuid: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userService.findOne).not.toHaveBeenCalled();
    expect(userService.createByAdmin).not.toHaveBeenCalled();
  });

  it('updates only the current user uuid', async () => {
    const result = { affected: 1 } as UpdateResult;
    userService.update.mockResolvedValue(result);

    await expect(
      controller.update(
        {
          username: 'alice',
          email: 'alice@example.com',
          password: 'new-password',
        } as any,
        { user: { uuid: 'user-1' } } as any,
      ),
    ).resolves.toEqual(result);

    expect(userService.update).toHaveBeenCalledWith('user-1', {
      username: 'alice',
      email: 'alice@example.com',
      password: 'new-password',
    });
  });

  it('rejects a profile update containing only privileged fields', async () => {
    await expect(
      controller.update(
        { role: { name: 'admin' }, iSdelete: 1 } as any,
        { user: { uuid: 'user-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(userService.update).not.toHaveBeenCalled();
  });

  it('returns the current user avatar separately', async () => {
    userService.findAvatar.mockResolvedValue('data:image/png;base64,abc');

    await expect(controller.queryAvatar({ user: { uuid: 'user-1' } } as any)).resolves.toEqual({
      avatar: 'data:image/png;base64,abc',
    });

    expect(userService.findAvatar).toHaveBeenCalledWith('user-1');
  });

  it('returns a user avatar for admin editing', async () => {
    userService.findAvatar.mockResolvedValue('data:image/png;base64,abc');

    await expect(controller.queryAvatarByAdmin('user-2')).resolves.toEqual({
      avatar: 'data:image/png;base64,abc',
    });

    expect(userService.findAvatar).toHaveBeenCalledWith('user-2');
  });

  it('returns admin user list with normalized pagination', async () => {
    userService.findAdminList.mockResolvedValue({ data: [], total: 0 });

    await expect(
      controller.queryList({
        page: undefined,
        pageSize: undefined,
        keyword: 'alice',
        roleUuid: '11111111-1111-4111-8111-111111111111',
      }),
    ).resolves.toEqual({ data: [], total: 0 });

    expect(userService.findAdminList).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      keyword: 'alice',
      roleUuid: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('updates a user by admin', async () => {
    const user = { uuid: 'user-2' };
    userService.updateByAdmin.mockResolvedValue(user);

    await expect(controller.updateByAdmin('user-2', { username: 'updated' })).resolves.toEqual(
      user,
    );
  });
});
