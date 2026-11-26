import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { DatabaseSetupService } from './database-setup.service';
import { SetupPayload, SetupService } from './setup.service';
import * as setupEnv from './env';

describe('SetupService', () => {
  const databaseResult = {
    connected: true,
    databaseExists: true,
    schemaReady: true,
    missingTables: [] as string[],
    pendingMigrations: false,
    seedStatus: {
      permissions: 'ready' as const,
      roles: 'ready' as const,
      adminUser: 'ready' as const,
    },
    canInitialize: true,
  };

  let databaseSetupService: {
    check: jest.Mock;
    initialize: jest.Mock;
    migrate: jest.Mock;
    seed: jest.Mock;
    reset: jest.Mock;
  };
  let service: SetupService;
  let previousEnv: NodeJS.ProcessEnv;

  const createPayload = (
    initialUser: SetupPayload['initialUser'] = {
      username: 'Alice',
      email: 'alice@example.com',
      password: 'plain-password',
    },
  ): SetupPayload => ({
    ...setupEnv.defaultEnv,
    DB_PASSWORD: 'database-test-password',
    INIT_ADMIN_PASSWORD: 'new-admin-password',
    INIT_ADMIN_EMAIL: 'admin@example.com',
    initialUser,
  });

  beforeEach(() => {
    previousEnv = process.env;
    process.env = { ...previousEnv };
    jest.spyOn(setupEnv, 'isRuntimeConfigured').mockReturnValue(false);
    jest.spyOn(setupEnv, 'readEnvFile').mockReturnValue({});
    jest.spyOn(setupEnv, 'getEnvTemplate').mockReturnValue({ ...setupEnv.defaultEnv });
    jest.spyOn(setupEnv, 'hasEnvFile').mockReturnValue(false);
    jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation(() => undefined);
    jest.spyOn(setupEnv, 'applyEnvUpdates').mockImplementation(() => undefined);
    databaseSetupService = {
      check: jest.fn().mockResolvedValue(databaseResult),
      initialize: jest.fn().mockResolvedValue(databaseResult),
      migrate: jest.fn().mockResolvedValue(databaseResult),
      seed: jest.fn().mockResolvedValue(undefined),
      reset: jest.fn().mockResolvedValue(databaseResult),
    };
    service = new SetupService(databaseSetupService as unknown as DatabaseSetupService);
  });

  afterEach(() => {
    process.env = previousEnv;
    jest.restoreAllMocks();
  });

  function setContainerDefaults(): void {
    process.env.DB_HOST = 'ambient-host';
    jest.mocked(setupEnv.readEnvFile).mockReturnValue({
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'after_life',
      DB_PASSWORD: 'generated-container-password',
      DB_NAME: 'after_life',
    });
  }

  it('prefills container connection fields while indicating only the presence of a password', () => {
    setContainerDefaults();
    expect(service.getStatus()).toMatchObject({
      databasePasswordConfigured: true,
      values: { DB_HOST: '127.0.0.1', DB_USER: 'after_life', DB_PASSWORD: '' },
    });
    expect(JSON.stringify(service.getStatus())).not.toContain('generated-container-password');
    expect(service.getStatus().missingKeys).not.toContain('DB_PASSWORD');
  });

  it.each([undefined, '', '   '])(
    'reuses a masked database password when submitted as %s',
    async (password) => {
      setContainerDefaults();
      await service.initialize({
        DB_PASSWORD: password,
        INIT_ADMIN_USERNAME: 'Owner',
        INIT_ADMIN_EMAIL: 'owner@example.com',
        INIT_ADMIN_PASSWORD: 'new-owner-password',
        initialUser: createPayload().initialUser,
      });
      expect(databaseSetupService.initialize).toHaveBeenCalledWith(
        expect.objectContaining({ DB_PASSWORD: 'generated-container-password' }),
        { resetDatabase: false, initialUser: createPayload().initialUser },
      );
    },
  );

  it.each(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME'])(
    'requires a new password when %s changes, including when the password is omitted',
    async (key) => {
      setContainerDefaults();
      for (const password of [undefined, '']) {
        await expect(
          service.checkDatabase({
            [key]: key === 'DB_PORT' ? '3307' : 'other',
            DB_PASSWORD: password,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(databaseSetupService.check).not.toHaveBeenCalled();
    },
  );

  it('uses an explicitly supplied database password for changed connections', async () => {
    setContainerDefaults();
    await service.checkDatabase({ DB_HOST: 'other-host', DB_PASSWORD: 'replacement-password' });
    expect(databaseSetupService.check).toHaveBeenCalledWith(
      expect.objectContaining({ DB_HOST: 'other-host', DB_PASSWORD: 'replacement-password' }),
    );
  });

  it('blocks destructive setup operations after configured startup', async () => {
    Object.assign(service, { setupAvailable: false });

    await expect(service.resetDatabase()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.migrateDatabase()).rejects.toBeInstanceOf(ForbiddenException);
    expect(databaseSetupService.reset).not.toHaveBeenCalled();
    expect(databaseSetupService.migrate).not.toHaveBeenCalled();
  });

  it('allows database checks while the initial setup is open', async () => {
    await expect(service.checkDatabase(createPayload())).resolves.toEqual(databaseResult);
    expect(databaseSetupService.check).toHaveBeenCalledTimes(1);
  });

  it('does not expose authenticated proxy URLs in setup status', () => {
    jest.mocked(setupEnv.getEnvTemplate).mockReturnValue({
      ...setupEnv.defaultEnv,
      WEB_PUSH_PROXY: 'http://proxy-user:proxy-password@127.0.0.1:7890',
    });

    expect(service.getStatus().values).not.toHaveProperty('WEB_PUSH_PROXY');
  });

  it('rejects missing database credentials before contacting the database', async () => {
    await expect(service.checkDatabase()).rejects.toBeInstanceOf(BadRequestException);
    expect(databaseSetupService.check).not.toHaveBeenCalled();
  });

  it('returns masked installation defaults without requiring a token', () => {
    jest.mocked(setupEnv.getEnvTemplate).mockReturnValue({
      ...setupEnv.defaultEnv,
      DB_PASSWORD: 'example-secret',
      INIT_ADMIN_PASSWORD: 'example-admin',
      MAIL_PASSWORD: 'example-mail',
      UNKNOWN_SECRET: 'unknown-secret',
    });
    expect(service.getStatus()).toMatchObject({
      needsSetup: true,
      requiresRestart: false,
      initializing: false,
    });
    expect(service.getStatus().values).toMatchObject({
      DB_PASSWORD: '',
      INIT_ADMIN_PASSWORD: '',
      MAIL_PASSWORD: '',
      JWT_SECRET: '',
      WEB_PUSH_PRIVATE_KEY: '',
    });
    expect(service.getStatus().values).not.toHaveProperty('UNKNOWN_SECRET');
  });

  it('returns lifecycle flags only after configured startup', () => {
    jest.mocked(setupEnv.isRuntimeConfigured).mockReturnValue(true);
    const configured = new SetupService(databaseSetupService as unknown as DatabaseSetupService);
    expect(configured.getStatus()).toEqual({
      needsSetup: false,
      requiresRestart: false,
      initializing: false,
    });
  });

  it.each([undefined, '', 'short', 'admin123456', 'a'.repeat(129)])(
    'requires an explicitly supplied new administrator password',
    async (password) => {
      await expect(
        service.initialize({ ...createPayload(), INIT_ADMIN_PASSWORD: password }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(databaseSetupService.initialize).not.toHaveBeenCalled();
    },
  );

  it('ignores credentials inherited from the launching process during setup', async () => {
    process.env.DB_PASSWORD = 'ambient-password';
    expect(service.getStatus().databasePasswordConfigured).toBe(false);
    await expect(service.checkDatabase()).rejects.toBeInstanceOf(BadRequestException);
    expect(databaseSetupService.check).not.toHaveBeenCalled();
  });

  it('saves setup settings to the current env file without retaining the owner password', async () => {
    await service.initialize(createPayload());
    expect(setupEnv.writeEnvFile).toHaveBeenCalledWith(
      expect.objectContaining({
        DB_PASSWORD: 'database-test-password',
        INIT_ADMIN_EMAIL: 'admin@example.com',
        INIT_ADMIN_PASSWORD: '',
        JWT_SECRET: expect.any(String),
      }),
    );
  });

  it('initializes the database with a normalized ordinary user without persisting user data', async () => {
    const password = '  plain-password  ';
    const payload = {
      ...createPayload({
        username: '  Alice  ',
        email: '  ALICE@EXAMPLE.COM ',
        password,
      }),
    } as SetupPayload;

    const result = await service.initialize(payload);

    expect(databaseSetupService.initialize).toHaveBeenCalledWith(
      expect.not.objectContaining({ UNKNOWN_SETUP_KEY: expect.anything() }),
      {
        resetDatabase: false,
        initialUser: {
          username: 'Alice',
          email: 'alice@example.com',
          password,
        },
      },
    );
    expect(JSON.stringify(result)).not.toContain('new-admin-password');
    expect(setupEnv.writeEnvFile).toHaveBeenCalledTimes(1);
    const savedEnv = jest.mocked(setupEnv.writeEnvFile).mock.calls[0][0];
    expect(savedEnv).not.toHaveProperty('initialUser');
    expect(savedEnv).not.toHaveProperty('UNKNOWN_SETUP_KEY');
    expect(JSON.stringify(result)).not.toContain(password);
  });

  it.each([
    ['missing user', undefined],
    ['blank username', { username: ' ', email: 'alice@example.com', password: 'plain-password' }],
    ['invalid email', { username: 'Alice', email: 'invalid', password: 'plain-password' }],
    ['short password', { username: 'Alice', email: 'alice@example.com', password: 'short' }],
  ])('rejects an invalid initial user: %s', async (_label, initialUser) => {
    const payload =
      initialUser === undefined
        ? { ...createPayload(), initialUser: undefined }
        : createPayload(initialUser);

    await expect(service.initialize(payload)).rejects.toBeInstanceOf(BadRequestException);

    expect(databaseSetupService.initialize).not.toHaveBeenCalled();
    expect(setupEnv.writeEnvFile).not.toHaveBeenCalled();
  });

  it('requires the initial user email to differ from the administrator email', async () => {
    const payload = createPayload({
      username: 'Alice',
      email: ' ADMIN@EXAMPLE.COM ',
      password: 'plain-password',
    });

    await expect(service.initialize(payload)).rejects.toBeInstanceOf(ConflictException);
    expect(databaseSetupService.initialize).not.toHaveBeenCalled();
  });

  it('returns a validation error for a malformed request body', async () => {
    await expect(service.initialize(null as unknown as SetupPayload)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(databaseSetupService.initialize).not.toHaveBeenCalled();
  });

  it('rejects concurrent initialization and remains closed after success', async () => {
    let finishInitialization: (value: typeof databaseResult) => void = () => undefined;
    databaseSetupService.initialize.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishInitialization = resolve;
        }),
    );

    const firstInitialization = service.initialize(createPayload());
    expect(service.getStatus()).toMatchObject({ initializing: true });

    await expect(service.initialize(createPayload())).rejects.toBeInstanceOf(ConflictException);

    finishInitialization(databaseResult);
    await expect(firstInitialization).resolves.toMatchObject({ initialized: true });
    expect(databaseSetupService.initialize).toHaveBeenCalledTimes(1);
    await expect(service.initialize(createPayload())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects final setup while a database write helper is in progress', async () => {
    let finishReset: (value: typeof databaseResult) => void = () => undefined;
    databaseSetupService.reset.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishReset = resolve;
        }),
    );

    const reset = service.resetDatabase(createPayload());
    expect(service.getStatus()).toMatchObject({ initializing: true });

    await expect(service.initialize(createPayload())).rejects.toBeInstanceOf(ConflictException);
    expect(databaseSetupService.initialize).not.toHaveBeenCalled();

    finishReset(databaseResult);
    await expect(reset).resolves.toEqual(databaseResult);
    expect(service.getStatus()).toMatchObject({ initializing: false });
  });

  it('serializes database write helpers while allowing concurrent read-only checks', async () => {
    let finishMigration: (value: typeof databaseResult) => void = () => undefined;
    databaseSetupService.migrate.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishMigration = resolve;
        }),
    );

    const migration = service.migrateDatabase(createPayload());

    await expect(service.seedDatabase(createPayload())).rejects.toBeInstanceOf(ConflictException);
    await expect(service.resetDatabase(createPayload())).rejects.toBeInstanceOf(ConflictException);
    await expect(service.checkDatabase(createPayload())).resolves.toEqual(databaseResult);
    expect(databaseSetupService.seed).not.toHaveBeenCalled();
    expect(databaseSetupService.reset).not.toHaveBeenCalled();
    expect(databaseSetupService.check).toHaveBeenCalledTimes(1);

    finishMigration(databaseResult);
    await expect(migration).resolves.toEqual(databaseResult);
  });

  it('releases the write lock after a database helper fails', async () => {
    databaseSetupService.reset
      .mockRejectedValueOnce(new Error('reset failed'))
      .mockResolvedValueOnce(databaseResult);

    await expect(service.resetDatabase(createPayload())).rejects.toThrow('初始化失败');
    expect(service.getStatus()).toMatchObject({ initializing: false });
    await expect(service.resetDatabase(createPayload())).resolves.toEqual(databaseResult);
    expect(databaseSetupService.reset).toHaveBeenCalledTimes(2);
  });

  it('reopens setup after initialization fails', async () => {
    databaseSetupService.initialize
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(databaseResult);

    await expect(service.initialize(createPayload())).rejects.toThrow('初始化失败');
    expect(service.getStatus()).toMatchObject({ initializing: false });
    await expect(service.initialize(createPayload())).resolves.toMatchObject({ initialized: true });
    expect(databaseSetupService.initialize).toHaveBeenCalledTimes(2);
  });
  it('returns a safe actionable authentication error and lets corrected configuration retry', async () => {
    databaseSetupService.initialize
      .mockRejectedValueOnce(
        Object.assign(new Error('raw credentials and SQL must stay private'), {
          code: 'ER_ACCESS_DENIED_ERROR',
        }),
      )
      .mockResolvedValueOnce(databaseResult);
    await expect(service.initialize(createPayload())).rejects.toThrow('数据库认证失败');
    expect(service.getStatus()).toMatchObject({ initializing: false, needsSetup: true });
    expect(setupEnv.writeEnvFile).not.toHaveBeenCalled();
    await expect(service.initialize(createPayload())).resolves.toMatchObject({ initialized: true });
  });
});
