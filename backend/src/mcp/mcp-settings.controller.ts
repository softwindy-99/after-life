import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Self } from 'src/permission/permission.decorator';
import { SchemaPipe } from 'src/validation';
import { McpSettingsService, managedScopes } from './mcp-settings.service';

const grantFields = {
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(
      z.enum(
        managedScopes as [(typeof managedScopes)[number], ...(typeof managedScopes)[number][]],
      ),
    )
    .max(8)
    .refine((scopes) => new Set(scopes).size === scopes.length),
};
function dependencies(input: { scopes?: string[] }): boolean {
  const has = (value: string): boolean => input.scopes?.includes(`mcp:${value}`);
  return (
    (!has('letters:write') || has('letters:read')) &&
    (!has('contacts:write') || has('contacts:read')) &&
    (!has('resources:write') || has('resources:read')) &&
    (!has('delivery:write') ||
      (has('letters:read') && has('contacts:read') && has('resources:read')))
  );
}
const grantSchema = z
  .object(grantFields)
  .strict()
  .refine(dependencies, '写入需要相应读取权限；检测管理需要信件、联系人和附件读取权限。');
const createSchema = z
  .object({ ...grantFields, days: z.number().int().min(1).max(90).nullable().default(30) })
  .strict()
  .refine(dependencies, '请同时授权相关读取权限。');

@Controller('mcp-settings')
@Self()
export class McpSettingsController {
  constructor(private readonly settings: McpSettingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(
    @Req() req: Request,
    @Query('page', new SchemaPipe(z.coerce.number().int().min(1).max(100000).default(1)))
    page: number,
  ): Promise<object> {
    return this.settings.getSettings(req.user.uuid, page);
  }

  @Post('grants')
  @Header('Cache-Control', 'no-store')
  create(
    @Req() req: Request,
    @Body(new SchemaPipe(createSchema)) body: z.infer<typeof createSchema>,
  ): Promise<object> {
    return this.settings.create(req.user.uuid, {
      name: body.name,
      scopes: body.scopes,
      days: body.days,
    });
  }

  @Patch('grants/:uuid')
  update(
    @Req() req: Request,
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body(new SchemaPipe(grantSchema)) body: z.infer<typeof grantSchema>,
  ): Promise<void> {
    return this.settings.update(req.user.uuid, uuid, { name: body.name, scopes: body.scopes });
  }

  @Delete('grants/:uuid')
  revoke(@Req() req: Request, @Param('uuid', new ParseUUIDPipe()) uuid: string): Promise<void> {
    return this.settings.revoke(req.user.uuid, uuid);
  }

  @Delete('grants')
  revokeAll(@Req() req: Request): Promise<void> {
    return this.settings.revokeAll(req.user.uuid);
  }

  @Get('approvals/:uuid')
  @Header('Cache-Control', 'no-store')
  getApproval(
    @Req() req: Request,
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
  ): Promise<object> {
    return this.settings.getApproval(req.user.uuid, uuid);
  }

  @Post('approvals/:uuid')
  approve(
    @Req() req: Request,
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body(new SchemaPipe(z.object({ approve: z.boolean() }).strict())) body: { approve: boolean },
  ): Promise<void> {
    return this.settings.approve(req.user.uuid, uuid, body.approve);
  }
}
