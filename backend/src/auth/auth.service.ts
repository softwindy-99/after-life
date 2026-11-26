import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload, McpScope } from './auth.d';
import { User } from 'src/user/user.entity';
import { createHash, randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Auth } from './auth.entity';
import { In, Repository } from 'typeorm';
import { isLegacyPasswordHash, verifyPassword } from './password';
import { MCP_AUDIENCE, MCP_TOKEN_EXPIRES_IN_SECONDS, MCP_TOKEN_STORAGE_PREFIX } from './auth-token';

export type McpTokenAccess = 'read' | 'read_write';

export interface McpTokenResponse {
  token: string;
  expiresInSeconds: number | null;
  scopes: McpScope[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UserService,
    private readonly jwtService: JwtService,
    @InjectRepository(Auth) private readonly authRepository: Repository<Auth>,
  ) {}

  /**
   * @description login and return token
   * @param email
   * @param password
   * @return {Promise<{ token: string }>}
   */
  async signIn(email: string, password: string): Promise<string> {
    const user = await this.usersService.findForAuthentication(email);
    if (!user) throw new HttpException('wrong email or password', HttpStatus.NOT_ACCEPTABLE);
    if (!(await verifyPassword(password, user.password))) {
      throw new HttpException('wrong email or password', HttpStatus.NOT_ACCEPTABLE);
    }
    if (isLegacyPasswordHash(user.password)) {
      await this.usersService.update(user.uuid, { password });
    }
    const payload = this.userToJwtpayload(user);
    const token = await this.jwtService.signAsync(payload, {
      expiresIn: 86400,
      jwtid: randomUUID(),
    });
    await this.persistToken(token, user);
    return token;
  }

  async issueMcpToken(
    userUuid: string,
    access: McpTokenAccess,
    managed?: { name: string; scopes: McpScope[]; days: number | null },
  ): Promise<McpTokenResponse> {
    const user = await this.usersService.findOne({ uuid: userUuid, iSdelete: 0 }, [
      'role',
      'role.permissions',
    ]);
    if (!user || !user.role || user.role.iSdelete !== 0) {
      throw new UnauthorizedException();
    }

    const scopes: McpScope[] = managed
      ? ['mcp:read', ...managed.scopes]
      : access === 'read_write'
        ? ['mcp:read', 'mcp:write']
        : ['mcp:read'];
    const lifetime = managed
      ? managed.days === null
        ? null
        : managed.days * 86400
      : MCP_TOKEN_EXPIRES_IN_SECONDS;
    const jwtId = randomUUID();
    const token = await this.jwtService.signAsync(
      {
        ...this.userToJwtpayload(user),
        mcpScopes: scopes,
      },
      {
        audience: MCP_AUDIENCE,
        // A permanent managed grant has no JWT expiration; storage still controls revocation.
        ...(lifetime === null ? {} : { expiresIn: lifetime }),
        jwtid: jwtId,
      },
    );
    await this.persistToken(
      token,
      user,
      `${MCP_TOKEN_STORAGE_PREFIX}${jwtId}`,
      managed
        ? {
            mcpName: managed.name,
            mcpScopes: scopes,
            mcpExpiresAt: lifetime === null ? null : new Date(Date.now() + lifetime * 1000),
          }
        : {},
    );

    return {
      token,
      expiresInSeconds: lifetime,
      scopes,
    };
  }

  async revokeMcpTokens(userUuid: string): Promise<number> {
    const authRecords = await this.authRepository.find({
      where: { user: { uuid: userUuid }, iSdelete: 0 },
    });
    const mcpTokenUuids = authRecords
      .filter((record) => record.token?.startsWith(MCP_TOKEN_STORAGE_PREFIX))
      .map((record) => record.uuid);

    if (mcpTokenUuids.length === 0) return 0;

    const result = await this.authRepository.update(
      { uuid: In(mcpTokenUuids), iSdelete: 0 },
      { iSdelete: 1, token: '' },
    );
    return result.affected ?? mcpTokenUuids.length;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async persistToken(
    token: string,
    user: User,
    storedToken = `rest:${randomUUID()}`,
    metadata: Partial<Auth> = {},
  ): Promise<void> {
    await this.authRepository.save(
      this.authRepository.create({
        ...metadata,
        token: storedToken,
        tokenHash: this.hashToken(token),
        user,
      }),
    );
  }

  /**
   * @description payload to token
   * @param {User} user
   * @return {JwtPayload}
   */
  userToJwtpayload(user: User): JwtPayload {
    return {
      uuid: user.uuid,
      email: user.email,
      role: user.role?.name || 'user',
      permissions: user.role?.permissions
        ?.filter((item) => item.iSdelete === 0)
        .map((item) => item.name) || ['self'],
    };
  }
}
