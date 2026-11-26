import { McpScope } from './auth.d';

export const MCP_AUDIENCE = 'mcp';
export const MCP_TOKEN_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const MCP_TOKEN_STORAGE_PREFIX = 'mcp:';

export function isMcpAudience(audience: unknown): boolean {
  return (
    audience === MCP_AUDIENCE ||
    (Array.isArray(audience) && audience.some((value) => value === MCP_AUDIENCE))
  );
}

export function isMcpScope(value: unknown): value is McpScope {
  return typeof value === 'string' && (MCP_SCOPES as readonly string[]).includes(value);
}

// Legacy read/write remain valid, but are never offered as new grants.
export const MCP_MANAGED_SCOPES = [
  'mcp:letters:read',
  'mcp:contacts:read',
  'mcp:resources:read',
  'mcp:letters:write',
  'mcp:contacts:write',
  'mcp:resources:write',
  'mcp:delivery:write',
  'mcp:check-in:write',
] as const;
export const MCP_SCOPES = ['mcp:read', 'mcp:write', ...MCP_MANAGED_SCOPES] as const;
