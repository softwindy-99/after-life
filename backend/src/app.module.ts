import { DynamicModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { PermissionModule } from './permission/permission.module';
import { CorrespondenceModule } from './correspondence/correspondence.module';
import { RoleModule } from './role/role.module';
import { AdminModule } from './admin/admin.module';
import { SetupModule } from './setup/setup.module';
import { applyRuntimeEnvToProcess, setRuntimeConfigured } from './setup/env';
import { ResolvedRuntimeConfig } from './setup/runtime-config';
import { MailModule } from './mail/mail.module';
import { CheckInModule } from './check-in/check-in.module';
import { NotificationModule } from './notification/notification.module';
import { McpModule } from './mcp/mcp.module';
import { ResourceModule } from './resource/resource.module';
import { AgentDistributionModule } from './agent/agent-distribution.module';

// 配置未就绪时不注册业务模块，避免初始化页面依赖一个尚不存在的数据库。
function createConfiguredImports() {
  return [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      synchronize: false,
      autoLoadEntities: true,
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
    }),
    UserModule,
    AuthModule,
    PermissionModule,
    RoleModule,
    CorrespondenceModule,
    ResourceModule,
    AdminModule,
    CheckInModule,
    MailModule,
    NotificationModule,
    McpModule,
  ];
}

@Module({})
export class AppModule {
  static configure(config: ResolvedRuntimeConfig): DynamicModule {
    applyRuntimeEnvToProcess(config.values);
    setRuntimeConfigured(config.ready);

    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot({
          cache: true,
          ignoreEnvFile: true,
        }),
        SetupModule,
        AgentDistributionModule,
        ...(config.ready ? createConfiguredImports() : []),
      ],
      controllers: [AppController],
      providers: [AppService],
    };
  }
}
