import { BadRequestException, Logger } from '@nestjs/common';
import { McpAuditService } from './mcp-audit.service';

describe('McpAuditService', () => {
  let service: McpAuditService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    service = new McpAuditService();
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns compatible text and structured content for successful tools', async () => {
    await expect(
      service.execute('tool', 'user-1', undefined, async () => ({ ok: true })),
    ).resolves.toEqual({
      content: [{ type: 'text', text: '{"ok":true}' }],
      structuredContent: { ok: true },
    });
  });

  it('returns controlled HTTP exception messages without structured output', async () => {
    const result = await service.execute('tool', 'user-1', 'resource-1', async () => {
      throw new BadRequestException('controlled message');
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'controlled message' }],
      isError: true,
    });
  });

  it('does not expose unexpected database or stack details', async () => {
    const result = await service.execute('tool', 'user-1', undefined, async () => {
      throw new Error('SELECT password FROM user');
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'Unable to complete the request.' }],
      isError: true,
    });
  });
});
