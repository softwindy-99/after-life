export interface ApiEnvelope<T> {
  data: T;
  message: string;
  statusCode: number;
}

export interface LetterRecord {
  uuid: string;
  title: string;
  content: string;
  contentFormat: "html" | "markdown" | "plain_text";
  excerpt: string;
  deliveryEnabled: boolean;
  inactiveAfterMinutes?: number | null;
  lastTriggeredAt?: string | null;
  contacts?: Array<Pick<ContactRecord, "uuid" | "name" | "email">>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContactRecord {
  uuid: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  displaySummary: string;
  letters?: Array<Pick<LetterRecord, "uuid" | "title">>;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeliveryReview {
  baselineAt: string;
  baselineSource: "check-in" | "account-created";
  dueAt: string;
  overdue: boolean;
  recipients: { uuid: string; name: string; email: string | null }[];
  skippedContacts: { uuid: string; name: string; email: string | null }[];
  resourceCount: number;
  retentionDays: number;
  blockers: string[];
  expiresAt: string;
  token: string | null;
}

export interface UserRecord {
  uuid: string;
  username: string;
  email: string;
  avatar?: string | null;
  role?: {
    uuid?: string;
    name: string;
    permissions?: PermissionRecord[];
  };
}

export interface PermissionRecord {
  uuid: string;
  name: string;
  description: string;
}

export interface RoleRecord {
  uuid: string;
  name: string;
  description: string;
  permissions: PermissionRecord[];
}

export interface PagedUsers {
  data: UserRecord[];
  total: number;
}

export interface AdminDashboard {
  totals: {
    users: number;
    admins: number;
    letters: number;
    contacts: number;
    roles: number;
    resourceBytes: number;
  };
  recentUsers: UserRecord[];
  recentLetters: Array<
    Pick<LetterRecord, "uuid" | "deliveryEnabled" | "lastTriggeredAt" | "createdAt" | "updatedAt">
  >;
  roleDistribution: Array<{
    roleUuid: string;
    roleName: string;
    userCount: number;
    permissionNames: string[];
  }>;
}

export interface DashboardData {
  user: UserRecord | null;
  letters: LetterRecord[];
  contacts: ContactRecord[];
}

export interface CheckInRecord {
  uuid: string;
  checkedAt: string;
  source?: string | null;
  createdAt?: string;
}

export interface CheckInStatus {
  baselineAt?: string | null;
  baselineSource?: "check-in" | "account-created";
  lastSeenAt: string | null;
  checkIn: CheckInRecord | null;
}

export interface NotificationPreferences {
  dailyReminderEnabled: boolean;
  dailyReminderTime: string;
  timezone: string;
  letterWarningEnabled: boolean;
  letterWarningMinutes: number;
}

export interface PushNotificationConfig {
  publicKey: string;
  configured: boolean;
}

export interface PushSubscriptionStatus {
  subscribed: boolean;
  subscriptionId: string | null;
  preferences: NotificationPreferences | null;
}

export interface SetupStatus {
  hasEnvFile?: boolean;
  requiredKeys?: string[];
  missingKeys?: string[];
  databasePasswordConfigured?: boolean;
  needsSetup: boolean;
  requiresRestart: boolean;
  initializing: boolean;
  values?: Record<string, string>;
}

export interface InitialUserSetupPayload {
  username: string;
  email: string;
  password: string;
}

export type SetupEnvKey =
  | "PORT"
  | "DB_HOST"
  | "DB_PORT"
  | "DB_USER"
  | "DB_PASSWORD"
  | "DB_NAME"
  | "JWT_SECRET"
  | "MAIL_HOST"
  | "MAIL_PORT"
  | "MAIL_USER"
  | "MAIL_PASSWORD"
  | "MAIL_FROM"
  | "MAIL_SECURE"
  | "INIT_ADMIN_USERNAME"
  | "INIT_ADMIN_EMAIL"
  | "INIT_ADMIN_PASSWORD";

export type SetupPayload = Partial<Record<SetupEnvKey, string>> & {
  initialUser: InitialUserSetupPayload;
  resetDatabase?: boolean;
};

export interface DatabaseCheckResult {
  connected: boolean;
  databaseExists: boolean;
  schemaReady: boolean;
  missingTables: string[];
  pendingMigrations: boolean;
  seedStatus: {
    permissions: "ready" | "missing" | "unchecked";
    roles: "ready" | "missing" | "unchecked";
    adminUser: "ready" | "missing" | "unchecked";
  };
  canInitialize: boolean;
  error?: string;
}

export interface MailConfigStatus {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  configured: boolean;
  missingKeys: string[];
}

export interface MailConfigDraft {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  from?: string;
}

export interface SystemSettingsStatus {
  pushProxy: string;
  pushProxyConfigured: boolean;
  pushProxyValid: boolean;
  pushProxyHasCredentials: boolean;
  pushProxySource: "WEB_PUSH_PROXY" | "HTTPS_PROXY" | "https_proxy" | null;
}

export interface SystemSettingsDraft {
  pushProxy: string | null;
}

export interface StorageDraft {
  driver: "local" | "s3" | "oss";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  accessKeySecret?: string;
}

export interface StorageStatus extends Omit<StorageDraft, "accessKeyId" | "accessKeySecret"> {
  credentialsConfigured: boolean;
  writable: boolean;
  localCount: number;
  externalCount: number;
}

export interface SendMailNotification {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface SendMailResult {
  accepted: string[];
  rejected: string[];
  messageId?: string;
}

export interface McpPermission {
  scope: string;
  label: string;
  risk: string;
}
export interface McpGrant {
  uuid: string;
  name: string;
  scopes: string[] | null;
  legacy: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastCheckInAt: string | null;
  createdAt: string;
}
export interface McpEvent {
  agentName?: string;
  uuid: string;
  authUuid: string;
  tool: string;
  resourceUuid: string | null;
  outcome: string;
  createdAt: string;
  expiresAt: string | null;
  details: {
    expectedUpdatedAt?: string;
    inactiveAfterMinutes?: number;
    dueAt?: string;
    resourceCount?: number;
    contactCount?: number;
  } | null;
}
export interface McpSettings {
  permissions: McpPermission[];
  grants: McpGrant[];
  events: McpEvent[];
  pending: McpEvent[];
  page: number;
  total: number;
}
export interface McpGrantDraft {
  name: string;
  scopes: string[];
  days: number | null;
}
export interface McpApprovalReview {
  event: McpEvent;
  letter: LetterRecord;
  resources: { uuid: string; filename: string; sizeBytes: number; url: string }[];
}
