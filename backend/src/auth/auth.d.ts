/**
 * jwt payload interface
 */
export type McpScope =
  | 'mcp:read'
  | 'mcp:write'
  | 'mcp:letters:read'
  | 'mcp:contacts:read'
  | 'mcp:letters:write'
  | 'mcp:contacts:write'
  | 'mcp:resources:read'
  | 'mcp:resources:write'
  | 'mcp:delivery:write'
  | 'mcp:check-in:write';

export interface JwtPayload {
  uuid: string;
  email: string;
  role: string;
  permissions: string[];
  aud?: string | string[];
  mcpScopes?: McpScope[];
  authUuid?: string;
  mcpManaged?: boolean;
}

/**
 * user payload interface
 */
export interface UserPayload {
  uuid: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
  aud?: string | string[];
  mcpScopes?: McpScope[];
  authUuid?: string;
  mcpManaged?: boolean;
}

/**
 * Request
 */
declare module 'express' {
  export interface Request {
    user?: UserPayload;
  }
}
