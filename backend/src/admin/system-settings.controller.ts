import { Body, Controller, Get, Put } from '@nestjs/common';
import { Permission } from 'src/permission/permission.decorator';
import { ApplicationRestartService } from 'src/setup/application-restart.service';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsStatus, UpdateSystemSettings } from './system-settings.types';

@Controller('admin/settings')
@Permission('admin')
export class SystemSettingsController {
  constructor(
    private readonly systemSettingsService: SystemSettingsService,
    private readonly applicationRestartService: ApplicationRestartService,
  ) {}

  @Get()
  getSettings(): SystemSettingsStatus {
    return this.systemSettingsService.getSettings();
  }

  @Put()
  async updateSettings(@Body() body: UpdateSystemSettings): Promise<SystemSettingsStatus> {
    const settings = await this.systemSettingsService.updateSettings(body);
    this.applicationRestartService.scheduleRestart();
    return settings;
  }
}
