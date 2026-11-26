import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

type RestartHandler = () => Promise<void>;

@Injectable()
export class ApplicationRestartService implements OnModuleDestroy {
  private readonly logger = new Logger(ApplicationRestartService.name);
  private restartHandler: RestartHandler | null = null;
  private restartTimer: NodeJS.Timeout | null = null;

  registerRestartHandler(handler: RestartHandler): void {
    this.restartHandler = handler;
  }

  scheduleRestart(delayMs = 500): void {
    if (this.restartTimer) return;

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const handler = this.restartHandler;
      if (!handler) {
        this.logger.error('Application restart requested before a restart handler was registered.');
        return;
      }

      void handler().catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        this.logger.error(`Application restart failed: ${message}`);
      });
    }, delayMs);
  }

  onModuleDestroy(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.restartHandler = null;
  }
}
