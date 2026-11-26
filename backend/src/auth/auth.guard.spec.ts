import {
  ForbiddenException,
  MethodNotAllowedException,
  UnauthorizedException,
} from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { PERMISSIONS_KEY, SELF_PERMISSION } from 'src/permission/permission.decorator';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { IS_PUBLIC_KEY, MCP_ONLY_KEY } from './auth.decorator';
import { Auth } from './auth.entity';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let authRepository: ReturnType<typeof createMockRepository>;

  const createContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    }) as any;

  const activeAuthRecord = (overrides: Record<string, unknown> = {}) => ({
    token: 'valid-token',
    user: {
      uuid: 'user-1',
      email: 'current@example.com',
      iSdelete: 0,
      role: {
        name: 'current-role',
        iSdelete: 0,
        permissions: [
          { name: 'admin', iSdelete: 0 },
          { name: 'self', iSdelete: 0 },
        ],
      },
    },
    ...overrides,
  });

  const mockMetadata = (options: {
    isPublic?: boolean;
    mcpOnly?: boolean;
    permissions?: string[];
  }) => {
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return options.isPublic;
      if (key === MCP_ONLY_KEY) return options.mcpOnly;
      if (key === PERMISSIONS_KEY) return options.permissions;
      return undefined;
    });
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    reflector = { getAllAndOverride: jest.fn() };
    authRepository = createMockRepository();
    process.env.JWT_SECRET = 'test-secret';

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: Reflector, useValue: reflector },
        { provide: getRepositoryToken(Auth), useValue: authRepository },
      ],
    }).compile();

    guard = moduleRef.get(AuthGuard);
  });

  it('allows public routes without a token', async () => {
    mockMetadata({ isPublic: true });

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('does not let Public bypass McpOnly authentication', async () => {
    mockMetadata({ isPublic: true, mcpOnly: true });

    await expect(guard.canActivate(createContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects requests without bearer token', async () => {
    mockMetadata({});

    await expect(guard.canActivate(createContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects requests with missing persisted token', async () => {
    const request: any = {
      headers: { authorization: 'Bearer valid-token' },
    };

    mockMetadata({});
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1' });
    authRepository.findOne.mockResolvedValue(null);

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authRepository.findOne).toHaveBeenCalledWith({
      where: { tokenHash: expect.any(String), iSdelete: 0 },
      relations: { user: { role: { permissions: true } } },
    });
  });

  it('rejects an MCP audience token on an ordinary REST route', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    mockMetadata({});
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1', aud: 'mcp' });

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects an ordinary token on an MCP-only route', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    mockMetadata({ mcpOnly: true });
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1' });

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authRepository.findOne).not.toHaveBeenCalled();
  });

  it('binds an MCP-only request to current database identity and signed scopes', async () => {
    const request: any = {
      method: 'POST',
      params: {},
      query: {},
      body: {},
      headers: { authorization: 'Bearer valid-token' },
    };
    mockMetadata({ mcpOnly: true });
    jwtService.verifyAsync.mockResolvedValue({
      uuid: 'user-1',
      email: 'stale@example.com',
      role: 'stale-role',
      permissions: ['stale-permission'],
      aud: ['other', 'mcp'],
      mcpScopes: ['mcp:read', 'invalid'],
      iat: 1,
      exp: 2,
    });
    authRepository.findOne.mockResolvedValue(activeAuthRecord());

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      uuid: 'user-1',
      email: 'current@example.com',
      role: 'current-role',
      permissions: ['admin', 'self'],
      aud: ['other', 'mcp'],
      mcpScopes: ['mcp:read'],
      iat: 1,
      exp: 2,
    });
  });

  it.each([
    ['deleted user', { iSdelete: 1 }],
    ['deleted role', { role: { name: 'user', iSdelete: 1, permissions: [] } }],
  ])('rejects an MCP token for a %s', async (_label, userOverrides) => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    mockMetadata({ mcpOnly: true });
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1', aud: 'mcp' });
    authRepository.findOne.mockResolvedValue(
      activeAuthRecord({
        user: {
          ...activeAuthRecord().user,
          ...userOverrides,
        },
      }),
    );

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token whose subject does not own the persisted session', async () => {
    const request = { headers: { authorization: 'Bearer valid-token' } };
    mockMetadata({});
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'other-user' });
    authRepository.findOne.mockResolvedValue(activeAuthRecord());

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows resource UUIDs unrelated to the current user UUID', async () => {
    const request = {
      method: 'GET',
      params: { uuid: 'user-2' },
      query: {},
      body: {},
      headers: { authorization: 'Bearer valid-token' },
    };

    mockMetadata({ permissions: [SELF_PERMISSION] });
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1', permissions: [] });
    authRepository.findOne.mockResolvedValue(activeAuthRecord());

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
  });

  it('rejects unsupported methods for self permission', async () => {
    const request = {
      method: 'OPTIONS',
      params: {},
      query: {},
      body: {},
      headers: { authorization: 'Bearer valid-token' },
    };

    mockMetadata({ permissions: [SELF_PERMISSION] });
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1' });
    authRepository.findOne.mockResolvedValue(activeAuthRecord());

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      MethodNotAllowedException,
    );
  });

  it('rejects permissions removed from the current role', async () => {
    const request = {
      method: 'GET',
      params: {},
      query: {},
      body: {},
      headers: { authorization: 'Bearer valid-token' },
    };

    mockMetadata({ permissions: ['admin'] });
    jwtService.verifyAsync.mockResolvedValue({ uuid: 'user-1', permissions: ['admin'] });
    authRepository.findOne.mockResolvedValue(
      activeAuthRecord({
        user: {
          ...activeAuthRecord().user,
          role: {
            name: 'current-role',
            iSdelete: 0,
            permissions: [{ name: 'admin', iSdelete: 1 }],
          },
        },
      }),
    );

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows authenticated requests with current required permissions', async () => {
    const request = {
      method: 'PUT',
      params: { uuid: 'user-1' },
      query: {},
      body: {},
      headers: { authorization: 'Bearer valid-token' },
    };

    mockMetadata({ permissions: ['admin', SELF_PERMISSION] });
    jwtService.verifyAsync.mockResolvedValue({
      uuid: 'user-1',
      permissions: [],
    });
    authRepository.findOne.mockResolvedValue(activeAuthRecord());

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
  });
  it.each([null, new Date(Date.now() + 60000)])(
    'takes managed permissions from storage with expiry %s and honors reductions and revocation',
    async (expiresAt) => {
      const request: any = { headers: { authorization: 'Bearer valid-token' } };
      mockMetadata({ mcpOnly: true });
      jwtService.verifyAsync.mockResolvedValue({
        uuid: 'user-1',
        aud: 'mcp',
        mcpScopes: ['mcp:read', 'mcp:delivery:write'],
      });
      authRepository.findOne.mockResolvedValue(
        activeAuthRecord({
          id: 1,
          uuid: 'grant-1',
          mcpScopes: ['mcp:read', 'mcp:letters:read'],
          mcpExpiresAt: expiresAt,
        }),
      );
      await guard.canActivate(createContext(request));
      expect(request.user.mcpScopes).toEqual(['mcp:read', 'mcp:letters:read']);
      expect(request.user.mcpManaged).toBe(true);
      expect(request.user.authUuid).toBe('grant-1');
      authRepository.findOne.mockResolvedValue(null);
      await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      authRepository.findOne.mockResolvedValue(
        activeAuthRecord({ mcpScopes: ['mcp:read'], mcpExpiresAt: new Date(0) }),
      );
      await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    },
  );
});
