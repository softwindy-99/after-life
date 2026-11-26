import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class McpAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user) throw new UnauthorizedException();
    if (!request.user.permissions?.includes('self')) {
      throw new ForbiddenException('self permission is required for MCP access');
    }
    if (!request.user.mcpScopes?.includes('mcp:read')) {
      throw new ForbiddenException('mcp:read scope is required for MCP access');
    }
    return true;
  }
}
