import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Letter } from 'src/letter/letter.entity';
import { User } from 'src/user/user.entity';
import { ResourceCleanupService } from './resource-cleanup.service';
import { ResourceController } from './resource.controller';
import { Resource } from './resource.entity';
import { ResourceService } from './resource.service';
import { SetupModule } from 'src/setup/setup.module';
import { ResourceStorageService } from './resource-storage.service';
import { StorageSettingsController } from './storage-settings.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Resource, User, Letter]), SetupModule],
  controllers: [ResourceController, StorageSettingsController],
  providers: [ResourceService, ResourceCleanupService, ResourceStorageService],
  exports: [ResourceService],
})
export class ResourceModule {}
