import {
  NotificationPreferences,
  PushSubscriptionStatus,
  fetchPushConfig,
  fetchPushSubscriptionStatus,
  registerPushSubscription,
  removePushSubscription,
  updatePushPreferences,
} from "./api";

const PUSH_SUBSCRIPTION_ID_STORAGE_KEY = "after-life-push-subscription-id";
const PUSH_OPERATION_TIMEOUT_MS = 15_000;

export interface BrowserPushStatus extends PushSubscriptionStatus {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    dailyReminderEnabled: true,
    dailyReminderTime: "09:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    letterWarningEnabled: true,
    letterWarningMinutes: 60,
  };
}

export function supportsPushNotifications() {
  return (
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function readBrowserPushStatus(): Promise<BrowserPushStatus> {
  if (!supportsPushNotifications()) return unsupportedStatus();

  const subscription = await getCurrentSubscription();
  if (Notification.permission !== "granted" || !subscription) {
    await reconcileMissingBrowserSubscription(subscription);
    return disabledStatus();
  }

  const status = await withTimeout(
    fetchPushSubscriptionStatus(subscription.endpoint),
    "读取通知订阅状态超时，请检查服务端连接。",
  );
  if (!status.subscribed) {
    await subscription.unsubscribe();
    forgetSubscriptionId();
    return disabledStatus();
  }

  rememberSubscriptionId(status.subscriptionId);
  return { ...status, supported: true, permission: Notification.permission };
}

export async function enablePushNotifications(
  preferences: NotificationPreferences,
): Promise<BrowserPushStatus> {
  if (!supportsPushNotifications()) {
    throw new Error("当前浏览器或访问方式不支持系统通知，请使用 HTTPS 安装 PWA。");
  }
  if (!hasEnabledReminder(preferences)) return disablePushNotifications();

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "通知权限已被浏览器拒绝，请在站点设置中重新允许。"
        : "需要允许通知权限才能开启定时提醒。",
    );
  }

  const config = await withTimeout(
    fetchPushConfig(),
    "读取服务端通知配置超时，请确认后端服务正在运行。",
  );
  if (!config.configured || !config.publicKey) {
    throw new Error("服务端通知密钥尚未配置，请重启服务后重试。");
  }

  const registration = await getReadyServiceWorkerRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !applicationServerKeyMatches(subscription, config.publicKey)) {
    await removeBrowserSubscription(subscription, registration);
    subscription = null;
  }

  let created = false;
  if (!subscription) {
    subscription = await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      }),
      "浏览器创建通知订阅超时，请刷新页面后重试。",
    );
    created = true;
  }

  try {
    const status = await withTimeout(
      registerPushSubscription(subscription.toJSON(), preferences),
      "保存通知订阅超时，请检查服务端连接。",
    );
    rememberSubscriptionId(status.subscriptionId);
    return { ...status, supported: true, permission };
  } catch (error) {
    if (created) await subscription.unsubscribe();
    throw error;
  }
}

export async function savePushPreferences(
  preferences: NotificationPreferences,
): Promise<BrowserPushStatus> {
  if (!hasEnabledReminder(preferences)) return disablePushNotifications();
  const subscription = await requireCurrentSubscription();
  const status = await withTimeout(
    updatePushPreferences(subscription.endpoint, preferences),
    "保存通知设置超时，请检查服务端连接。",
  );
  rememberSubscriptionId(status.subscriptionId);
  return { ...status, supported: true, permission: Notification.permission };
}

export async function disablePushNotifications(): Promise<BrowserPushStatus> {
  if (!supportsPushNotifications()) return unsupportedStatus();
  await removeCurrentPushSubscription();
  return disabledStatus();
}

export async function disconnectPushOnLogout(): Promise<void> {
  if (!supportsPushNotifications()) return;
  await removeCurrentPushSubscription();
}

async function removeCurrentPushSubscription(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  let serverError: unknown;

  try {
    if (subscription) {
      await withTimeout(
        removePushSubscription({ endpoint: subscription.endpoint }),
        "服务端清理通知订阅超时。",
      );
    } else {
      await removeRememberedSubscription();
    }
    forgetSubscriptionId();
  } catch (error) {
    serverError = error;
  } finally {
    if (subscription) await subscription.unsubscribe();
    await closeDeliveredNotifications(registration);
  }

  if (serverError) throw serverError;
}

async function removeBrowserSubscription(
  subscription: PushSubscription,
  registration: ServiceWorkerRegistration,
): Promise<void> {
  try {
    await withTimeout(
      removePushSubscription({ endpoint: subscription.endpoint }),
      "清理旧通知订阅超时。",
    );
    forgetSubscriptionId();
  } finally {
    await subscription.unsubscribe();
    await closeDeliveredNotifications(registration);
  }
}

async function reconcileMissingBrowserSubscription(
  subscription: PushSubscription | null,
): Promise<void> {
  try {
    if (subscription) {
      await removePushSubscription({ endpoint: subscription.endpoint });
    } else {
      await removeRememberedSubscription();
    }
    forgetSubscriptionId();
  } catch {
    // Keep the remembered id and retry cleanup after the next authenticated page load.
  } finally {
    if (subscription) await subscription.unsubscribe();
  }
}

async function removeRememberedSubscription(): Promise<void> {
  const subscriptionId = readRememberedSubscriptionId();
  if (!subscriptionId) return;
  await withTimeout(removePushSubscription({ subscriptionId }), "服务端清理通知订阅超时。");
}

async function closeDeliveredNotifications(
  registration: ServiceWorkerRegistration | undefined,
): Promise<void> {
  if (!registration) return;
  try {
    const notifications = await registration.getNotifications();
    notifications.forEach((notification) => notification.close());
  } catch {
    // Closing an already-dismissed notification is best-effort cleanup.
  }
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const current = await navigator.serviceWorker.getRegistration();
  if (current?.active) return current;
  return withTimeout(
    navigator.serviceWorker.ready,
    "通知服务初始化超时，请刷新页面；如果问题持续，请清除旧的站点数据。",
  );
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function requireCurrentSubscription(): Promise<PushSubscription> {
  if (!supportsPushNotifications()) throw new Error("当前浏览器不支持系统通知。");
  const subscription = await getCurrentSubscription();
  if (!subscription) throw new Error("此设备还没有开启通知。");
  return subscription;
}

function rememberSubscriptionId(subscriptionId: string | null): void {
  if (!subscriptionId) return;
  try {
    window.localStorage.setItem(PUSH_SUBSCRIPTION_ID_STORAGE_KEY, subscriptionId);
  } catch {
    // Server-side failure cleanup remains available when storage is blocked.
  }
}

function readRememberedSubscriptionId(): string | null {
  try {
    return window.localStorage.getItem(PUSH_SUBSCRIPTION_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function forgetSubscriptionId(): void {
  try {
    window.localStorage.removeItem(PUSH_SUBSCRIPTION_ID_STORAGE_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function hasEnabledReminder(preferences: NotificationPreferences): boolean {
  return preferences.dailyReminderEnabled || preferences.letterWarningEnabled;
}

function disabledStatus(): BrowserPushStatus {
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: false,
    subscriptionId: null,
    preferences: null,
  };
}

function unsupportedStatus(): BrowserPushStatus {
  return {
    supported: false,
    permission: "unsupported",
    subscribed: false,
    subscriptionId: null,
    preferences: null,
  };
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), PUSH_OPERATION_TIMEOUT_MS);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function applicationServerKeyMatches(subscription: PushSubscription, publicKey: string): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const expected = urlBase64ToUint8Array(publicKey);
  const actual = new Uint8Array(current);
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}
