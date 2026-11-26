import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { McpActionsService } from 'src/mcp/mcp-actions.service';
import { McpUploadController } from 'src/mcp/mcp-upload.controller';
import { McpUploadGuard } from 'src/mcp/mcp-upload.guard';
import { McpOriginGuard } from 'src/mcp/mcp-origin.guard';

describe('Dedicated MCP file upload (HTTP)', () => {
  let app: INestApplication;
  const actions = {
    validateUploadTicket: jest.fn(async (ticket: string) => {
      if (ticket !== 'short-lived-upload-ticket') throw new ForbiddenException();
    }),
    upload: jest.fn().mockResolvedValue({ uuid: 'file' }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [McpUploadController],
      providers: [
        McpUploadGuard,
        McpOriginGuard,
        { provide: McpActionsService, useValue: actions },
        { provide: ConfigService, useValue: { get: () => 'https://allowed.example' } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('rejects missing, main MCP and invalid upload credentials before processing files', async () => {
    for (const bearer of ['', 'main-mcp-bearer', 'invalid-ticket']) {
      const test = request(app.getHttpServer()).post('/mcp-files');
      if (bearer) test.set('Authorization', `Bearer ${bearer}`);
      await test.attach('file', Buffer.from('private file'), 'file.txt').expect(403);
    }
    expect(actions.upload).not.toHaveBeenCalled();
  });
  it('accepts multipart only after upload-ticket validation and enforces browser origin', async () => {
    await request(app.getHttpServer())
      .post('/mcp-files')
      .set('Authorization', 'Bearer short-lived-upload-ticket')
      .set('Origin', 'https://evil.example')
      .attach('file', Buffer.from('x'), 'file.txt')
      .expect(403);
    expect(actions.upload).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/mcp-files')
      .set('Authorization', 'Bearer short-lived-upload-ticket')
      .attach('file', Buffer.from('x'), 'file.txt')
      .expect(201);
    expect(actions.upload).toHaveBeenCalledWith(
      'short-lived-upload-ticket',
      expect.objectContaining({ size: 1 }),
    );
  });
});
