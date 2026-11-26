import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import {
  createMcpOriginMiddleware,
  isMcpOriginAllowed,
  parseMcpAllowedOrigins,
} from './mcp-origin.middleware';

describe('MCP origin protection', () => {
  const configService = {
    get: jest.fn(() => 'https://allowed.example, https://second.example'),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('origin helpers', () => {
    it('parses a trimmed, comma-separated allowlist', () => {
      expect([...parseMcpAllowedOrigins(' https://one.example, ,https://two.example ')]).toEqual([
        'https://one.example',
        'https://two.example',
      ]);
    });

    it('allows missing Origin and requires an exact match otherwise', () => {
      expect(isMcpOriginAllowed(undefined, undefined)).toBe(true);
      expect(isMcpOriginAllowed('https://allowed.example', 'https://allowed.example')).toBe(true);
      expect(isMcpOriginAllowed('https://allowed.example.evil', 'https://allowed.example')).toBe(
        false,
      );
      expect(isMcpOriginAllowed('https://allowed.example', undefined)).toBe(false);
    });
  });

  describe('middleware', () => {
    function invoke(path: string, origin?: string, method = 'POST') {
      const middleware = createMcpOriginMiddleware(configService);
      const request = { path, method, headers: { origin } } as Request;
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));
      const response = { status } as unknown as Response;
      const next = jest.fn() as NextFunction;

      middleware(request, response, next);
      return { json, next, status };
    }

    it('does not affect non-MCP routes', () => {
      const result = invoke('/auth', 'https://evil.example');
      expect(result.next).toHaveBeenCalledTimes(1);
      expect(result.status).not.toHaveBeenCalled();
    });

    it('allows MCP clients without Origin', () => {
      const result = invoke('/mcp');
      expect(result.next).toHaveBeenCalledTimes(1);
      expect(result.status).not.toHaveBeenCalled();
    });

    it('allows an exact configured Origin for MCP subpaths', () => {
      const result = invoke('/mcp/notifications', 'https://second.example');
      expect(result.next).toHaveBeenCalledTimes(1);
      expect(result.status).not.toHaveBeenCalled();
    });

    it.each(['POST', 'OPTIONS'])('rejects a disallowed Origin before handling %s', (method) => {
      const result = invoke('/mcp', 'https://evil.example', method);
      expect(result.next).not.toHaveBeenCalled();
      expect(result.status).toHaveBeenCalledWith(403);
      expect(result.json).toHaveBeenCalledWith({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Origin is not allowed for MCP.' },
        id: null,
      });
    });

    it('protects case-insensitive route variants handled by Express', () => {
      const result = invoke('/MCP', 'https://evil.example');
      expect(result.next).not.toHaveBeenCalled();
      expect(result.status).toHaveBeenCalledWith(403);
    });
  });
});
