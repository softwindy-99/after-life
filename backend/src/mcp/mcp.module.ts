import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { Auth } from 'src/auth/auth.entity';
import { ResourceModule } from 'src/resource/resource.module';
import { McpActivity } from './mcp-activity.entity';
import { McpSettingsService } from './mcp-settings.service';
import { McpSettingsController } from './mcp-settings.controller';
import { McpActionsService } from './mcp-actions.service';
import { McpUploadGuard } from './mcp-upload.guard';
import { McpUploadController } from './mcp-upload.controller';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CheckInModule } from 'src/check-in/check-in.module';
import { CorrespondenceModule } from 'src/correspondence/correspondence.module';
import { UserModule } from 'src/user/user.module';
import { McpAccessGuard } from './mcp-access.guard';
import { McpAuditService } from './mcp-audit.service';
import { McpController } from './mcp.controller';
import { McpHttpService } from './mcp-http.service';
import { McpOriginGuard } from './mcp-origin.guard';
import { McpServerFactory } from './mcp-server.factory';
import { McpToolsService } from './mcp-tools.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    ResourceModule,
    TypeOrmModule.forFeature([Auth, McpActivity]),
    UserModule,
    CorrespondenceModule,
    CheckInModule,
  ],
  controllers: [McpController, McpSettingsController, McpUploadController],
  providers: [
    McpUploadGuard,
    McpSettingsService,
    McpActionsService,
    McpAccessGuard,
    McpOriginGuard,
    McpAuditService,
    McpHttpService,
    McpServerFactory,
    McpToolsService,
  ],
})
export class McpModule {}
