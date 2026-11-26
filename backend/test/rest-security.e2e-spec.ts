import { PermissionController } from 'src/permission/permission.controller';
import { PermissionService } from 'src/permission/permission.service';
import { AdminController } from 'src/admin/admin.controller';
import { AdminService } from 'src/admin/admin.service';
import { AuthController } from 'src/auth/auth.controller';
import { AuthService } from 'src/auth/auth.service';
import { RoleController } from 'src/role/role.controller';
import { RoleService } from 'src/role/role.service';
import { NotificationController } from 'src/notification/notification.controller';
import { NotificationService } from 'src/notification/notification.service';
import { CheckInController } from 'src/check-in/check-in.controller';
import { CheckInService } from 'src/check-in/check-in.service';
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import * as request from 'supertest';
import { Auth } from 'src/auth/auth.entity';
import { AuthGuard } from 'src/auth/auth.guard';
import { UserController } from 'src/user/user.controller';
import { UserService } from 'src/user/user.service';
import { User } from 'src/user/user.entity';
import { Role } from 'src/role/role.entity';
import { LetterController } from 'src/letter/letter.controller';
import { LetterService } from 'src/letter/letter.service';
import { Letter } from 'src/letter/letter.entity';
import { ResourceService } from 'src/resource/resource.service';
import { ResourceController } from 'src/resource/resource.controller';
import { StorageSettingsController } from 'src/resource/storage-settings.controller';
import { ResourceStorageService } from 'src/resource/resource-storage.service';
import { Resource } from 'src/resource/resource.entity';
import { RuntimeConfigWriter } from 'src/setup/runtime-config.writer';
import { ContactController } from 'src/contact/contact.controller';
import { ContactService } from 'src/contact/contact.service';
import { Contact } from 'src/contact/contact.entity';
import { TransformInterceptor } from 'src/transform.interceptor';
import { MailService } from 'src/mail/mail.service';

const userUuid = '11111111-1111-4111-8111-111111111111';
const resourceUuid = '22222222-2222-4222-8222-222222222222';
const foreignUuid = '33333333-3333-4333-8333-333333333333';

describe('REST security boundaries (real guards, controllers and ownership queries)', () => {
  let app: INestApplication;
  let selfToken: string;
  let adminToken: string;
  let noSelfToken: string;
  let mcpToken: string;
  let letterService: LetterService;
  let contactService: ContactService;
  const currentUser = {
    uuid: userUuid,
    username: 'Alice',
    email: 'alice@example.com',
    iSdelete: 0,
    role: {
      uuid: resourceUuid,
      name: 'user',
      iSdelete: 0,
      permissions: [] as { name: string; iSdelete: number }[],
    },
    password: 'must-never-leak',
    auths: [{ token: 'secret-session' }],
  };
  const userRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
  };
  const resource = {
    uuid: resourceUuid,
    title: 'Letter',
    content: 'Body',
    name: 'Contact',
    email: 'contact@example.com',
    deliveryEnabled: false,
    iSdelete: 0,
    user: currentUser,
  };
  const resourceRepo = {
    findOne: jest.fn(async ({ where }) =>
      where.uuid === resourceUuid && where.user?.uuid === userUuid ? resource : null,
    ),
  };
  const authService = { signIn: jest.fn().mockResolvedValue('issued-token') };
  const roleService = { updatePermissions: jest.fn(), findAll: jest.fn() };
  const notificationService = {
    register: jest.fn(),
    updatePreferences: jest.fn(),
    remove: jest.fn(),
    getStatus: jest.fn(),
  };
  const checkInService = { create: jest.fn(), getStatus: jest.fn() };
  const resourceService = {
    syncLetterResources: jest.fn(),
    upload: jest.fn().mockResolvedValue({ uuid: resourceUuid, url: '/resource/signed' }),
    ownerAccess: jest.fn().mockResolvedValue({ url: '/resource/signed' }),
    openSigned: jest.fn().mockRejectedValue(new ForbiddenException()),
  };
  const sessions = new Map<string, string[]>();
  const configWriter = { update: jest.fn() };
  const oldSecret = process.env.JWT_SECRET;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'http-security-test-secret';
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: process.env.JWT_SECRET })],
      controllers: [
        AuthController,
        UserController,
        LetterController,
        ResourceController,
        StorageSettingsController,
        ContactController,
        RoleController,
        PermissionController,
        AdminController,
        NotificationController,
        CheckInController,
      ],
      providers: [
        { provide: AdminService, useValue: { getDashboard: jest.fn() } },
        { provide: PermissionService, useValue: { findAll: jest.fn() } },
        { provide: RoleService, useValue: roleService },
        { provide: NotificationService, useValue: notificationService },
        { provide: CheckInService, useValue: checkInService },
        { provide: AuthService, useValue: authService },
        UserService,
        LetterService,
        { provide: MailService, useValue: { isConfigured: () => true } },
        { provide: ResourceService, useValue: resourceService },
        ResourceStorageService,
        { provide: RuntimeConfigWriter, useValue: configWriter },
        {
          provide: getRepositoryToken(Resource),
          useValue: {
            count: jest.fn().mockResolvedValue(0),
            manager: {
              transaction: async (_isolation: string, work: (manager: object) => Promise<void>) =>
                work({ query: async () => [currentUser], getRepository: () => userRepo }),
            },
          },
        },
        ContactService,
        {
          provide: getRepositoryToken(Auth),
          useValue: {
            findOne: async ({ where }: { where: { tokenHash: string } }) => {
              const permissions = sessions.get(where.tokenHash);
              return permissions
                ? {
                    user: {
                      ...currentUser,
                      role: {
                        ...currentUser.role,
                        permissions: permissions.map((name) => ({ name, iSdelete: 0 })),
                      },
                    },
                  }
                : null;
            },
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(Role),
          useValue: { findOne: jest.fn().mockResolvedValue(currentUser.role) },
        },
        { provide: getRepositoryToken(Letter), useValue: resourceRepo },
        { provide: getRepositoryToken(Contact), useValue: resourceRepo },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();
    const jwt = app.get(JwtService);
    const issue = async (permissions: string[]) => {
      const token = await jwt.signAsync({
        uuid: userUuid,
        permissions,
        nonce: permissions.join(','),
      });
      sessions.set(createHash('sha256').update(token).digest('hex'), permissions);
      return token;
    };
    selfToken = await issue(['self']);
    adminToken = await issue(['admin']);
    noSelfToken = await issue([]);
    mcpToken = await jwt.signAsync({ uuid: userUuid, aud: 'mcp', mcpScopes: ['mcp:write'] });
    sessions.set(createHash('sha256').update(mcpToken).digest('hex'), ['admin', 'self']);
    letterService = app.get(LetterService);
    contactService = app.get(ContactService);
  });

  beforeEach(() => {
    userRepo.findOne.mockResolvedValue(currentUser);
    userRepo.update.mockResolvedValue({ affected: 1 });
    userRepo.findAndCount.mockResolvedValue([[currentUser], 1]);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  });

  it('binds delivery previews to the human owner and strictly rejects caller-selected principals', async () => {
    const preview = jest.spyOn(letterService, 'previewDelivery').mockResolvedValue({
      baselineAt: '2026-11-15T00:00:00Z',
      baselineSource: 'account-created',
      dueAt: '2026-11-16T00:00:00Z',
      overdue: false,
      recipients: [],
      skippedContacts: [],
      resourceCount: 0,
      retentionDays: 30,
      blockers: ['请先选择联系人。'],
      expiresAt: '2026-11-15T00:10:00Z',
      token: null,
    });
    const body = {
      title: 'Review',
      content: '<p>Body</p>',
      inactiveAfterMinutes: '1440',
      contactUuids: [] as string[],
    };
    try {
      await request(app.getHttpServer()).post('/letter/delivery-preview').send(body).expect(401);
      for (const [token, status] of [
        [noSelfToken, 403],
        [mcpToken, 401],
      ] as const) {
        await request(app.getHttpServer())
          .post('/letter/delivery-preview')
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(status);
      }
      expect(preview).not.toHaveBeenCalled();
      await request(app.getHttpServer())
        .post('/letter/delivery-preview')
        .set('Authorization', `Bearer ${selfToken}`)
        .send({ ...body, userUuid: foreignUuid })
        .expect(400);
      await request(app.getHttpServer())
        .post('/letter/delivery-preview')
        .set('Authorization', `Bearer ${selfToken}`)
        .send(body)
        .expect(200);
      expect(preview).toHaveBeenCalledWith(userUuid, { ...body, inactiveAfterMinutes: 1440 });
    } finally {
      preview.mockRestore();
    }
  });

  it.each(['letter', 'contact'])(
    'allows own %s UUID while preserving foreign ownership denial',
    async (kind) => {
      const service = kind === 'letter' ? letterService : contactService;
      const update = jest.spyOn(service, 'updateOwned').mockResolvedValue(resource as never);
      const remove = jest.spyOn(service, 'removeOwned').mockResolvedValue(undefined);
      const body = kind === 'letter' ? { title: 'Updated' } : { name: 'Updated' };
      await request(app.getHttpServer())
        .get(`/${kind}/${resourceUuid}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .put(`/${kind}/${resourceUuid}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .send(body)
        .expect(200);
      expect(update).toHaveBeenCalledWith(
        resourceUuid,
        userUuid,
        expect.any(Object),
        ...(kind === 'letter' ? [undefined, undefined, { token: undefined }] : []),
      );
      await request(app.getHttpServer())
        .delete(`/${kind}/${resourceUuid}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .expect(204);
      expect(remove).toHaveBeenCalledWith(resourceUuid, userUuid);
      update.mockClear();
      update.mockResolvedValue(null);
      remove.mockClear();
      for (const method of ['get', 'put', 'delete'] as const) {
        await request(app.getHttpServer())
          [method](`/${kind}/${foreignUuid}`)
          .set('Authorization', `Bearer ${selfToken}`)
          .send(body)
          .expect(404);
      }
      if (kind === 'letter')
        expect(update).toHaveBeenCalledWith(
          foreignUuid,
          userUuid,
          expect.any(Object),
          undefined,
          undefined,
          { token: undefined },
        );
      else expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      update.mockRestore();
      remove.mockRestore();
    },
  );

  it('accepts web contact null fields and disabled draft empty inactivity fields', async () => {
    const contactInsert = jest.spyOn(contactService, 'insert').mockResolvedValue(resource as never);
    const letterInsert = jest.spyOn(letterService, 'insert').mockResolvedValue(resource as never);
    try {
      await request(app.getHttpServer())
        .post('/contact')
        .set('Authorization', `Bearer ${selfToken}`)
        .send({ name: 'Web contact', email: 'test@example.com', phone: null, note: null })
        .expect(201);
      expect(contactInsert).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com', phone: null, note: null }),
      );
      await request(app.getHttpServer())
        .post('/letter')
        .set('Authorization', `Bearer ${selfToken}`)
        .send({
          title: 'Web draft',
          content: '<p>Test</p>',
          deliveryEnabled: false,
          inactiveAfterMinutes: '',
        })
        .expect(201);
      expect(letterInsert).toHaveBeenCalledWith(
        expect.objectContaining({ inactiveAfterMinutes: null, deliveryEnabled: false }),
        { token: undefined },
      );
    } finally {
      contactInsert.mockRestore();
      letterInsert.mockRestore();
    }
  });

  it('checks current self capability and denies anonymous access', async () => {
    await request(app.getHttpServer()).get(`/letter/${resourceUuid}`).expect(401);
    for (const token of [adminToken, noSelfToken]) {
      await request(app.getHttpServer())
        .get(`/letter/${resourceUuid}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it('requires owner authentication to upload or request a signed resource link', async () => {
    await request(app.getHttpServer()).get(`/resource/${resourceUuid}/access`).expect(401);
    await request(app.getHttpServer())
      .get(`/resource/${resourceUuid}/access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/resource/${resourceUuid}/access`)
      .set('Authorization', `Bearer ${selfToken}`)
      .expect(200);
    expect(resourceService.ownerAccess).toHaveBeenCalledWith(resourceUuid, userUuid);
    await request(app.getHttpServer())
      .post('/resource')
      .attach('file', Buffer.from('x'), 'file.txt')
      .expect(401);
    await request(app.getHttpServer())
      .post('/resource')
      .set('Authorization', `Bearer ${selfToken}`)
      .attach('file', Buffer.from('x'), 'file.txt')
      .expect(201);
    expect(resourceService.upload).toHaveBeenCalledWith(
      userUuid,
      expect.objectContaining({ originalname: 'file.txt' }),
    );
    await request(app.getHttpServer()).get(`/resource/${resourceUuid}/file`).expect(403);
  });

  it.each([
    ['get', '/admin/dashboard'],
    ['get', '/user/list'],
    ['post', '/user/admin'],
    ['put', `/user/admin/${userUuid}`],
    ['get', `/user/admin/${userUuid}/avatar`],
    ['get', '/role'],
    ['get', '/permission'],
    ['put', `/role/${resourceUuid}/permissions`],
    ['get', '/admin/storage'],
    ['put', '/admin/storage'],
    ['post', '/admin/storage/test'],
    ['post', '/admin/storage/migrate'],
  ] as const)(
    'protects administrative routes from anonymous, self-only and MCP credentials: %s %s',
    async (method, path) => {
      await request(app.getHttpServer())[method](path).send({}).expect(401);
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${selfToken}`)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${mcpToken}`)
        .send({})
        .expect(401);
      expect(configWriter.update).not.toHaveBeenCalled();
    },
  );

  it('returns safe storage status and validates settings before persistence', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/storage')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(response.body.data.driver).toBe('local');
    expect(response.body.data).not.toHaveProperty('accessKeyId');
    expect(response.body.data).not.toHaveProperty('accessKeySecret');
    for (const method of ['put', 'post'] as const) {
      await request(app.getHttpServer())
        [method](method === 'put' ? '/admin/storage' : '/admin/storage/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ driver: 's3', endpoint: 'file:///private', userUuid: foreignUuid })
        .expect(400);
    }
    expect(configWriter.update).not.toHaveBeenCalled();
  });

  it.each([
    { uuid: foreignUuid },
    { iSdelete: 1 },
    { role: { name: 'admin' } },
    { createdAt: '2026-01-01' },
    { email: [] },
    { password: 'short' },
    null,
  ])('rejects malformed or non-allowlisted admin update fields: %j', async (body) => {
    await request(app.getHttpServer())
      .put(`/user/admin/${userUuid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body ?? {})
      .expect(400);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('allows admin changes through an explicit command and never serializes stored secrets', async () => {
    const result = await request(app.getHttpServer())
      .put(`/user/admin/${userUuid}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: ' Updated ' })
      .expect(200);
    expect(userRepo.update).toHaveBeenCalledWith(
      { uuid: userUuid, iSdelete: 0 },
      { username: 'Updated' },
    );
    expect(result.body.data).toEqual({
      uuid: userUuid,
      username: 'Alice',
      email: 'alice@example.com',
      role: { uuid: resourceUuid, name: 'user', permissions: [] },
    });
  });

  it('registers a visitor with the server-selected user role and returns a safe profile', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);
    userRepo.create.mockImplementationOnce((user) => user);
    userRepo.save.mockImplementationOnce(async (user) => ({ ...user, uuid: foreignUuid }));
    const response = await request(app.getHttpServer())
      .post('/user')
      .send({ username: 'Bob', email: ' BOB@example.com ', password: 'new-user-password' })
      .expect(201);
    expect(response.body.data).toEqual({
      uuid: foreignUuid,
      username: 'Bob',
      email: 'bob@example.com',
      role: { uuid: resourceUuid, name: 'user', permissions: [] },
    });
  });

  it('rejects invalid public registration and excessive pagination before persistence', async () => {
    for (const body of [
      { username: 'Alice', email: 'invalid', password: 'long-password' },
      { username: 'Alice', email: 'a@example.com', password: 'short' },
      {
        username: 'Alice',
        email: 'a@example.com',
        password: 'long-password',
        roleUuid: resourceUuid,
      },
    ]) {
      await request(app.getHttpServer()).post('/user').send(body).expect(400);
    }
    for (const query of ['pageSize=101', 'pageSize=-1', 'page=1.5', 'pageSize[]=10']) {
      await request(app.getHttpServer())
        .get(`/user/list?${query}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    }
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(userRepo.findAndCount).not.toHaveBeenCalled();
  });
  it.each([
    ['/letter', { title: 'Hello', content: 'Body', contactUuids: 'not-an-array' }],
    ['/letter', { title: 'Hello', content: 'Body', deliveryEnabled: 'false' }],
    ['/letter', { title: 'Hello', content: 'Body', contactUuids: [resourceUuid, 7] }],
    ['/letter', { title: 'Hello', content: 'Body', inactiveAfterMinutes: false }],
    ['/letter', { title: 'x'.repeat(121), content: 'Body' }],
    ['/letter', { title: 'Hello', content: 'Body', user: { uuid: foreignUuid } }],
    ['/contact', { name: 'Contact', email: 'invalid', letterUuids: [] }],
    ['/contact', { name: 'Contact', email: 'a@example.com', letterUuids: {} }],
    ['/contact', { name: 'Contact' }],
    ['/contact', { name: 'Contact', phone: 123 }],
    ['/check-in', { source: [] }],
    ['/notification/subscription', { subscription: [] }],
    [
      '/notification/subscription',
      {
        subscription: {
          endpoint: 'https://push.example/one',
          keys: { p256dh: 'public', auth: 'auth' },
        },
        preferences: { dailyReminderEnabled: 'false' },
      },
    ],
    ['/notification/subscription/status', { endpoint: { value: 'https://push.example' } }],
  ])('rejects malformed feature input before service work: %s %j', async (path, body) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${selfToken}`)
      .send(body)
      .expect(400);
    expect(resourceRepo.findOne).not.toHaveBeenCalled();
    expect(userRepo.findOne).not.toHaveBeenCalled();
    expect(notificationService.register).not.toHaveBeenCalled();
    expect(checkInService.create).not.toHaveBeenCalled();
  });

  it('does not treat missing or malformed permission arrays as removing every permission', async () => {
    for (const body of [
      {},
      { permissionUuids: null },
      { permissionUuids: resourceUuid },
      { permissionUuids: [false] },
    ]) {
      await request(app.getHttpServer())
        .put(`/role/${resourceUuid}/permissions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(400);
    }
    expect(roleService.updatePermissions).not.toHaveBeenCalled();
  });

  it('rejects malformed update/removal input and invalid resource identifiers', async () => {
    await request(app.getHttpServer())
      .get('/letter/not-a-uuid')
      .set('Authorization', `Bearer ${selfToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .put(`/contact/${resourceUuid}`)
      .set('Authorization', `Bearer ${selfToken}`)
      .send({ letterUuids: 1 })
      .expect(400);
    await request(app.getHttpServer())
      .put('/notification/subscription/preferences')
      .set('Authorization', `Bearer ${selfToken}`)
      .send({ endpoint: 'https://push.example/one', preferences: { timezone: 'No/Such_Zone' } })
      .expect(400);
    await request(app.getHttpServer())
      .delete('/notification/subscription')
      .set('Authorization', `Bearer ${selfToken}`)
      .send({ subscriptionId: {} })
      .expect(400);
    expect(notificationService.updatePreferences).not.toHaveBeenCalled();
    expect(notificationService.remove).not.toHaveBeenCalled();
  });

  it('does not expose owner entities or persistence metadata in resource responses', async () => {
    for (const kind of ['letter', 'contact']) {
      const response = await request(app.getHttpServer())
        .get(`/${kind}/${resourceUuid}`)
        .set('Authorization', `Bearer ${selfToken}`)
        .expect(200);
      expect(response.body.data).not.toHaveProperty('user');
      expect(response.body.data).not.toHaveProperty('iSdelete');
      expect(JSON.stringify(response.body)).not.toContain('secret-session');
      expect(JSON.stringify(response.body)).not.toContain('must-never-leak');
    }
  });
  it('validates login input and marks token responses non-cacheable', async () => {
    for (const body of [
      { email: [] as unknown[], password: 'password' },
      { email: 'alice@example.com', password: {} },
      { email: 'alice@example.com', password: 'password', role: 'admin' },
    ]) {
      await request(app.getHttpServer()).post('/auth').send(body).expect(400);
    }
    expect(authService.signIn).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/auth')
      .send({ email: ' ALICE@EXAMPLE.COM ', password: 'legacy' })
      .expect('Cache-Control', 'no-store')
      .expect(201);
    expect(authService.signIn).toHaveBeenCalledWith('alice@example.com', 'legacy');
  });
});
