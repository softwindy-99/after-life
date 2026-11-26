import { ApiError, type UserRecord } from "./api";

export function hasAdminAccess(user: UserRecord | null | undefined) {
  return Boolean(user?.role?.permissions?.some((permission) => permission.name === "admin"));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("头像读取失败"));
    reader.readAsDataURL(file);
  });
}

export function normalizeNullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function resolveErrorMessage(error: unknown) {
  if (!navigator.onLine) {
    return "当前网络不可用，请恢复联网后重试。";
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "出现了未知错误，请稍后再试。";
}

export function formatDate(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function pageTitle(pathname: string, isAdmin = false) {
  if (pathname === "/ui-kit") return "设计系统";
  if (pathname === "/admin") return "系统管理";
  if (pathname.startsWith("/checkin")) return "每日签到";
  if (pathname.startsWith("/letters")) return isAdmin ? "信件管理" : "我的信件";
  if (pathname.startsWith("/contacts")) return isAdmin ? "联系人管理" : "我的联系人";
  if (pathname.startsWith("/mail")) return "邮件服务";
  if (pathname.startsWith("/settings")) return "系统设置";
  if (pathname.startsWith("/users")) return "用户管理";
  if (pathname.startsWith("/roles")) return "角色权限";
  if (pathname.startsWith("/mcp-settings")) return "AI 接入";
  if (pathname.startsWith("/profile")) return "个人资料";
  return isAdmin ? "管理总览" : "我的空间";
}
