import { configureFrontendHost } from './frontend-host';
import { json } from 'express';
import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { TransformInterceptor } from './transform.interceptor';
import { ApplicationRestartService } from './setup/application-restart.service';
import { configureMcpOriginProtection } from './mcp/mcp-origin.middleware';
import { resolveRuntimeConfig } from './setup/runtime-config';
import { completeStartupEnv } from './setup/env';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  let app: INestApplication | null = null;
  let restarting = false;

  async function startApplication(): Promise<void> {
    logger.log('Starting server...');
    completeStartupEnv();
    const config = resolveRuntimeConfig();
    const nextApp = await NestFactory.create(AppModule.configure(config));
    try {
      const configService = nextApp.get(ConfigService);
      nextApp.use(json({ limit: '1mb' }));
      const serveFrontend = process.env.NODE_ENV !== 'development';
      configureMcpOriginProtection(nextApp, configService, serveFrontend ? '/api' : '/');
      if (serveFrontend) configureFrontendHost(nextApp);
      nextApp.enableCors({
        origin: true,
        credentials: true,
      });
      nextApp.useGlobalInterceptors(new TransformInterceptor());

      const port = config.values.PORT || 3000;
      await nextApp.listen(port);

      nextApp.get(ApplicationRestartService).registerRestartHandler(restartApplication);
      app = nextApp;
      logger.log(`Server running at port ${port}`);
    } catch (error) {
      await nextApp.close();
      throw error;
    }
  }

  async function restartApplication(): Promise<void> {
    if (restarting) return;
    restarting = true;
    logger.log('Reloading server with the saved configuration...');

    const previousApp = app;
    app = null;
    try {
      await previousApp?.close();
      await startApplication();
      logger.log('Server configuration reloaded successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      logger.error(`Server configuration reload failed: ${message}`);
      setTimeout(() => void restartApplication(), 2000);
    } finally {
      restarting = false;
    }
  }

  await startApplication();
}

void bootstrap();
