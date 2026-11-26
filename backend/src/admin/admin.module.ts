import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from 'src/user/user.entity';
import { Letter } from 'src/letter/letter.entity';
import { Contact } from 'src/contact/contact.entity';
import { Role } from 'src/role/role.entity';
import { SetupModule } from 'src/setup/setup.module';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsService } from './system-settings.service';
import { ResourceModule } from 'src/resource/resource.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, Letter, Contact, Role]), SetupModule, ResourceModule],
  controllers: [AdminController, SystemSettingsController],
  providers: [AdminService, SystemSettingsService],
})
export class AdminModule {}
