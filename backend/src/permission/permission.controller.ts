import { Controller, Get } from '@nestjs/common';
import { Permission as NeedPermission } from './permission.decorator';
import { PermissionService } from './permission.service';
import { PermissionDto, toPermissionDto } from './permission.dto';

@Controller('permission')
@NeedPermission('admin')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  async findAll(): Promise<PermissionDto[]> {
    return (await this.permissionService.findAll()).map(toPermissionDto);
  }
}
