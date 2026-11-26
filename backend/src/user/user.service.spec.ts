import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { UserService } from './user.service';
import { User } from './user.entity';
import { Role } from 'src/role/role.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { verifyPassword } from 'src/auth/password';

describe('UserService', () => {
  let service: UserService;
  let userRepository: ReturnType<typeof createMockRepository>;
  let roleRepository: ReturnType<typeof createMockRepository>;

  beforeEach(async () => {
    userRepository = createMockRepository();
    roleRepository = createMockRepository();

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Role), useValue: roleRepository },
      ],
    }).compile();

    service = moduleRef.get(UserService);
  });

  it('creates a user with the default role and hashed password', async () => {
    const newUser = {
      username: 'alice',
      password: 'plain-password',
      email: 'alice@example.com',
    };
    const role = { name: 'user', permissions: [{ name: 'self' }] };
    userRepository.create.mockImplementation((value) => value);
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.save.mockImplementation(async (value) => ({
      ...value,
      uuid: 'user-1',
    }));

    const savedUser = await service.create(newUser);
    expect(savedUser).toMatchObject({
      username: 'alice',
      email: 'alice@example.com',
      role,
      uuid: 'user-1',
    });
    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: { name: 'user', iSdelete: 0 },
      relations: { permissions: true },
    });
    const persisted = userRepository.save.mock.calls[0][0];
    await expect(verifyPassword(newUser.password, persisted.password)).resolves.toBe(true);
  });

  it('ignores an injected role and always creates public registrations as ordinary users', async () => {
    const role = { uuid: 'role-user', name: 'user' };
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.create.mockImplementation((value) => value);
    userRepository.save.mockImplementation(async (value) => value);

    const savedUser = await service.create({
      username: 'alice',
      password: 'plain-password',
      email: 'alice@example.com',
      role: { uuid: 'role-admin', name: 'admin' },
    } as any);

    expect(savedUser.role).toBe(role);
    expect(userRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alice@example.com',
        role,
      }),
    );
  });

  it('prevents public signup when the default role grants admin access', async () => {
    roleRepository.findOne.mockResolvedValue({
      name: 'user',
      permissions: [{ name: 'admin', iSdelete: 0 }],
    });
    await expect(
      service.create({ username: 'Alice', email: 'alice@example.com', password: 'test-password' }),
    ).rejects.toThrow('Public registration');
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('throws when the default role is missing', async () => {
    const newUser = {
      username: 'alice',
      password: 'plain-password',
      email: 'alice@example.com',
    };

    userRepository.create.mockReturnValue({ ...newUser });
    roleRepository.findOne.mockResolvedValue(null);

    await expect(service.create(newUser)).rejects.toThrow('default role user not found');
  });

  it('creates a user with the role selected by an administrator', async () => {
    const role = { uuid: 'role-1', name: 'editor', permissions: [{ name: 'self' }] };
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.create.mockImplementation((value) => value);
    userRepository.save.mockImplementation(async (value) => ({
      ...value,
      uuid: 'user-2',
    }));

    const savedUser = await service.createByAdmin({
      username: 'Alice',
      email: 'alice@example.com',
      password: 'plain-password',
      roleUuid: 'role-1',
    });

    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: { uuid: 'role-1', iSdelete: 0 },
      relations: { permissions: true },
    });
    expect(savedUser).toMatchObject({
      uuid: 'user-2',
      username: 'Alice',
      email: 'alice@example.com',
      role,
    });
    await expect(verifyPassword('plain-password', savedUser.password)).resolves.toBe(true);
  });

  it('rejects administrator creation when the selected role is missing', async () => {
    roleRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createByAdmin({
        username: 'Alice',
        email: 'alice@example.com',
        password: 'plain-password',
        roleUuid: 'missing-role',
      }),
    ).rejects.toThrow('role not found');

    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('updates a user with the hashed password', async () => {
    userRepository.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.update('user-1', { password: 'next-password', username: 'next' }),
    ).resolves.toEqual({ affected: 1 });

    const payload = userRepository.update.mock.calls[0][1];
    expect(userRepository.update).toHaveBeenCalledWith(
      { uuid: 'user-1' },
      expect.objectContaining({ username: 'next' }),
    );
    await expect(verifyPassword('next-password', payload.password)).resolves.toBe(true);
  });

  it('updates avatar without requiring a password', async () => {
    userRepository.update.mockResolvedValue({ affected: 1 });

    await expect(
      service.update('user-1', { avatar: 'data:image/png;base64,abc' }),
    ).resolves.toEqual({ affected: 1 });

    expect(userRepository.update).toHaveBeenCalledWith(
      { uuid: 'user-1' },
      { avatar: 'data:image/png;base64,abc' },
    );
  });

  it('ignores privileged fields injected into a self-service update', async () => {
    userRepository.update.mockResolvedValue({ affected: 1 });

    await service.update('user-1', {
      username: 'safe-name',
      role: { name: 'admin' },
      iSdelete: 1,
    } as any);

    expect(userRepository.update).toHaveBeenCalledWith(
      { uuid: 'user-1' },
      { username: 'safe-name' },
    );
  });

  it('loads avatar only when explicitly requested', async () => {
    const queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({
        uuid: 'user-1',
        avatar: 'data:image/png;base64,abc',
      }),
    };
    userRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findAvatar('user-1')).resolves.toBe('data:image/png;base64,abc');

    expect(userRepository.createQueryBuilder).toHaveBeenCalledWith('user');
    expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.avatar');
    expect(queryBuilder.where).toHaveBeenCalledWith('user.uuid = :uuid', {
      uuid: 'user-1',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('user.iSdelete = :iSdelete', {
      iSdelete: 0,
    });
  });

  it('loads password and authorization data only for authentication', async () => {
    const user = { uuid: 'user-1', password: 'stored-hash' };
    const queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    userRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.findForAuthentication('alice@example.com')).resolves.toBe(user);
    expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.password');
    expect(queryBuilder.leftJoinAndSelect).toHaveBeenNthCalledWith(1, 'user.role', 'role');
    expect(queryBuilder.leftJoinAndSelect).toHaveBeenNthCalledWith(
      2,
      'role.permissions',
      'permission',
    );
  });

  it('returns admin list with keyword and role filter', async () => {
    userRepository.findAndCount.mockResolvedValue([[{ uuid: '1' }], 1]);

    await expect(
      service.findAdminList({
        page: 1,
        pageSize: 10,
        keyword: 'alice',
        roleUuid: 'role-1',
      }),
    ).resolves.toEqual({
      data: [{ uuid: '1' }],
      total: 1,
    });

    expect(userRepository.findAndCount).toHaveBeenCalledWith({
      where: [
        {
          iSdelete: 0,
          role: { uuid: 'role-1' },
          username: expect.any(Object),
        },
        {
          iSdelete: 0,
          role: { uuid: 'role-1' },
          email: expect.any(Object),
        },
      ],
      relations: { role: { permissions: true } },
      order: { createdAt: 'DESC' },
      skip: 0,
      take: 10,
    });
  });

  it('never forwards unsupported entity columns even when called without the HTTP schema', async () => {
    userRepository.findOne.mockResolvedValue({ uuid: 'user-1' });
    await service.updateByAdmin('user-1', {
      username: 'Alice',
      uuid: 'replacement',
      iSdelete: 1,
      createdAt: new Date(),
      auths: [{ token: 'injected' }],
      role: { name: 'admin' },
    } as any);
    expect(userRepository.update).toHaveBeenCalledWith(
      { uuid: 'user-1', iSdelete: 0 },
      { username: 'Alice' },
    );
  });

  it('updates a user by admin and changes role', async () => {
    const role = { uuid: 'role-1', permissions: [{ name: 'admin' }] };
    roleRepository.findOne.mockResolvedValue(role);
    userRepository.update.mockResolvedValue({ affected: 1 });
    userRepository.findOne.mockResolvedValue({
      uuid: 'user-1',
      role,
    });

    await expect(
      service.updateByAdmin('user-1', {
        username: 'Alice',
        password: 'secret',
        roleUuid: 'role-1',
      } as any),
    ).resolves.toEqual({
      uuid: 'user-1',
      role,
    });

    const payload = userRepository.update.mock.calls[0][1];
    expect(userRepository.update).toHaveBeenCalledWith(
      { uuid: 'user-1', iSdelete: 0 },
      expect.objectContaining({ username: 'Alice', role }),
    );
    await expect(verifyPassword('secret', payload.password)).resolves.toBe(true);
  });

  it('rejects admin update when role is missing', async () => {
    roleRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updateByAdmin('user-1', { roleUuid: 'missing-role' } as any),
    ).rejects.toThrow('role not found');
  });
});
