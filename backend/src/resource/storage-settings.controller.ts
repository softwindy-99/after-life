import { Body, Controller, Get, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { Permission } from 'src/permission/permission.decorator';
import { ResourceStorageService, StorageStatus } from './resource-storage.service';

@Controller('admin/storage')
@Permission('admin')
export class StorageSettingsController {
  constructor(private readonly storage: ResourceStorageService) {}

  @Get()
  status(@Req() request: Request): Promise<StorageStatus> {
    return this.storage.status(request.user.uuid);
  }

  @Put()
  configure(@Req() request: Request, @Body() body: unknown): Promise<StorageStatus> {
    return this.storage.configure(request.user.uuid, body);
  }

  @Post('test')
  test(@Body() body: unknown): Promise<{ ok: true }> {
    return this.storage.test(body);
  }

  @Post('migrate')
  migrate(@Req() request: Request): Promise<{ migrated: number; remaining: number }> {
    return this.storage.migrate(request.user.uuid);
  }
}
