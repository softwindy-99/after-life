import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, RequestHandler, Response } from 'express';

export function parseMcpAllowedOrigins(configured: string | undefined): ReadonlySet<string> {
  return new Set(
    (configured ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isMcpOriginAllowed(
  origin: string | undefined,
  configured: string | undefined,
): boolean {
  if (!origin) return true;
  return parseMcpAllowedOrigins(configured).has(origin);
}

export function createMcpOriginMiddleware(configService: ConfigService): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const normalizedPath = request.path.toLowerCase();
    const isMcpRequest =
      normalizedPath === '/mcp' ||
      normalizedPath.startsWith('/mcp/') ||
      normalizedPath === '/mcp-files' ||
      normalizedPath.startsWith('/mcp-files/');
    if (!isMcpRequest) {
      next();
      return;
    }

    const configured = configService.get<string>('MCP_ALLOWED_ORIGINS');
    if (isMcpOriginAllowed(request.headers.origin, configured)) {
      next();
      return;
    }

    response.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Origin is not allowed for MCP.' },
      id: null,
    });
  };
}

export function configureMcpOriginProtection(
  app: INestApplication,
  configService: ConfigService,
  apiPath = '/',
): void {
  app.use(apiPath, createMcpOriginMiddleware(configService));
}
