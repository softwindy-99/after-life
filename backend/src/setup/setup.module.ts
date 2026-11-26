import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { DatabaseSetupService } from './database-setup.service';
import { SetupService } from './setup.service';
import { ApplicationRestartService } from './application-restart.service';
import { RuntimeConfigWriter } from './runtime-config.writer';

@Module({
  controllers: [SetupController],
  providers: [ApplicationRestartService, DatabaseSetupService, RuntimeConfigWriter, SetupService],
  exports: [ApplicationRestartService, RuntimeConfigWriter],
})
export class SetupModule {}
