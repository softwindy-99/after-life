import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ResourceService } from './resource.service';

@Injectable()
export class ResourceCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResourceCleanupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly resources: ResourceService) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => {
        void this.run();
      },
      60 * 60 * 1000,
    );
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.resources.cleanup(now);
    } catch (error) {
      this.logger.error(
        `resource cleanup failed: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      this.running = false;
    }
  }
}
