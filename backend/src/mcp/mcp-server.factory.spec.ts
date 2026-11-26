import { McpScope } from 'src/auth/auth.d';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_READ_TOOL_NAMES,
  MCP_TOOL_NAMES,
  MCP_WRITE_TOOL_NAMES,
  McpServerFactory,
} from './mcp-server.factory';

describe('McpServerFactory', () => {
  const userUuid = '11111111-1111-4111-8111-111111111111';
  const letterUuid = '33333333-3333-4333-8333-333333333333';
  let toolsService: Record<string, jest.Mock>;
  let factory: McpServerFactory;
  let actions: { recordCheckIn: jest.Mock };
  let server: McpServer | undefined;
  let client: Client | undefined;

  beforeEach(() => {
    toolsService = {
      getProfile: jest.fn(),
      listContacts: jest.fn(),
      getContact: jest.fn(),
      createContact: jest.fn(),
      updateContact: jest.fn(),
      listLetters: jest.fn(),
      getLetter: jest.fn(),
      createLetterDraft: jest.fn(),
      updateLetterDraft: jest.fn(),
      getCheckInStatus: jest.fn(),
    };
    const auditService = {
      execute: async (
        _tool: string,
        _userUuid: string,
        _resourceUuid: string | undefined,
        action: () => Promise<object>,
      ) => {
        const result = (await action()) as Record<string, unknown>;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      },
    };
    actions = { recordCheckIn: jest.fn() };
    factory = new McpServerFactory(toolsService as any, auditService as any, actions as any);
  });

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connect(
    boundUserUuid = userUuid,
    mcpScopes: McpScope[] = ['mcp:read', 'mcp:write'],
    managed = false,
  ): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = factory.create({
      uuid: boundUserUuid,
      permissions: ['self'],
      mcpScopes,
      ...(managed ? { mcpManaged: true, authUuid: 'grant' } : {}),
    });
    await server.connect(serverTransport);
    client = new Client({ name: 'mcp-test-client', version: '1.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  it('registers the stable, current-user tool set with safety annotations', async () => {
    const connectedClient = await connect();

    const result = await connectedClient.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
    expect(result.tools).not.toContainEqual(
      expect.objectContaining({ name: 'afterlife_record_check_in' }),
    );
    expect(result.tools.find((tool) => tool.name === 'afterlife_get_letter')?.annotations).toEqual(
      expect.objectContaining({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      }),
    );
    expect(
      result.tools.find((tool) => tool.name === 'afterlife_update_letter_draft')?.annotations,
    ).toEqual(
      expect.objectContaining({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
      }),
    );
  });

  it('registers only read tools when the token lacks mcp:write', async () => {
    const connectedClient = await connect(userUuid, ['mcp:read']);

    const result = await connectedClient.listTools();

    expect(result.tools.map((tool) => tool.name)).toEqual(MCP_READ_TOOL_NAMES);
    expect(result.tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(MCP_WRITE_TOOL_NAMES),
    );
  });

  it('applies bounded pagination defaults and returns structured output', async () => {
    const connectedClient = await connect();
    toolsService.listLetters.mockResolvedValue({
      items: [
        {
          uuid: letterUuid,
          title: 'Hello',
          excerpt: 'Summary',
          contentFormat: 'markdown',
          deliveryEnabled: false,
          inactiveAfterMinutes: null,
          contactCount: 0,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    });

    const result = await connectedClient.callTool({
      name: 'afterlife_list_letters',
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(toolsService.listLetters).toHaveBeenCalledWith(userUuid, 1, 20);
  });

  it('rejects unknown or privileged draft fields before business logic runs', async () => {
    const connectedClient = await connect();

    const result = await connectedClient.callTool({
      name: 'afterlife_create_letter_draft',
      arguments: {
        title: 'Hello',
        content: 'Body',
        deliveryEnabled: true,
        userUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    expect(result.isError).toBe(true);
    expect(toolsService.createLetterDraft).not.toHaveBeenCalled();
  });

  it('rejects impractically large page numbers and request bodies', async () => {
    const connectedClient = await connect();

    const pageResult = await connectedClient.callTool({
      name: 'afterlife_list_letters',
      arguments: { page: 100_001 },
    });
    const bodyResult = await connectedClient.callTool({
      name: 'afterlife_create_letter_draft',
      arguments: {
        title: 'Hello',
        content: 'x'.repeat(20_001),
        contentFormat: 'markdown',
      },
    });

    expect(pageResult.isError).toBe(true);
    expect(bodyResult.isError).toBe(true);
    expect(toolsService.listLetters).not.toHaveBeenCalled();
    expect(toolsService.createLetterDraft).not.toHaveBeenCalled();
  });

  it('keeps the authenticated user identity in the server closure', async () => {
    const otherUserUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const connectedClient = await connect(otherUserUuid);
    toolsService.getProfile.mockResolvedValue({
      profile: {
        uuid: otherUserUuid,
        username: 'Other',
        email: 'other@example.com',
        roleName: 'user',
      },
    });

    await connectedClient.callTool({ name: 'afterlife_get_my_profile', arguments: {} });

    expect(toolsService.getProfile).toHaveBeenCalledWith(otherUserUuid);
  });
  it('exposes only explicitly granted managed capabilities, without broad legacy reads', async () => {
    const connected = await connect(userUuid, ['mcp:read', 'mcp:letters:read'], true);
    const names = (await connected.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('afterlife_read_letter_content');
    expect(names).not.toContain('afterlife_get_contact');
    expect(names).not.toContain('afterlife_create_letter_draft');
    expect(names).not.toContain('afterlife_record_check_in');
    const forbidden = await connected.callTool({ name: 'afterlife_set_delivery', arguments: {} });
    expect(forbidden.isError).toBe(true);
  });
  it('registers delegated check-in only with its separate permission and rejects unknown evidence fields', async () => {
    const connected = await connect(userUuid, ['mcp:read', 'mcp:check-in:write'], true);
    const names = (await connected.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual([
      'afterlife_get_my_profile',
      'afterlife_get_check_in_status',
      'afterlife_record_check_in',
    ]);
    const result = await connected.callTool({
      name: 'afterlife_record_check_in',
      arguments: { eventId: 'event', occurredAt: new Date().toISOString(), humanConfirmed: true },
    });
    expect(result.isError).toBe(true);
    expect(actions.recordCheckIn).not.toHaveBeenCalled();
  });
});
