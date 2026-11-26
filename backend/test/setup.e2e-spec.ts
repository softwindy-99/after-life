import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { SetupModule } from 'src/setup/setup.module';
import { DatabaseSetupService } from 'src/setup/database-setup.service';
import { ApplicationRestartService } from 'src/setup/application-restart.service';
import { TransformInterceptor } from 'src/transform.interceptor';
import * as setupEnv from 'src/setup/env';

const payload = {
  ...setupEnv.defaultEnv,
  DB_PASSWORD: 'database-test-password',
  INIT_ADMIN_PASSWORD: 'new-admin-password',
  initialUser: { username: 'Alice', email: 'alice@example.com', password: 'user-password' },
};
const endpoints = [
  ['', 'initialize'],
  ['/database/check', 'check'],
  ['/database/initialize', 'initialize'],
  ['/database/migrate', 'migrate'],
  ['/database/seed', 'seed'],
  ['/database/reset', 'reset'],
] as const;

describe('Setup HTTP lifecycle', () => {
  let app: INestApplication;
  const database = {
    check: jest.fn(),
    initialize: jest.fn(),
    migrate: jest.fn(),
    seed: jest.fn(),
    reset: jest.fn(),
  };
  const restart = { scheduleRestart: jest.fn() };
  let previousEnv: NodeJS.ProcessEnv;

  async function createApplication(): Promise<INestApplication> {
    const module = await Test.createTestingModule({ imports: [SetupModule] })
      .overrideProvider(DatabaseSetupService)
      .useValue(database)
      .overrideProvider(ApplicationRestartService)
      .useValue(restart)
      .compile();
    const application = module.createNestApplication();
    application.useGlobalInterceptors(new TransformInterceptor());
    await application.init();
    return application;
  }

  beforeEach(async () => {
    previousEnv = process.env;
    process.env = { ...previousEnv };
    jest.clearAllMocks();
    jest.spyOn(setupEnv, 'isRuntimeConfigured').mockReturnValue(false);
    jest.spyOn(setupEnv, 'readEnvFile').mockReturnValue({});
    jest.spyOn(setupEnv, 'hasEnvFile').mockReturnValue(false);
    jest.spyOn(setupEnv, 'getEnvTemplate').mockReturnValue({ ...setupEnv.defaultEnv });
    jest.spyOn(setupEnv, 'writeEnvFile').mockImplementation(() => undefined);
    jest.spyOn(setupEnv, 'applyEnvUpdates').mockImplementation(() => undefined);
    database.initialize.mockResolvedValue({ connected: true });
    database.check.mockResolvedValue({ connected: true });
    app = await createApplication();
  });

  afterEach(async () => {
    await app.close();
    process.env = previousEnv;
    jest.restoreAllMocks();
  });

  it('returns masked installation defaults without a token and prevents status caching', async () => {
    const response = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(response.body.data).toMatchObject({
      needsSetup: true,
      requiresRestart: false,
      initializing: false,
      hasEnvFile: false,
      requiredKeys: expect.any(Array),
      values: {
        DB_PASSWORD: '',
        INIT_ADMIN_PASSWORD: '',
        JWT_SECRET: '',
        WEB_PUSH_PRIVATE_KEY: '',
      },
    });
    expect(response.body.data).not.toHaveProperty('authorized');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('checks and installs using container defaults without exposing or submitting the saved password', async () => {
    process.env.DB_HOST = 'ambient-host';
    jest.mocked(setupEnv.readEnvFile).mockReturnValue({
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'after_life',
      DB_PASSWORD: 'generated-container-secret',
      DB_NAME: 'after_life',
    });
    const status = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(status.body.data).toMatchObject({
      databasePasswordConfigured: true,
      values: { DB_USER: 'after_life', DB_PASSWORD: '' },
    });
    expect(JSON.stringify(status.body)).not.toContain('generated-container-secret');
    const input = {
      ...status.body.data.values,
      INIT_ADMIN_USERNAME: 'Owner',
      INIT_ADMIN_EMAIL: 'owner@example.com',
      INIT_ADMIN_PASSWORD: 'new-owner-password',
      initialUser: payload.initialUser,
    };
    await request(app.getHttpServer()).post('/setup/database/check').send(input).expect(201);
    expect(database.check).toHaveBeenCalledWith(
      expect.objectContaining({ DB_PASSWORD: 'generated-container-secret' }),
    );
    await request(app.getHttpServer())
      .post('/setup/database/check')
      .send({ ...input, DB_HOST: 'other-host' })
      .expect(400);
    expect(database.check).toHaveBeenCalledTimes(1);
    const result = await request(app.getHttpServer()).post('/setup').send(input).expect(201);
    expect(database.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ DB_PASSWORD: 'generated-container-secret' }),
      { resetDatabase: false, initialUser: payload.initialUser },
    );
    expect(JSON.stringify(result.body)).not.toContain('generated-container-secret');
    const configured = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(configured.body.data).not.toHaveProperty('databasePasswordConfigured');
  });

  it.each(endpoints)(
    'allows POST /setup%s without an installation token while unconfigured',
    async (path, method) => {
      await request(app.getHttpServer())
        .post(`/setup${path}`)
        .send({ ...payload, resetDatabase: path === '/database/reset' })
        .expect(201);
      expect(database[method]).toHaveBeenCalledTimes(1);
    },
  );

  it('requires explicit destructive confirmation for database reset', async () => {
    await request(app.getHttpServer()).post('/setup/database/reset').send(payload).expect(400);
    expect(database.reset).not.toHaveBeenCalled();
  });

  it('validates the new administrator password before any side effect', async () => {
    for (const password of [undefined, '', 'short', 'admin123456']) {
      await request(app.getHttpServer())
        .post('/setup')
        .send({ ...payload, INIT_ADMIN_PASSWORD: password })
        .expect(400);
    }
    expect(database.initialize).not.toHaveBeenCalled();
    expect(setupEnv.writeEnvFile).not.toHaveBeenCalled();
  });

  it('allows initial setup, then closes every database endpoint before restart', async () => {
    await request(app.getHttpServer()).post('/setup/database/check').send(payload).expect(201);
    const result = await request(app.getHttpServer()).post('/setup').send(payload).expect(201);
    expect(JSON.stringify(result.body)).not.toContain(payload.INIT_ADMIN_PASSWORD);
    expect(restart.scheduleRestart).toHaveBeenCalledTimes(1);
    expect(setupEnv.writeEnvFile).toHaveBeenCalledWith(
      expect.objectContaining({
        DB_PASSWORD: payload.DB_PASSWORD,
        INIT_ADMIN_PASSWORD: '',
      }),
    );
    const status = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(status.body.data).toEqual({
      needsSetup: false,
      requiresRestart: true,
      initializing: false,
    });
    for (const [path] of endpoints) {
      await request(app.getHttpServer())
        .post(`/setup${path}`)
        .send({ ...payload, resetDatabase: true })
        .expect(403);
    }
    expect(database.initialize).toHaveBeenCalledTimes(1);
  });

  it('returns lifecycle flags only and rejects every setup operation after configured startup', async () => {
    await app.close();
    jest.mocked(setupEnv.isRuntimeConfigured).mockReturnValue(true);
    app = await createApplication();
    const response = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(response.body.data).toEqual({
      needsSetup: false,
      requiresRestart: false,
      initializing: false,
    });
    for (const [path] of endpoints) {
      await request(app.getHttpServer())
        .post(`/setup${path}`)
        .send({ ...payload, resetDatabase: true })
        .expect(403);
    }
    for (const method of Object.values(database)) expect(method).not.toHaveBeenCalled();
  });
  it('reports a safe database failure, releases initialization state and permits a corrected retry', async () => {
    database.initialize
      .mockRejectedValueOnce(
        Object.assign(
          new Error(`Access denied: ${payload.DB_PASSWORD}; ${payload.INIT_ADMIN_PASSWORD}`),
          { code: 'ER_ACCESS_DENIED_ERROR' },
        ),
      )
      .mockResolvedValueOnce({ connected: true });
    const failure = await request(app.getHttpServer()).post('/setup').send(payload).expect(400);
    expect(failure.body.message).toContain('数据库认证失败');
    expect(JSON.stringify(failure.body)).not.toContain(payload.DB_PASSWORD);
    expect(JSON.stringify(failure.body)).not.toContain(payload.INIT_ADMIN_PASSWORD);
    const status = await request(app.getHttpServer()).get('/setup/status').expect(200);
    expect(status.body.data).toMatchObject({ needsSetup: true, initializing: false });
    expect(restart.scheduleRestart).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/setup').send(payload).expect(201);
    expect(restart.scheduleRestart).toHaveBeenCalledTimes(1);
  });
});
