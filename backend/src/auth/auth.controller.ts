import { z } from 'zod';
import { emailSchema, SchemaPipe } from 'src/validation';
import { BadRequestException, Body, Controller, Delete, Header, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, McpTokenAccess, McpTokenResponse } from './auth.service';
import { Public } from './auth.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post()
  @Header('Cache-Control', 'no-store')
  sign(
    @Body(
      new SchemaPipe(
        z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict(),
      ),
    )
    user: {
      email: string;
      password: string;
    },
  ): Promise<string> {
    return this.authService.signIn(user.email, user.password);
  }

  @Post('mcp-token')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  issueMcpToken(@Req() request: Request, @Body() body?: unknown): Promise<McpTokenResponse> {
    return this.authService.issueMcpToken(request.user.uuid, this.parseMcpTokenAccess(body));
  }

  @Delete('mcp-token')
  async revokeMcpTokens(@Req() request: Request): Promise<{ revoked: number }> {
    return { revoked: await this.authService.revokeMcpTokens(request.user.uuid) };
  }

  private parseMcpTokenAccess(body: unknown): McpTokenAccess {
    if (body === undefined || body === null) return 'read';
    if (typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('body must be an object');
    }

    const values = body as Record<string, unknown>;
    const unsupportedKeys = Object.keys(values).filter((key) => key !== 'access');
    if (unsupportedKeys.length > 0) {
      throw new BadRequestException('only access is supported');
    }

    const access = values.access ?? 'read';
    if (access !== 'read' && access !== 'read_write') {
      throw new BadRequestException('access must be read or read_write');
    }
    return access;
  }
}
