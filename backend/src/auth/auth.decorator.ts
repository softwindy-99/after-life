import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const MCP_ONLY_KEY = 'mcpOnly';
export const McpOnly = () => SetMetadata(MCP_ONLY_KEY, true);
