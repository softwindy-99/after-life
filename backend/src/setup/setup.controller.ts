import { BadRequestException, Body, Controller, Get, Header, Post } from '@nestjs/common';
import { Public } from 'src/auth/auth.decorator';
import { SetupPayload, SetupService } from './setup.service';
import { ApplicationRestartService } from './application-restart.service';

@Controller('setup')
export class SetupController {
  constructor(
    private readonly setupService: SetupService,
    private readonly applicationRestartService: ApplicationRestartService,
  ) {}

  @Public()
  @Get('status')
  @Header('Cache-Control', 'no-store')
  getStatus(): ReturnType<SetupService['getStatus']> {
    return this.setupService.getStatus();
  }

  @Public()
  @Post()
  async initialize(@Body() payload: SetupPayload) {
    this.requireResetConfirmation(payload);
    const result = await this.setupService.initialize(payload);
    this.applicationRestartService.scheduleRestart();
    return result;
  }

  @Public()
  @Post('database/check')
  checkDatabase(@Body() payload: SetupPayload = {}) {
    return this.setupService.checkDatabase(payload);
  }

  @Public()
  @Post('database/initialize')
  initializeDatabase(@Body() payload: SetupPayload = {}) {
    this.requireResetConfirmation(payload);
    return this.setupService.initializeDatabase(payload);
  }

  @Public()
  @Post('database/migrate')
  migrateDatabase(@Body() payload: SetupPayload = {}) {
    return this.setupService.migrateDatabase(payload);
  }

  @Public()
  @Post('database/seed')
  seedDatabase(@Body() payload: SetupPayload = {}) {
    return this.setupService.seedDatabase(payload);
  }

  private requireResetConfirmation(payload: SetupPayload): void {
    if (payload?.resetDatabase !== undefined && typeof payload.resetDatabase !== 'boolean') {
      throw new BadRequestException('resetDatabase must be a boolean.');
    }
  }

  @Public()
  @Post('database/reset')
  resetDatabase(@Body() payload: SetupPayload = {}) {
    if (payload?.resetDatabase !== true) {
      throw new BadRequestException('resetDatabase: true is required to confirm database reset.');
    }
    return this.setupService.resetDatabase(payload);
  }
}
