import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Role } from 'src/role/role.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { User } from 'src/user/user.entity';
import { hashPassword, verifyPassword } from 'src/auth/password';
import { EnvMap } from './env';
import { DatabaseSetupService } from './database-setup.service';
import { SetupInitialUser } from './setup.types';

describe('DatabaseSetupService', () => {
  const env: EnvMap = { DB_NAME: 'multi_user_test' };
  const initialUser: SetupInitialUser = {
    username: 'Alice',
    email: 'alice@example.com',
    password: 'plain-password',
  };

  let service: DatabaseSetupService;
  let userRepository: ReturnType<typeof createMockRepository>;
  let roleRepository: ReturnType<typeof createMockRepository>;
  let dataSource: {
    getRepository: jest.Mock;
    destroy: jest.Mock;
    createQueryRunner: jest.Mock;
  };
  let runner: {
    connect: jest.Mock;
    query: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    isTransactionActive: boolean;
    manager: { getRepository: jest.Mock };
  };

  beforeEach(() => {
    service = new DatabaseSetupService();
    userRepository = createMockRepository();
    roleRepository = createMockRepository();
    dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === User) return userRepository;
        if (entity === Role) return roleRepository;
        throw new Error('unexpected repository');
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
      createQueryRunner: jest.fn(() => runner),
    };

    runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ acquired: 1 }]),
      startTransaction: jest.fn().mockImplementation(async () => {
        runner.isTransactionActive = true;
      }),
      commitTransaction: jest.fn().mockImplementation(async () => {
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: jest.fn().mockImplementation(async () => {
        runner.isTransactionActive = false;
      }),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
      manager: { getRepository: dataSource.getRepository },
    };

    jest.spyOn(service as any, 'createDataSource').mockResolvedValue(dataSource);
    jest.spyOn(service as any, 'seedPermissionsAndRoles').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'seedAdminUser').mockResolvedValue(undefined);
    userRepository.create.mockImplementation((value) => value);
    userRepository.save.mockImplementation(async (value) => value);
  });

  it('creates the initial account with the server-selected user role and a password hash', async () => {
    const userRole = { uuid: 'role-user', name: 'user' };
    userRepository.findOne.mockResolvedValue(null);
    roleRepository.findOne.mockResolvedValue(userRole);

    await service.seed(env, {
      ...initialUser,
      role: { uuid: 'role-admin', name: 'admin' },
    } as SetupInitialUser);

    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: { name: 'user', iSdelete: 0 },
      relations: { permissions: true },
    });
    expect(userRepository.create).toHaveBeenCalledWith({
      username: 'Alice',
      email: 'alice@example.com',
      password: expect.stringMatching(/^scrypt\$/),
      role: userRole,
      iSdelete: 0,
    });
    const persisted = userRepository.save.mock.calls[0][0];
    await expect(verifyPassword(initialUser.password, persisted.password)).resolves.toBe(true);
    expect(persisted.role).toBe(userRole);
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects an email that already belongs to any database user', async () => {
    userRepository.findOne.mockResolvedValue({ uuid: 'existing-user' });

    await expect(service.seed(env, initialUser)).rejects.toBeInstanceOf(ConflictException);

    expect(userRepository.save).not.toHaveBeenCalled();
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('treats the same completed ordinary account as an idempotent setup retry', async () => {
    userRepository.findOne.mockResolvedValue({
      uuid: 'existing-user',
      username: initialUser.username,
      email: initialUser.email,
      password: await hashPassword(initialUser.password),
      iSdelete: 0,
      role: { name: 'user', iSdelete: 0 },
    });

    await expect(service.seed(env, initialUser)).resolves.toBeUndefined();

    expect(roleRepository.findOne).not.toHaveBeenCalled();
    expect(userRepository.save).not.toHaveBeenCalled();
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('maps a concurrent unique-email violation to a safe conflict response', async () => {
    userRepository.findOne.mockResolvedValue(null);
    roleRepository.findOne.mockResolvedValue({ uuid: 'role-user', name: 'user' });
    userRepository.save.mockRejectedValue(
      Object.assign(new Error('duplicate'), { driverError: { errno: 1062 } }),
    );

    await expect(service.seed(env, initialUser)).rejects.toEqual(
      new ConflictException('Initial user email already exists.'),
    );
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps CLI seeding backward-compatible when no initial user is supplied', async () => {
    await expect(service.seed(env)).resolves.toBeUndefined();

    expect(userRepository.findOne).not.toHaveBeenCalled();
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });

  it('forwards an initial user from initialization into seeding', async () => {
    jest.spyOn(service, 'ensureDatabase').mockResolvedValue(undefined);
    jest.spyOn(service, 'migrate').mockResolvedValue({} as any);
    const seed = jest.spyOn(service, 'seed').mockResolvedValue(undefined);
    jest.spyOn(service, 'check').mockResolvedValue({} as any);

    await service.initialize(env, { initialUser });

    expect(seed).toHaveBeenCalledWith(env, initialUser);
  });
  it.each([1, '1'])('serializes multi-user seeding with acquired lock %p', async (acquired) => {
    runner.query.mockResolvedValueOnce([{ acquired }]);
    await service.seed(env);
    expect(runner.manager.getRepository).not.toHaveBeenCalledWith(User);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)', [expect.any(String)]);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it.each([0, '0'])(
    'rejects contention without starting a write transaction (%p)',
    async (acquired) => {
      runner.query.mockResolvedValueOnce([{ acquired }]);
      await expect(service.seed(env)).rejects.toBeInstanceOf(ConflictException);
      expect(runner.startTransaction).not.toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(runner.query).toHaveBeenCalledTimes(1);
      expect(runner.release).toHaveBeenCalledTimes(1);
      expect(dataSource.destroy).toHaveBeenCalledTimes(1);
    },
  );

  it.each([null, undefined, 'unexpected'])(
    'reports unavailable locks separately (%p)',
    async (acquired) => {
      runner.query.mockResolvedValueOnce([{ acquired }]);
      await expect(service.seed(env)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(runner.startTransaction).not.toHaveBeenCalled();
      expect(runner.release).toHaveBeenCalledTimes(1);
    },
  );

  it('rolls back both account seeds and releases the connection when the ordinary account fails', async () => {
    userRepository.findOne.mockResolvedValue(null);
    roleRepository.findOne.mockResolvedValue({ name: 'user' });
    userRepository.save.mockRejectedValueOnce(new Error('write failed'));
    await expect(service.seed(env, initialUser)).rejects.toThrow('write failed');
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)', [expect.any(String)]);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(dataSource.destroy).toHaveBeenCalledTimes(1);
  });
});
