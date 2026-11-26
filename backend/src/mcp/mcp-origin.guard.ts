import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { isMcpOriginAllowed } from './mcp-origin.middleware';

@Injectable()
export class McpOriginGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const configured = this.configService.get<string>('MCP_ALLOWED_ORIGINS');
    if (!isMcpOriginAllowed(request.headers.origin, configured)) {
      throw new ForbiddenException('origin is not allowed for MCP');
    }
    return true;
  }
}
