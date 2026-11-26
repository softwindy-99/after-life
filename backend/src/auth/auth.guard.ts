import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  MethodNotAllowedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY, MCP_ONLY_KEY } from './auth.decorator';
import { PERMISSIONS_KEY, SELF_PERMISSION } from 'src/permission/permission.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Auth } from './auth.entity';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { JwtPayload, McpScope, UserPayload } from './auth.d';
import { isMcpAudience, isMcpScope } from './auth-token';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(Auth) private readonly authRepository: Repository<Auth>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadataTargets = [context.getHandler(), context.getClass()];
    const isMcpOnly =
      this.reflector.getAllAndOverride<boolean>(MCP_ONLY_KEY, metadataTargets) === true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [...metadataTargets]);
    if (isPublic && !isMcpOnly) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: JwtPayload & { iat?: number; exp?: number };
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload & { iat?: number; exp?: number }>(
        token,
        {
          secret: process.env.JWT_SECRET,
        },
      );
    } catch {
      throw new UnauthorizedException();
    }

    if (isMcpAudience(payload.aud) !== isMcpOnly) {
      throw new UnauthorizedException();
    }

    const authRecord = await this.authRepository.findOne({
      where: { tokenHash: this.hashToken(token), iSdelete: 0 },
      relations: { user: { role: { permissions: true } } },
    });
    const currentUser = authRecord?.user;
    const currentRole = currentUser?.role;
    if (
      !currentUser ||
      currentUser.uuid !== payload.uuid ||
      currentUser.iSdelete !== 0 ||
      !currentRole ||
      currentRole.iSdelete !== 0
    ) {
      throw new UnauthorizedException();
    }

    const currentPermissions = (currentRole.permissions || [])
      .filter((permission) => permission.iSdelete === 0)
      .map((permission) => permission.name);
    if (isMcpOnly && authRecord.mcpExpiresAt && authRecord.mcpExpiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException();
    }
    const mcpScopes = this.extractMcpScopes(authRecord.mcpScopes ?? payload.mcpScopes);
    if (isMcpOnly && authRecord.mcpScopes) {
      await this.authRepository.update(
        { id: authRecord.id, iSdelete: 0 },
        { mcpLastUsedAt: new Date() },
      );
    }
    request.user = {
      uuid: currentUser.uuid,
      email: currentUser.email,
      role: currentRole.name,
      permissions: currentPermissions,
      iat: payload.iat,
      exp: payload.exp,
      ...(isMcpOnly
        ? {
            aud: payload.aud,
            mcpScopes,
            ...(authRecord.uuid ? { authUuid: authRecord.uuid } : {}),
            ...(Array.isArray(authRecord.mcpScopes) ? { mcpManaged: true } : {}),
          }
        : {}),
    } as UserPayload;

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ...metadataTargets,
    ]);

    if (requiredPermissions) {
      const userPermissions = request.user.permissions || [];

      if (requiredPermissions.includes(SELF_PERMISSION)) {
        this.validateSelfPermission(request);
      }

      const normalPermissions = requiredPermissions.filter(
        (permission) => permission !== SELF_PERMISSION,
      );
      if (
        normalPermissions.length > 0 &&
        !normalPermissions.every((permission) => userPermissions.includes(permission))
      ) {
        throw new ForbiddenException();
      }
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private extractMcpScopes(scopes: unknown): McpScope[] {
    if (!Array.isArray(scopes)) return [];
    return scopes.filter(isMcpScope);
  }

  private validateSelfPermission(request: Request): void {
    // Resource ownership belongs to principal-scoped service queries.
    if (!request.user.permissions.includes(SELF_PERMISSION)) {
      throw new ForbiddenException();
    }

    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      throw new MethodNotAllowedException();
    }
  }
}
