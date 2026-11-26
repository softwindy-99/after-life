import { Controller, Get, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AddressInfo } from 'node:net';
import * as request from 'supertest';
import { Auth } from 'src/auth/auth.entity';
import { AuthController } from 'src/auth/auth.controller';
import { AuthGuard } from 'src/auth/auth.guard';
import { AuthService } from 'src/auth/auth.service';
import { McpAccessGuard } from 'src/mcp/mcp-access.guard';
import { McpAuditService } from 'src/mcp/mcp-audit.service';
import { McpController } from 'src/mcp/mcp.controller';
import { McpHttpService } from 'src/mcp/mcp-http.service';
import { McpOriginGuard } from 'src/mcp/mcp-origin.guard';
import { configureMcpOriginProtection } from 'src/mcp/mcp-origin.middleware';
import { McpServerFactory } from 'src/mcp/mcp-server.factory';
import { McpToolsService } from 'src/mcp/mcp-tools.service';
import { TransformInterceptor } from 'src/transform.interceptor';
import { AgentDistributionModule } from 'src/agent/agent-distribution.module';

const userAUuid = '11111111-1111-4111-8111-111111111111';
const userBUuid = '22222222-2222-4222-8222-222222222222';
const webAToken = 'web-a';
const managedToken = 'mcp-managed-a';
let managedScopes = ['mcp:read', 'mcp:letters:read'];
let managedRevoked = false;
const mcpReadAToken = 'mcp-read-a';
const mcpWriteAToken = 'mcp-write-a';
const mcpReadBToken = 'mcp-read-b';
const mcpNoSelfToken = 'mcp-no-self';
const revokedMcpToken = 'mcp-revoked';
const knownTokens = [
  managedToken,
  webAToken,
  mcpReadAToken,
  mcpWriteAToken,
  mcpReadBToken,
  mcpNoSelfToken,
  revokedMcpToken,
];

@Controller('probe')
class ProbeController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

describe('MCP Streamable HTTP (e2e)', () => {
  let app: INestApplication;
  let endpoint: URL;
  let toolsService: { getProfile: jest.Mock } & Record<string, jest.Mock>;
  let authService: { issueMcpToken: jest.Mock; revokeMcpTokens: jest.Mock; signIn: jest.Mock };
  const clients: Client[] = [];

  beforeAll(async () => {
    toolsService = {
      getProfile: jest.fn(async (userUuid: string) => ({
        profile: {
          uuid: userUuid,
          username: userUuid === userAUuid ? 'User A' : 'User B',
          email: userUuid === userAUuid ? 'a@example.com' : 'b@example.com',
          roleName: 'user',
        },
      })),
      listContacts: jest.fn(),
      getContact: jest.fn(),
      createContact: jest.fn(),
      updateContact: jest.fn(),
      listLetters: jest.fn(),
      getLetter: jest.fn(),
      createLetterDraft: jest.fn(),
      updateLetterDraft: jest.fn(),
      getCheckInStatus: jest.fn(),
    };
    authService = {
      signIn: jest.fn(),
      issueMcpToken: jest.fn().mockResolvedValue({
        token: 'issued-mcp-token',
        expiresInSeconds: 2_592_000,
        scopes: ['mcp:read'],
      }),
      revokeMcpTokens: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AgentDistributionModule],
      controllers: [AuthController, McpController, ProbeController],
      providers: [
        McpAccessGuard,
        McpOriginGuard,
        McpAuditService,
        McpHttpService,
        McpServerFactory,
        { provide: McpToolsService, useValue: toolsService },
        { provide: AuthService, useValue: authService },
        Reflector,
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(async (token: string) => {
              if (!knownTokens.includes(token)) {
                throw new Error('invalid token');
              }
              const isMcpToken = token.startsWith('mcp-');
              return {
                uuid: token === mcpReadBToken ? userBUuid : userAUuid,
                email: 'user@example.com',
                role: 'user',
                permissions: ['self'],
                ...(isMcpToken
                  ? {
                      aud: 'mcp',
                      mcpScopes:
                        token === mcpWriteAToken ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
                    }
                  : {}),
                iat: 1,
                exp: 2,
              };
            }),
          },
        },
        {
          provide: getRepositoryToken(Auth),
          useValue: {
            update: jest.fn(),
            findOne: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
              const token = knownTokens.find(
                (candidate) =>
                  createHash('sha256').update(candidate).digest('hex') === where.tokenHash,
              );
              if (!token || token === revokedMcpToken || (token === managedToken && managedRevoked))
                return null;

              const uuid = token === mcpReadBToken ? userBUuid : userAUuid;
              return {
                uuid: `session-${token}`,
                ...(token === managedToken
                  ? { mcpScopes: managedScopes, mcpExpiresAt: new Date(Date.now() + 60000) }
                  : {}),
                user: {
                  uuid,
                  email: uuid === userAUuid ? 'a@example.com' : 'b@example.com',
                  iSdelete: 0,
                  role: {
                    name: 'user',
                    iSdelete: 0,
                    permissions: token === mcpNoSelfToken ? [] : [{ name: 'self', iSdelete: 0 }],
                  },
                },
              };
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'MCP_ALLOWED_ORIGINS' ? 'https://allowed.example' : undefined,
          },
        },
        AuthGuard,
        { provide: APP_GUARD, useExisting: AuthGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureMcpOriginProtection(app, app.get(ConfigService));
    app.enableCors({ origin: true, credentials: true });
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    endpoint = new URL(`http://127.0.0.1:${address.port}/mcp`);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
    await app.close();
  });

  async function createClient(token = mcpWriteAToken): Promise<Client> {
    const client = new Client({ name: 'after-life-e2e-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    clients.push(client);
    await client.connect(transport);
    return client;
  }

  it('distributes public assets and runs the downloaded CLI through the real auth/transport', async () => {
    const manifest = await request(app.getHttpServer()).get('/ai').expect(200);
    expect(manifest.body).toMatchObject({ cli: 'ai/cli.mjs', archive: 'ai/skill.tar.gz' });
    expect(manifest.body).not.toHaveProperty('data');
    await request(app.getHttpServer())
      .get('/ai/SKILL.md')
      .expect(200)
      .expect('X-Content-Type-Options', 'nosniff');
    await request(app.getHttpServer()).get('/ai/skill.json').expect(200);
    await request(app.getHttpServer()).get('/ai/references/tools.md').expect(200);
    await request(app.getHttpServer())
      .get('/ai/skill.tar.gz')
      .expect(200)
      .expect('Content-Type', 'application/gzip');
    await request(app.getHttpServer()).get('/ai/.env').expect(404);
    const downloaded = await request(app.getHttpServer()).get('/ai/cli.mjs').expect(200);
    const directory = await mkdtemp(join(tmpdir(), 'afterlife-cli-e2e-'));
    try {
      const cli = join(directory, 'afterlife.mjs');
      await writeFile(cli, downloaded.text);
      const run = (token: string, args: string[]) =>
        promisify(execFile)(process.execPath, [cli, ...args], {
          env: {
            ...process.env,
            AFTERLIFE_SERVER_URL: endpoint.origin,
            AFTERLIFE_TOKEN: token,
            AFTERLIFE_TOKEN_FILE: '',
          },
        });
      const profile = await run(mcpReadAToken, ['call', 'afterlife_get_my_profile']);
      expect(JSON.parse(profile.stdout).profile.uuid).toBe(userAUuid);
      const allowed = await run(managedToken, ['tools']);
      expect(JSON.parse(allowed.stdout).tools.map((tool: { name: string }) => tool.name)).toContain(
        'afterlife_get_letter',
      );
      managedScopes = ['mcp:read'];
      const restricted = await run(managedToken, ['tools']);
      expect(
        JSON.parse(restricted.stdout).tools.map((tool: { name: string }) => tool.name),
      ).not.toContain('afterlife_get_letter');
      await expect(run(managedToken, ['call', 'afterlife_get_letter'])).rejects.toMatchObject({
        code: 1,
      });
      await expect(run(webAToken, ['tools'])).rejects.toMatchObject({ code: 1 });
      await expect(run(revokedMcpToken, ['tools'])).rejects.toMatchObject({ code: 1 });
    } finally {
      managedScopes = ['mcp:read', 'mcp:letters:read'];
      await rm(directory, { recursive: true, force: true });
    }
  }, 15000);

  it('returns an unwrapped JSON-RPC initialization response', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${mcpWriteAToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'supertest', version: '1.0.0' },
        },
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ jsonrpc: '2.0', id: 1, result: { serverInfo: {} } });
        expect(body).not.toHaveProperty('data');
        expect(body).not.toHaveProperty('statusCode');
      });
  });

  it('works through the official client for initialize, tools/list and tools/call', async () => {
    const client = await createClient();

    const tools = await client.listTools();
    const result = await client.callTool({
      name: 'afterlife_get_my_profile',
      arguments: {},
    });

    expect(tools.tools.map((tool) => tool.name)).toContain('afterlife_get_my_profile');
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      profile: {
        uuid: userAUuid,
        username: 'User A',
        email: 'a@example.com',
        roleName: 'user',
      },
    });
  });

  it('limits a read token to the read-only tool set', async () => {
    const client = await createClient(mcpReadAToken);

    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'afterlife_get_my_profile',
      'afterlife_list_contacts',
      'afterlife_get_contact',
      'afterlife_list_letters',
      'afterlife_get_letter',
      'afterlife_get_check_in_status',
    ]);
  });

  it('keeps concurrent client identities isolated', async () => {
    const [clientA, clientB] = await Promise.all([
      createClient(mcpReadAToken),
      createClient(mcpReadBToken),
    ]);

    const [resultA, resultB] = await Promise.all([
      clientA.callTool({ name: 'afterlife_get_my_profile', arguments: {} }),
      clientB.callTool({ name: 'afterlife_get_my_profile', arguments: {} }),
    ]);

    expect(resultA.structuredContent).toMatchObject({ profile: { uuid: userAUuid } });
    expect(resultB.structuredContent).toMatchObject({ profile: { uuid: userBUuid } });
  });

  it('requires authentication, self permission and an allowed browser Origin', async () => {
    const initialize = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'supertest', version: '1.0.0' },
      },
    };

    await request(app.getHttpServer()).post('/mcp').send(initialize).expect(401);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', 'Bearer invalid')
      .send(initialize)
      .expect(401);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${revokedMcpToken}`)
      .send(initialize)
      .expect(401);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${webAToken}`)
      .send(initialize)
      .expect(401);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${mcpNoSelfToken}`)
      .send(initialize)
      .expect(403);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Origin', 'https://evil.example')
      .send(initialize)
      .expect(403);
    await request(app.getHttpServer())
      .options('/mcp')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(403);
    await request(app.getHttpServer())
      .options('/MCP')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(403);
    await request(app.getHttpServer())
      .options('/mcp')
      .set('Origin', 'https://allowed.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect('Access-Control-Allow-Origin', 'https://allowed.example')
      .expect(204);
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${mcpWriteAToken}`)
      .set('Origin', 'https://allowed.example')
      .set('Accept', 'application/json, text/event-stream')
      .send(initialize)
      .expect(200);
  });

  it('returns protocol errors for unsupported stateless methods', async () => {
    await request(app.getHttpServer())
      .get('/mcp')
      .set('Authorization', `Bearer ${mcpReadAToken}`)
      .expect('Allow', 'POST')
      .expect(405)
      .expect(({ body }) => expect(body).toMatchObject({ jsonrpc: '2.0', error: {} }));

    await request(app.getHttpServer())
      .delete('/mcp')
      .set('Authorization', `Bearer ${mcpReadAToken}`)
      .expect('Allow', 'POST')
      .expect(405);
  });

  it('rejects JSON-RPC batches to keep per-request work bounded', async () => {
    await request(app.getHttpServer())
      .post('/mcp')
      .set('Authorization', `Bearer ${mcpReadAToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send([
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ])
      .expect(400)
      .expect(({ body }) => {
        expect(body).toEqual({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'JSON-RPC batch requests are not supported.' },
          id: null,
        });
      });
  });

  it('rejects MCP tokens from REST and keeps the normal REST response envelope', async () => {
    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${mcpReadAToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${webAToken}`)
      .expect(200)
      .expect({ message: 'success', data: { ok: true }, statusCode: 200 });
  });

  it('returns dedicated MCP tokens with non-cacheable HTTP headers', async () => {
    await request(app.getHttpServer())
      .post('/auth/mcp-token')
      .set('Authorization', `Bearer ${webAToken}`)
      .send({ access: 'read' })
      .expect('Cache-Control', 'no-store')
      .expect('Pragma', 'no-cache')
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual({
          message: 'success',
          data: {
            token: 'issued-mcp-token',
            expiresInSeconds: 2_592_000,
            scopes: ['mcp:read'],
          },
          statusCode: 201,
        });
      });

    expect(authService.issueMcpToken).toHaveBeenCalledWith(userAUuid, 'read');
  });
  it('applies scope changes and revocation on the next request of an already connected managed client', async () => {
    const client = await createClient(managedToken);
    let tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain('afterlife_get_letter');
    expect(tools).not.toContain('afterlife_get_contact');
    managedScopes = ['mcp:read'];
    tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).not.toContain('afterlife_get_letter');
    const denied = await client.callTool({
      name: 'afterlife_get_letter',
      arguments: { letterUuid: '33333333-3333-4333-8333-333333333333' },
    });
    expect(denied.isError).toBe(true);
    managedRevoked = true;
    await expect(client.listTools()).rejects.toThrow();
  });
});
