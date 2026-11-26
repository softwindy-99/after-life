import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { McpAccessGuard } from './mcp-access.guard';
import { McpOriginGuard } from './mcp-origin.guard';

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

describe('MCP guards', () => {
  describe('McpAccessGuard', () => {
    const guard = new McpAccessGuard();

    it('requires an authenticated principal', () => {
      expect(() => guard.canActivate(contextFor({}))).toThrow(UnauthorizedException);
    });

    it('requires explicit self permission', () => {
      expect(() =>
        guard.canActivate(
          contextFor({ user: { uuid: 'user-1', permissions: [], mcpScopes: ['mcp:read'] } }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('requires the mcp:read scope', () => {
      expect(() =>
        guard.canActivate(
          contextFor({ user: { uuid: 'user-1', permissions: ['self'], mcpScopes: [] } }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('allows a principal with self permission', () => {
      expect(
        guard.canActivate(
          contextFor({
            user: {
              uuid: 'user-1',
              permissions: ['admin', 'self'],
              mcpScopes: ['mcp:read'],
            },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('McpOriginGuard', () => {
    const configService = {
      get: jest.fn(() => 'https://allowed.example, https://second.example'),
    };
    const guard = new McpOriginGuard(configService as any);

    it('allows non-browser clients without Origin', () => {
      expect(guard.canActivate(contextFor({ headers: {} }))).toBe(true);
    });

    it('allows only exact configured browser origins', () => {
      expect(guard.canActivate(contextFor({ headers: { origin: 'https://second.example' } }))).toBe(
        true,
      );
      expect(() =>
        guard.canActivate(contextFor({ headers: { origin: 'https://evil.example' } })),
      ).toThrow(ForbiddenException);
    });
  });
});
