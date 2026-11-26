import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { McpOnly } from 'src/auth/auth.decorator';
import { McpAccessGuard } from './mcp-access.guard';
import { McpHttpService } from './mcp-http.service';
import { McpOriginGuard } from './mcp-origin.guard';
import { McpPrincipal } from './mcp.types';

@Controller('mcp')
@McpOnly()
@UseGuards(McpAccessGuard, McpOriginGuard)
export class McpController {
  constructor(private readonly httpService: McpHttpService) {}

  @Post()
  async post(@Req() request: Request, @Res() response: Response): Promise<void> {
    const user = request.user;
    if (!user?.uuid || !user.mcpScopes) throw new UnauthorizedException();
    const principal: McpPrincipal = {
      ...(user.authUuid ? { authUuid: user.authUuid } : {}),
      uuid: user.uuid,
      permissions: user.permissions ?? [],
      mcpScopes: user.mcpScopes,
      ...(user.mcpManaged ? { mcpManaged: true } : {}),
    };
    await this.httpService.handlePost(request, response, principal);
  }

  @Get()
  get(@Res() response: Response): void {
    this.methodNotAllowed(response);
  }

  @Delete()
  delete(@Res() response: Response): void {
    this.methodNotAllowed(response);
  }

  private methodNotAllowed(response: Response): void {
    response.setHeader('Allow', 'POST');
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  }
}
