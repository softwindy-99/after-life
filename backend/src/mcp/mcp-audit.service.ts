import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/user/user.entity';
import { McpActivity } from './mcp-activity.entity';

@Injectable()
export class McpAuditService {
  constructor(
    @Optional()
    @InjectRepository(McpActivity)
    private readonly activities?: Repository<McpActivity>,
  ) {}

  private readonly logger = new Logger(McpAuditService.name);

  async execute<T extends object>(
    tool: string,
    userUuid: string,
    resourceUuid: string | undefined,
    action: () => Promise<T>,
    authUuid?: string,
  ): Promise<CallToolResult> {
    const startedAt = Date.now();
    try {
      const result = await action();
      this.log(tool, userUuid, resourceUuid, 'success', Date.now() - startedAt);
      const values = result as Record<string, unknown>;
      const entity = (values.letter ?? values.contact ?? {}) as Record<string, unknown>;
      const createdUuid = entity.uuid ?? values.letterUuid;
      await this.persist(
        tool,
        userUuid,
        resourceUuid ?? (typeof createdUuid === 'string' ? createdUuid : undefined),
        'success',
        authUuid,
      );
      const structuredContent = result as Record<string, unknown>;
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    } catch (error) {
      this.log(tool, userUuid, resourceUuid, 'error', Date.now() - startedAt);
      await this.persist(tool, userUuid, resourceUuid, 'error', authUuid);
      return {
        content: [{ type: 'text', text: this.safeErrorMessage(error) }],
        isError: true,
      };
    }
  }

  private async persist(
    tool: string,
    userUuid: string,
    resourceUuid: string | undefined,
    outcome: string,
    authUuid?: string,
  ): Promise<void> {
    if (!this.activities || !authUuid) return;
    try {
      const user = await this.activities.manager
        .getRepository(User)
        .findOne({ where: { uuid: userUuid, iSdelete: 0 }, select: { id: true, uuid: true } });
      if (user)
        await this.activities.save(
          this.activities.create({
            user,
            authUuid,
            tool,
            resourceUuid: resourceUuid ?? null,
            outcome,
            details: null,
            expiresAt: null,
          }),
        );
    } catch {
      this.logger.warn('MCP audit persistence failed');
    }
  }

  private log(
    tool: string,
    userUuid: string,
    resourceUuid: string | undefined,
    result: 'success' | 'error',
    durationMs: number,
  ): void {
    const message = [
      `tool=${tool}`,
      `user=${userUuid}`,
      `resource=${resourceUuid ?? '-'}`,
      `result=${result}`,
      `durationMs=${durationMs}`,
    ].join(' ');

    if (result === 'success') this.logger.log(message);
    else this.logger.warn(message);
  }

  private safeErrorMessage(error: unknown): string {
    if (!(error instanceof HttpException)) return 'Unable to complete the request.';

    const response: unknown = error.getResponse();
    if (typeof response === 'string') return response;
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      return 'Unable to complete the request.';
    }

    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
      return message.join('; ');
    }
    return 'Unable to complete the request.';
  }
}
