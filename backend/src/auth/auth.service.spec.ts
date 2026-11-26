import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UserService } from 'src/user/user.service';
import { Auth } from './auth.entity';
import { createMockRepository } from 'src/test-utils/mock-repository';
import { hashPassword } from './password';
import { MCP_TOKEN_EXPIRES_IN_SECONDS } from './auth-token';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findForAuthentication: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let authRepository: ReturnType<typeof createMockRepository>;

  const activeUser = () => ({
    uuid: 'user-1',
    email: 'alice@example.com',
    password: createHash('sha256').update('secret').digest('hex'),
    iSdelete: 0,
    role: {
      name: 'admin',
      iSdelete: 0,
      permissions: [
        { name: 'admin', iSdelete: 0 },
        { name: 'self', iSdelete: 0 },
      ],
    },
  });

  beforeEach(async () => {
    usersService = {
      findForAuthentication: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    jwtService = { signAsync: jest.fn() };
    authRepository = createMockRepository();
    authRepository.create.mockImplementation((value) => value);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: getRepositoryToken(Auth), useValue: authRepository },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('returns the bearer while persisting only a hash and non-secret marker', async () => {
    const user = activeUser();
    usersService.findForAuthentication.mockResolvedValue(user);
    jwtService.signAsync.mockResolvedValue('signed-token');
    authRepository.save.mockResolvedValue({ token: 'signed-token', user });

    await expect(service.signIn('alice@example.com', 'secret')).resolves.toBe('signed-token');

    expect(usersService.findForAuthentication).toHaveBeenCalledWith('alice@example.com');
    expect(usersService.update).toHaveBeenCalledWith('user-1', {
      password: 'secret',
    });
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      {
        uuid: 'user-1',
        email: 'alice@example.com',
        role: 'admin',
        permissions: ['admin', 'self'],
      },
      { expiresIn: 86400, jwtid: expect.any(String) },
    );
    expect(authRepository.save).toHaveBeenCalledWith({
      token: expect.stringMatching(/^rest:[0-9a-f-]{36}$/),
      tokenHash: createHash('sha256').update('signed-token').digest('hex'),
      user,
    });
  });

  it('rejects missing users', async () => {
    usersService.findForAuthentication.mockResolvedValue(null);

    await expect(service.signIn('alice@example.com', 'secret')).rejects.toEqual(
      new HttpException('wrong email or password', HttpStatus.NOT_ACCEPTABLE),
    );
  });

  it('rejects wrong passwords', async () => {
    usersService.findForAuthentication.mockResolvedValue({
      password: createHash('sha256').update('other').digest('hex'),
    });

    await expect(service.signIn('alice@example.com', 'secret')).rejects.toEqual(
      new HttpException('wrong email or password', HttpStatus.NOT_ACCEPTABLE),
    );
  });

  it('does not rehash users that already use scrypt', async () => {
    usersService.findForAuthentication.mockResolvedValue({
      uuid: 'user-1',
      email: 'alice@example.com',
      password: await hashPassword('secret'),
      role: null,
    });
    jwtService.signAsync.mockResolvedValue('signed-token');

    await service.signIn('alice@example.com', 'secret');

    expect(usersService.update).not.toHaveBeenCalled();
  });

  it.each([
    ['read', ['mcp:read']],
    ['read_write', ['mcp:read', 'mcp:write']],
  ] as const)('issues and persists a 30-day %s MCP token', async (access, scopes) => {
    const user = activeUser();
    usersService.findOne.mockResolvedValue(user);
    jwtService.signAsync.mockResolvedValue('mcp-token');

    await expect(service.issueMcpToken('user-1', access)).resolves.toEqual({
      token: 'mcp-token',
      expiresInSeconds: MCP_TOKEN_EXPIRES_IN_SECONDS,
      scopes,
    });

    expect(usersService.findOne).toHaveBeenCalledWith({ uuid: 'user-1', iSdelete: 0 }, [
      'role',
      'role.permissions',
    ]);
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      {
        uuid: 'user-1',
        email: 'alice@example.com',
        role: 'admin',
        permissions: ['admin', 'self'],
        mcpScopes: scopes,
      },
      {
        audience: 'mcp',
        expiresIn: MCP_TOKEN_EXPIRES_IN_SECONDS,
        jwtid: expect.any(String),
      },
    );
    const jwtId = jwtService.signAsync.mock.calls[0][1].jwtid;
    expect(authRepository.save).toHaveBeenCalledWith({
      token: `mcp:${jwtId}`,
      tokenHash: createHash('sha256').update('mcp-token').digest('hex'),
      user,
    });
  });

  it.each([null, 7, 30, 90])(
    'signs managed credentials with days=%s and stores matching expiry',
    async (days) => {
      const user = activeUser();
      usersService.findOne.mockResolvedValue(user);
      const signer = new JwtService({ secret: 'test-mcp-secret' });
      const issuer = new AuthService(usersService as any, signer, authRepository as any);
      const result = await issuer.issueMcpToken('user-1', 'read', {
        name: 'My agent',
        scopes: ['mcp:letters:read'],
        days,
      });
      const payload = await signer.verifyAsync(result.token, { audience: 'mcp' });
      const saved = authRepository.save.mock.calls[0][0];

      expect(result.expiresInSeconds).toBe(days === null ? null : days * 86400);
      expect(payload.mcpScopes).toEqual(['mcp:read', 'mcp:letters:read']);
      expect(saved).toMatchObject({
        mcpName: 'My agent',
        mcpScopes: result.scopes,
        token: `mcp:${payload.jti}`,
        tokenHash: createHash('sha256').update(result.token).digest('hex'),
      });
      if (days === null) {
        expect(payload).not.toHaveProperty('exp');
        expect(saved.mcpExpiresAt).toBeNull();
        await expect(
          signer.verifyAsync(result.token, {
            audience: 'mcp',
            clockTimestamp: payload.iat + 100 * 365 * 86400,
          }),
        ).resolves.toMatchObject({ uuid: 'user-1' });
      } else {
        expect(payload.exp - payload.iat).toBe(days * 86400);
        expect(Math.abs(saved.mcpExpiresAt.getTime() - payload.exp * 1000)).toBeLessThan(1000);
        await expect(
          signer.verifyAsync(result.token, { audience: 'mcp', clockTimestamp: payload.exp }),
        ).rejects.toThrow('jwt expired');
      }
    },
  );

  it('keeps REST sessions limited to one day', async () => {
    usersService.findForAuthentication.mockResolvedValue(activeUser());
    const signer = new JwtService({ secret: 'test-rest-secret' });
    const issuer = new AuthService(usersService as any, signer, authRepository as any);
    const token = await issuer.signIn('alice@example.com', 'secret');
    const payload = await signer.verifyAsync(token);
    expect(payload.exp - payload.iat).toBe(86400);
  });

  it.each([
    ['missing user', null],
    ['missing role', { ...activeUser(), role: null }],
    ['deleted role', { ...activeUser(), role: { ...activeUser().role, iSdelete: 1 } }],
  ])('rejects MCP token issuance for a %s', async (_label, user) => {
    usersService.findOne.mockResolvedValue(user);

    await expect(service.issueMcpToken('user-1', 'read')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it('revokes only the current user MCP token markers', async () => {
    authRepository.find.mockResolvedValue([
      { uuid: 'mcp-1', token: 'mcp:jti-1' },
      { uuid: 'web-1', token: 'web-token' },
      { uuid: 'mcp-2', token: 'mcp:jti-2' },
      { uuid: 'empty', token: '' },
    ]);
    authRepository.update.mockResolvedValue({ affected: 2 });

    await expect(service.revokeMcpTokens('user-1')).resolves.toBe(2);

    expect(authRepository.find).toHaveBeenCalledWith({
      where: { user: { uuid: 'user-1' }, iSdelete: 0 },
    });
    const [criteria, changes] = authRepository.update.mock.calls[0];
    expect(criteria.iSdelete).toBe(0);
    expect(criteria.uuid.value).toEqual(['mcp-1', 'mcp-2']);
    expect(changes).toEqual({ iSdelete: 1, token: '' });
  });

  it('does not write when the user has no MCP tokens', async () => {
    authRepository.find.mockResolvedValue([
      { uuid: 'web-1', token: 'web-token' },
      { uuid: 'invalid', token: 'invalid-token' },
    ]);

    await expect(service.revokeMcpTokens('user-1')).resolves.toBe(0);
    expect(authRepository.update).not.toHaveBeenCalled();
  });

  it('does not treat a legacy plaintext token as an MCP marker', async () => {
    authRepository.find.mockResolvedValue([{ uuid: 'legacy', token: 'signed.jwt.value' }]);

    await expect(service.revokeMcpTokens('user-1')).resolves.toBe(0);
    expect(authRepository.update).not.toHaveBeenCalled();
  });

  it('builds a default payload when role information is absent', () => {
    expect(
      service.userToJwtpayload({
        uuid: 'user-1',
        email: 'alice@example.com',
        role: null,
      } as any),
    ).toEqual({
      uuid: 'user-1',
      email: 'alice@example.com',
      role: 'user',
      permissions: ['self'],
    });
  });

  it('excludes deleted permissions from newly signed payloads', () => {
    expect(
      service.userToJwtpayload({
        ...activeUser(),
        role: {
          ...activeUser().role,
          permissions: [
            { name: 'self', iSdelete: 0 },
            { name: 'admin', iSdelete: 1 },
          ],
        },
      } as any),
    ).toMatchObject({ permissions: ['self'] });
  });
});
