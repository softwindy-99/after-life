import type {
  DeliveryReview,
  AdminDashboard,
  ContactRecord,
  CheckInRecord,
  CheckInStatus,
  DashboardData,
  DatabaseCheckResult,
  LetterRecord,
  MailConfigDraft,
  MailConfigStatus,
  PagedUsers,
  PermissionRecord,
  NotificationPreferences,
  PushNotificationConfig,
  PushSubscriptionStatus,
  RoleRecord,
  SendMailNotification,
  SendMailResult,
  SystemSettingsDraft,
  SystemSettingsStatus,
  SetupPayload,
  SetupStatus,
  UserRecord,
} from "./api-types";

export type * from "./api-types";

export const TOKEN_STORAGE_KEY = "after-life-admin-token";
export const SETUP_LOGIN_EMAIL_STORAGE_KEY = "after-life-setup-login-email";

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

function getToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  const contentType = response.headers.get("Content-Type") || "";
  const isJson = contentType.includes("application/json");
  const payload = raw && isJson ? JSON.parse(raw) : null;

  if (!response.ok) {
    throw new ApiError(
      payload?.message || payload?.error || `请求失败：${response.status} ${response.statusText}`,
      payload?.statusCode || response.status,
    );
  }

  if (raw && !isJson) {
    throw new ApiError("接口返回了非 JSON 内容，请检查前端代理或 API 地址配置。", response.status);
  }

  return payload?.data ?? payload;
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers || {});

  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(
    `${(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")}${path}`,
    {
      ...init,
      headers,
    },
  );

  return parseResponse<T>(response);
}

export function registerUser(username: string, email: string, password: string) {
  return request<UserRecord>("/user", {
    method: "POST",
    body: JSON.stringify({ username, email, password }),
  });
}

export async function login(email: string, password: string) {
  return request<string>("/auth", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchSetupStatus() {
  return request<SetupStatus>("/setup/status");
}

export async function initializeSetup(payload: SetupPayload) {
  return request<{ initialized: boolean; message: string }>("/setup", {
    method: "POST",
    body: JSON.stringify(createSetupRequestBody(payload, true)),
  });
}

export async function checkSetupDatabase(payload: SetupPayload) {
  return request<DatabaseCheckResult>("/setup/database/check", {
    method: "POST",
    body: JSON.stringify(createSetupRequestBody(payload, false)),
  });
}

function createSetupRequestBody(payload: SetupPayload, includeInitialUser: boolean) {
  const body = Object.fromEntries(
    Object.entries(payload).filter(([key, value]) => {
      if (key === "initialUser") return false;
      if (typeof value === "boolean") return value;
      return typeof value === "string" && Boolean(value.trim());
    }),
  );

  if (!includeInitialUser) return body;

  return {
    ...body,
    initialUser: {
      username: payload.initialUser.username.trim(),
      email: payload.initialUser.email.trim().toLowerCase(),
      password: payload.initialUser.password,
    },
  };
}

export async function fetchProfile() {
  return request<UserRecord>("/user");
}

export async function updateProfile(payload: {
  username: string;
  email: string;
  password?: string;
  avatar?: string | null;
}) {
  return request("/user", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchProfileAvatar() {
  return request<{ avatar: string | null }>("/user/avatar");
}

export async function fetchCheckInStatus() {
  return request<CheckInStatus>("/check-in/status");
}

export async function createCheckIn(source = "pwa") {
  return request<CheckInRecord>("/check-in", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

export async function fetchPushConfig() {
  return request<PushNotificationConfig>("/notification/config");
}

export async function fetchPushSubscriptionStatus(endpoint: string) {
  return request<PushSubscriptionStatus>("/notification/subscription/status", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

export async function registerPushSubscription(
  subscription: PushSubscriptionJSON,
  preferences: NotificationPreferences,
) {
  return request<PushSubscriptionStatus>("/notification/subscription", {
    method: "POST",
    body: JSON.stringify({ subscription, preferences }),
  });
}

export async function updatePushPreferences(
  endpoint: string,
  preferences: NotificationPreferences,
) {
  return request<PushSubscriptionStatus>("/notification/subscription/preferences", {
    method: "PUT",
    body: JSON.stringify({ endpoint, preferences }),
  });
}

export async function removePushSubscription(identifier: {
  endpoint?: string;
  subscriptionId?: string;
}) {
  return request<void>("/notification/subscription", {
    method: "DELETE",
    body: JSON.stringify(identifier),
  });
}

export async function fetchLetters() {
  return request<LetterRecord[]>("/letter");
}

export async function createLetter(payload: {
  deliveryPreviewToken?: string;
  title: string;
  content: string;
  contentFormat: "html";
  inactiveAfterMinutes?: number | string | null;
  deliveryEnabled?: boolean;
  contactUuids?: string[];
}) {
  return request<LetterRecord>("/letter", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLetter(
  uuid: string,
  payload: Partial<{
    expectedUpdatedAt: string;
    title: string;
    content: string;
    contentFormat: "html";
    inactiveAfterMinutes?: number | string | null;
    deliveryEnabled?: boolean;
    contactUuids?: string[];
    deliveryPreviewToken?: string;
  }>,
) {
  return request<LetterRecord>(`/letter/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function previewLetterDelivery(
  payload: import("../types").LetterDraft & { letterUuid?: string },
  signal?: AbortSignal,
): Promise<DeliveryReview> {
  return request<DeliveryReview>("/letter/delivery-preview", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export async function removeLetter(uuid: string) {
  return request<void>(`/letter/${uuid}`, {
    method: "DELETE",
  });
}

export async function uploadResource(file: File) {
  const body = new FormData();
  body.append("file", file);
  return request<{ uuid: string; url: string }>("/resource", { method: "POST", body });
}

export async function fetchResourceAccess(uuid: string, signal?: AbortSignal) {
  return request<{ url: string }>(`/resource/${uuid}/access`, { signal });
}

export function absoluteResourceUrl(path: string) {
  return new URL(
    `${(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")}${path}`,
    window.location.origin,
  ).toString();
}

export async function fetchMailConfig() {
  return request<MailConfigStatus>("/mail/config");
}

export async function updateMailConfig(payload: MailConfigDraft) {
  return request<MailConfigStatus>("/mail/config", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchSystemSettings() {
  return request<SystemSettingsStatus>("/admin/settings");
}

export function fetchStorageSettings() {
  return request<import("./api-types").StorageStatus>("/admin/storage");
}

export function updateStorageSettings(payload: import("./api-types").StorageDraft) {
  return request<import("./api-types").StorageStatus>("/admin/storage", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testStorageSettings(payload: import("./api-types").StorageDraft) {
  return request<{ ok: true }>("/admin/storage/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function migrateStorageBatch() {
  return request<{ migrated: number; remaining: number }>("/admin/storage/migrate", {
    method: "POST",
  });
}

export async function updateSystemSettings(payload: SystemSettingsDraft) {
  return request<SystemSettingsStatus>("/admin/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function verifyMailTransport() {
  return request<{ ok: boolean }>("/mail/verify", {
    method: "POST",
  });
}

export async function sendTestMail(to: string) {
  return request<SendMailResult>("/mail/test", {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

export async function sendNotificationMail(payload: SendMailNotification) {
  return request<SendMailResult>("/mail/notify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchContacts() {
  return request<ContactRecord[]>("/contact");
}

export async function createContact(payload: {
  name: string;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  letterUuids?: string[];
}) {
  return request<ContactRecord>("/contact", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateContact(
  uuid: string,
  payload: Partial<{
    expectedUpdatedAt: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    note?: string | null;
    letterUuids?: string[];
  }>,
) {
  return request<ContactRecord>(`/contact/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function removeContact(uuid: string) {
  return request<void>(`/contact/${uuid}`, {
    method: "DELETE",
  });
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [user, letters, contacts] = await Promise.all([
    fetchProfile(),
    fetchLetters(),
    fetchContacts(),
  ]);

  return { user, letters, contacts };
}

export async function fetchAdminDashboard() {
  return request<AdminDashboard>("/admin/dashboard");
}

export async function fetchUsers(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  roleUuid?: string;
}) {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("pageSize", String(params.pageSize ?? 10));
  if (params.keyword?.trim()) search.set("keyword", params.keyword.trim());
  if (params.roleUuid?.trim()) search.set("roleUuid", params.roleUuid.trim());
  return request<PagedUsers>(`/user/list?${search.toString()}`);
}

export async function createAdminUser(payload: {
  username: string;
  email: string;
  password: string;
  avatar?: string;
  roleUuid: string;
}) {
  return request<UserRecord>("/user/admin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminUser(
  uuid: string,
  payload: {
    username?: string;
    email?: string;
    password?: string;
    avatar?: string | null;
    roleUuid?: string;
  },
) {
  return request<UserRecord>(`/user/admin/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminUserAvatar(uuid: string) {
  return request<{ avatar: string | null }>(`/user/admin/${uuid}/avatar`);
}

export async function fetchRoles() {
  return request<RoleRecord[]>("/role");
}

export async function fetchPermissions() {
  return request<PermissionRecord[]>("/permission");
}

export async function updateRolePermissions(uuid: string, permissionUuids: string[]) {
  return request<RoleRecord>(`/role/${uuid}/permissions`, {
    method: "PUT",
    body: JSON.stringify({ permissionUuids }),
  });
}
export function fetchMcpSettings(page = 1) {
  return request<import("./api-types").McpSettings>(`/mcp-settings?page=${page}`);
}
export function createMcpGrant(payload: import("./api-types").McpGrantDraft) {
  return request<{ token: string; expiresInSeconds: number | null; scopes: string[] }>(
    "/mcp-settings/grants",
    { method: "POST", body: JSON.stringify(payload) },
  );
}
export function updateMcpGrant(
  uuid: string,
  payload: Pick<import("./api-types").McpGrantDraft, "name" | "scopes">,
) {
  return request<void>(`/mcp-settings/grants/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
export function revokeMcpGrant(uuid?: string) {
  return request<void>(`/mcp-settings/grants${uuid ? `/${uuid}` : ""}`, { method: "DELETE" });
}
export function resolveMcpApproval(uuid: string, approve: boolean) {
  return request<void>(`/mcp-settings/approvals/${uuid}`, {
    method: "POST",
    body: JSON.stringify({ approve }),
  });
}
export function fetchMcpApproval(uuid: string) {
  return request<import("./api-types").McpApprovalReview>(`/mcp-settings/approvals/${uuid}`);
}
