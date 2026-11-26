import type { McpScope } from 'src/auth/auth.d';

export interface McpPrincipal {
  authUuid?: string;
  mcpManaged?: boolean;
  uuid: string;
  permissions: string[];
  mcpScopes: McpScope[];
}

export interface McpProfile {
  uuid: string;
  username: string;
  email: string;
  roleName: string | null;
}

export interface McpContactSummary {
  uuid: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedLetterCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpContactDetail extends McpContactSummary {
  note: string | null;
  letterUuids: string[];
  letterUuidsTruncated: boolean;
}

export interface McpLetterSummary {
  uuid: string;
  title: string;
  excerpt: string;
  contentFormat: string;
  deliveryEnabled: boolean;
  inactiveAfterMinutes: number | null;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface McpLetterContact {
  uuid: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface McpLetterDetail extends McpLetterSummary {
  content: string;
  contentTruncated: boolean;
  lastTriggeredAt: string | null;
  contacts: McpLetterContact[];
  contactsTruncated: boolean;
}

export interface McpCheckIn {
  uuid: string;
  checkedAt: string;
  source: string | null;
}

export interface McpPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CreateMcpContactInput {
  name: string;
  email?: string;
  phone?: string;
  note?: string;
}

export interface UpdateMcpContactInput {
  expectedUpdatedAt: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
}

export interface CreateMcpLetterDraftInput {
  title: string;
  content: string;
  contentFormat: 'markdown' | 'plain_text';
  inactiveAfterMinutes?: number | null;
  contactUuids?: string[];
}

export interface UpdateMcpLetterDraftInput {
  expectedUpdatedAt: string;
  title?: string;
  content?: string;
  contentFormat?: 'markdown' | 'plain_text';
  inactiveAfterMinutes?: number | null;
  contactUuids?: string[];
}
