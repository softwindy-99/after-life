import { Injectable, Logger } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Request, Response } from 'express';
import { McpServerFactory } from './mcp-server.factory';
import { McpPrincipal } from './mcp.types';

@Injectable()
export class McpHttpService {
  private readonly logger = new Logger(McpHttpService.name);

  constructor(private readonly serverFactory: McpServerFactory) {}

  async handlePost(request: Request, response: Response, principal: McpPrincipal): Promise<void> {
    if (Array.isArray(request.body)) {
      response.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'JSON-RPC batch requests are not supported.' },
        id: null,
      });
      return;
    }

    const server = this.serverFactory.create(principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      this.logger.error('MCP transport failed while handling a request');
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    } finally {
      await server.close();
    }
  }
}
