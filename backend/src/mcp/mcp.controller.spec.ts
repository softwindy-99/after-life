import { UnauthorizedException } from '@nestjs/common';
import { McpController } from './mcp.controller';

describe('McpController', () => {
  let httpService: { handlePost: jest.Mock };
  let controller: McpController;

  beforeEach(() => {
    httpService = { handlePost: jest.fn() };
    controller = new McpController(httpService as any);
  });

  it('binds POST handling to the authenticated user', async () => {
    const request = {
      user: {
        uuid: 'user-1',
        permissions: ['self'],
        mcpScopes: ['mcp:read', 'mcp:write'],
      },
    };
    const response = {};
    httpService.handlePost.mockResolvedValue(undefined);

    await controller.post(request as any, response as any);

    expect(httpService.handlePost).toHaveBeenCalledWith(request, response, {
      uuid: 'user-1',
      permissions: ['self'],
      mcpScopes: ['mcp:read', 'mcp:write'],
    });
  });

  it('rejects a missing principal defensively', async () => {
    await expect(controller.post({} as any, {} as any)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each(['get', 'delete'] as const)('returns a JSON-RPC 405 response for %s', (method) => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);

    controller[method](response as any);

    expect(response.setHeader).toHaveBeenCalledWith('Allow', 'POST');
    expect(response.status).toHaveBeenCalledWith(405);
    expect(response.json).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });
});
