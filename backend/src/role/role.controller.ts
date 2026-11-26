import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { Permission as NeedPermission } from 'src/permission/permission.decorator';
import { RoleDto, toRoleDto } from './role.dto';
import { SchemaPipe, uuidSchema } from 'src/validation';
import { z } from 'zod';
import { RoleService } from './role.service';

@Controller('role')
@NeedPermission('admin')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  async findAll(): Promise<RoleDto[]> {
    return (await this.roleService.findAll()).map(toRoleDto);
  }

  @Put(':uuid/permissions')
  async updatePermissions(
    @Param('uuid', new ParseUUIDPipe()) uuid: string,
    @Body(new SchemaPipe(z.object({ permissionUuids: z.array(uuidSchema).max(100) }).strict()))
    body: { permissionUuids?: string[] },
  ): Promise<RoleDto> {
    const role = await this.roleService.updatePermissions(uuid, body.permissionUuids ?? []);
    if (!role) throw new NotFoundException('role not found');
    return toRoleDto(role);
  }
}
