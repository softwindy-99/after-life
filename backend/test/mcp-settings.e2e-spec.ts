import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as request from 'supertest';
import { Auth } from 'src/auth/auth.entity';
import { AuthGuard } from 'src/auth/auth.guard';
import { McpSettingsController } from 'src/mcp/mcp-settings.controller';
import { McpSettingsService } from 'src/mcp/mcp-settings.service';
import { createHash } from 'crypto';

describe('MCP human authorization management (HTTP)', () => {
  let app: INestApplication;
  const settings = {
    create: jest.fn().mockResolvedValue({ token: 'new-token' }),
    update: jest.fn(),
    approve: jest.fn(),
    getSettings: jest.fn(),
    revoke: jest.fn(),
    revokeAll: jest.fn(),
  };
  beforeEach(() => jest.clearAllMocks());
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [McpSettingsController],
      providers: [
        { provide: McpSettingsService, useValue: settings },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: async (token: string) => ({
              uuid: token === 'human-other' ? 'other-user' : 'owner',
              ...(token === 'agent' ? { aud: 'mcp' } : {}),
            }),
          },
        },
        {
          provide: getRepositoryToken(Auth),
          useValue: {
            findOne: async ({ where }: { where: { tokenHash: string } }) => {
              const ordinaryUser =
                where.tokenHash === createHash('sha256').update('human-other').digest('hex');
              return {
                user: {
                  uuid: ordinaryUser ? 'other-user' : 'owner',
                  iSdelete: 0,
                  role: {
                    name: ordinaryUser ? 'user' : 'admin',
                    iSdelete: 0,
                    permissions: [{ name: 'self', iSdelete: 0 }],
                  },
                },
              };
            },
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('requires a human REST session, even when the agent has a valid token', async () => {
    await request(app.getHttpServer())
      .post('/mcp-settings/grants')
      .set('Authorization', 'Bearer agent')
      .send({ name: 'Self-upgrade', scopes: [], days: 30 })
      .expect(401);
    await request(app.getHttpServer())
      .post('/mcp-settings/approvals/11111111-1111-4111-8111-111111111111')
      .set('Authorization', 'Bearer agent')
      .send({ approve: true })
      .expect(401);
    expect(settings.create).not.toHaveBeenCalled();
    expect(settings.approve).not.toHaveBeenCalled();
  });
  it.each([
    ['human', 'owner'],
    ['human-other', 'other-user'],
  ])('binds authorization management to the current %s principal', async (token, uuid) => {
    await request(app.getHttpServer())
      .post('/mcp-settings/grants')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My agent', scopes: ['mcp:letters:read'], days: 30 })
      .expect(201);
    expect(settings.create).toHaveBeenCalledWith(uuid, {
      name: 'My agent',
      scopes: ['mcp:letters:read'],
      days: 30,
    });
    await request(app.getHttpServer())
      .get('/mcp-settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(settings.getSettings).toHaveBeenCalledWith(uuid, 1);
    await request(app.getHttpServer())
      .delete('/mcp-settings/grants/11111111-1111-4111-8111-111111111111')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(settings.revoke).toHaveBeenCalledWith(uuid, '11111111-1111-4111-8111-111111111111');
  });
  it('rejects unknown scopes, extra fields and permissions without read dependencies', async () => {
    for (const body of [
      { name: 'Agent', scopes: ['mcp:write'], days: 30 },
      { name: 'Agent', scopes: ['mcp:delivery:write'], days: 30 },
      { name: 'Agent', scopes: [] as string[], days: 30, userUuid: 'other' },
    ]) {
      await request(app.getHttpServer())
        .post('/mcp-settings/grants')
        .set('Authorization', 'Bearer human')
        .send(body)
        .expect(400);
    }
    expect(settings.create).not.toHaveBeenCalled();
  });
  it.each([0, -1, 91, 1.5, 'permanent', '30', true])(
    'rejects invalid grant lifetime %s',
    async (days) => {
      await request(app.getHttpServer())
        .post('/mcp-settings/grants')
        .set('Authorization', 'Bearer human')
        .send({ name: 'Agent', scopes: [], days })
        .expect(400);
      expect(settings.create).not.toHaveBeenCalled();
    },
  );
  it.each([7, null, undefined])(
    'binds grant lifetime %s to the human and returns non-cacheable credentials',
    async (days) => {
      await request(app.getHttpServer())
        .post('/mcp-settings/grants')
        .set('Authorization', 'Bearer human')
        .send({
          name: 'Agent',
          scopes: ['mcp:letters:read'],
          ...(days === undefined ? {} : { days }),
        })
        .expect(201)
        .expect('Cache-Control', 'no-store');
      expect(settings.create).toHaveBeenCalledWith('owner', {
        name: 'Agent',
        scopes: ['mcp:letters:read'],
        days: days === undefined ? 30 : days,
      });
    },
  );
});
