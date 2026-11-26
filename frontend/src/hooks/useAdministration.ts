import { useCallback, useEffect, useState } from "react";
import {
  TOKEN_STORAGE_KEY,
  AdminDashboard,
  MailConfigDraft,
  MailConfigStatus,
  PagedUsers,
  PermissionRecord,
  RoleRecord,
  SystemSettingsDraft,
  SystemSettingsStatus,
  createAdminUser,
  fetchAdminDashboard,
  fetchAdminUserAvatar,
  fetchMailConfig,
  fetchPermissions,
  fetchRoles,
  fetchSystemSettings,
  fetchUsers,
  sendNotificationMail,
  sendTestMail,
  updateAdminUser,
  updateMailConfig,
  updateRolePermissions,
  updateSystemSettings,
  verifyMailTransport,
} from "../lib/api";
import { UserDraft, UserQuery } from "../types";
import { resolveErrorMessage } from "../lib/format";
import { useFeedback } from "./useFeedback";

/** 管理页的数据和刷新规则集中在这里，普通用户不会请求这些接口。 */
export function useAdministration(
  isAdmin: boolean,
  token: string | null,
  feedback: Pick<ReturnType<typeof useFeedback>, "withFeedback" | "setNotice">,
) {
  const { withFeedback, setNotice } = feedback;
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboard | null>(null);
  const [usersPage, setUsersPage] = useState<PagedUsers>({
    data: [],
    total: 0,
  });
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [mailConfig, setMailConfig] = useState<MailConfigStatus | null>(null);
  const [systemSettings, setSystemSettings] = useState<SystemSettingsStatus | null>(null);
  const [userQuery, setUserQuery] = useState<UserQuery>({
    page: 1,
    pageSize: 10,
    keyword: "",
    roleUuid: "",
  });
  const sessionIsCurrent = useCallback(
    () => Boolean(token && localStorage.getItem(TOKEN_STORAGE_KEY) === token),
    [token],
  );
  const resetAdminState = useCallback(() => {
    setAdminDashboard(null);
    setUsersPage({ data: [], total: 0 });
    setRoles([]);
    setPermissions([]);
    setMailConfig(null);
    setSystemSettings(null);
  }, []);

  const loadAdminState = useCallback(async (isCurrent: () => boolean) => {
    const [nextAdminDashboard, nextRoles, nextPermissions, nextMailConfig, nextSystemSettings] =
      await Promise.all([
        fetchAdminDashboard(),
        fetchRoles(),
        fetchPermissions(),
        fetchMailConfig(),
        fetchSystemSettings(),
      ]);

    if (!isCurrent()) return;
    setAdminDashboard(nextAdminDashboard);
    setRoles(nextRoles);
    setPermissions(nextPermissions);
    setMailConfig(nextMailConfig);
    setSystemSettings(nextSystemSettings);
  }, []);
  const reloadAdminUsers = useCallback(async () => {
    if (!isAdmin) return;
    const next = await fetchUsers(userQuery);
    if (sessionIsCurrent()) setUsersPage(next);
  }, [isAdmin, userQuery, sessionIsCurrent]);

  useEffect(() => {
    if (!token || !isAdmin) return;
    let active = true;
    void fetchUsers(userQuery)
      .then((next) => {
        if (active) setUsersPage(next);
      })
      .catch((error) => {
        if (active) setNotice({ tone: "error", text: resolveErrorMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [isAdmin, setNotice, token, userQuery]);
  async function reloadAdminDashboard() {
    if (!isAdmin) return;
    const next = await fetchAdminDashboard();
    if (sessionIsCurrent()) setAdminDashboard(next);
  }

  async function reloadRoleData() {
    if (!isAdmin) return;
    const [nextRoles, nextPermissions] = await Promise.all([fetchRoles(), fetchPermissions()]);
    if (!sessionIsCurrent()) return;
    setRoles(nextRoles);
    setPermissions(nextPermissions);
  }

  async function reloadMailConfig() {
    if (!isAdmin) return;
    const next = await fetchMailConfig();
    if (sessionIsCurrent()) setMailConfig(next);
  }

  async function reloadSystemSettings() {
    if (!isAdmin) return;
    const next = await fetchSystemSettings();
    if (sessionIsCurrent()) setSystemSettings(next);
  }

  async function syncAdminViews() {
    await Promise.all([
      reloadAdminDashboard(),
      reloadAdminUsers(),
      reloadRoleData(),
      reloadMailConfig(),
      reloadSystemSettings(),
    ]);
  }

  async function handleAdminUserSave(uuid: string, payload: UserDraft) {
    await withFeedback(
      () =>
        updateAdminUser(uuid, {
          username: payload.username.trim(),
          email: payload.email.trim(),
          password: payload.password || undefined,
          avatar: payload.avatarChanged ? payload.avatar || null : undefined,
          roleUuid: payload.roleUuid || undefined,
        }),
      "用户资料已更新。",
    );
    await syncAdminViews();
  }

  async function handleAdminUserCreate(payload: UserDraft) {
    await withFeedback(
      () =>
        createAdminUser({
          username: payload.username.trim(),
          email: payload.email.trim().toLowerCase(),
          password: payload.password,
          avatar: payload.avatar || undefined,
          roleUuid: payload.roleUuid,
        }),
      "用户已创建。",
    );
    await syncAdminViews();
  }

  async function handleRolePermissionSave(roleUuid: string, permissionUuids: string[]) {
    await withFeedback(() => updateRolePermissions(roleUuid, permissionUuids), "角色权限已更新。");
    await Promise.all([reloadRoleData(), reloadAdminDashboard()]);
  }

  async function handleMailRefresh() {
    await withFeedback(reloadMailConfig, "邮件配置已刷新。");
  }

  async function handleMailSave(payload: MailConfigDraft) {
    const nextConfig = await withFeedback(
      () => updateMailConfig(payload),
      "邮件配置已保存，服务正在重新加载。",
    );
    if (sessionIsCurrent()) setMailConfig(nextConfig);
    return nextConfig;
  }

  async function handleSystemSettingsRefresh() {
    await withFeedback(reloadSystemSettings, "系统设置已刷新。");
  }

  async function handleSystemSettingsSave(payload: SystemSettingsDraft) {
    const nextSettings = await withFeedback(
      () => updateSystemSettings(payload),
      "系统设置已保存，服务正在重新加载。",
    );
    if (sessionIsCurrent()) setSystemSettings(nextSettings);
    return nextSettings;
  }

  async function handleMailVerify() {
    const result = await withFeedback(verifyMailTransport, "邮件服务连接验证完成。");
    return result.ok;
  }

  async function handleTestMail(to: string) {
    return withFeedback(() => sendTestMail(to), "测试邮件已提交发送。");
  }

  async function handleNotifyMail(payload: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }) {
    return withFeedback(() => sendNotificationMail(payload), "通知邮件已提交发送。");
  }

  return {
    resetAdminState,
    loadAdminState,
    reloadAdminDashboard,
    adminDashboard,
    usersPage,
    roles,
    permissions,
    mailConfig,
    systemSettings,
    userQuery,
    onUserQueryChange: setUserQuery,
    onFetchUserAvatar: async (uuid: string) => (await fetchAdminUserAvatar(uuid)).avatar,
    onAdminUserCreate: handleAdminUserCreate,
    onAdminUserSave: handleAdminUserSave,
    onRolePermissionSave: handleRolePermissionSave,
    onMailRefresh: handleMailRefresh,
    onMailSave: handleMailSave,
    onSystemSettingsRefresh: handleSystemSettingsRefresh,
    onSystemSettingsSave: handleSystemSettingsSave,
    onMailVerify: handleMailVerify,
    onTestMail: handleTestMail,
    onNotifyMail: handleNotifyMail,
  };
}
export type Administration = ReturnType<typeof useAdministration>;
