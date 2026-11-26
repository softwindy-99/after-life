import { BadRequestException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const request = { user: { uuid: 'user-1' } } as any;

  it('delegates sign-in to AuthService', async () => {
    const authService = {
      signIn: jest.fn().mockResolvedValue('token'),
    };
    const controller = new AuthController(authService as any);

    await expect(controller.sign({ email: 'alice@example.com', password: 'secret' })).resolves.toBe(
      'token',
    );

    expect(authService.signIn).toHaveBeenCalledWith('alice@example.com', 'secret');
  });

  it.each([
    [undefined, 'read'],
    [{}, 'read'],
    [{ access: 'read' }, 'read'],
    [{ access: 'read_write' }, 'read_write'],
  ])('issues an MCP token with normalized access from %p', async (body, expectedAccess) => {
    const response = {
      token: 'mcp-token',
      expiresInSeconds: 2_592_000,
      scopes: ['mcp:read'],
    };
    const authService = {
      issueMcpToken: jest.fn().mockResolvedValue(response),
    };
    const controller = new AuthController(authService as any);

    await expect(controller.issueMcpToken(request, body)).resolves.toBe(response);
    expect(authService.issueMcpToken).toHaveBeenCalledWith('user-1', expectedAccess);
  });

  it.each([
    ['read-only'],
    [[]],
    [{ access: 'write' }],
    [{ access: 'read', userUuid: 'other-user' }],
  ])('rejects invalid MCP token input %p', (body) => {
    const authService = { issueMcpToken: jest.fn() };
    const controller = new AuthController(authService as any);

    expect(() => controller.issueMcpToken(request, body)).toThrow(BadRequestException);
    expect(authService.issueMcpToken).not.toHaveBeenCalled();
  });

  it('revokes the current user MCP tokens', async () => {
    const authService = {
      revokeMcpTokens: jest.fn().mockResolvedValue(2),
    };
    const controller = new AuthController(authService as any);

    await expect(controller.revokeMcpTokens(request)).resolves.toEqual({ revoked: 2 });
    expect(authService.revokeMcpTokens).toHaveBeenCalledWith('user-1');
  });

  it('marks MCP token responses as non-cacheable', () => {
    const headers = Reflect.getMetadata(
      HEADERS_METADATA,
      AuthController.prototype.issueMcpToken,
    ) as Array<{ name: string; value: string }>;

    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'Pragma', value: 'no-cache' },
      ]),
    );
  });
});
