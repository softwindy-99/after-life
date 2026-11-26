import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { NotificationPreferences } from "../lib/api";
import {
  BrowserPushStatus,
  disablePushNotifications,
  enablePushNotifications,
  readBrowserPushStatus,
  savePushPreferences,
  supportsPushNotifications,
} from "../lib/push";
import { resolveErrorMessage } from "../lib/format";
import { Notice, NotificationAction } from "../types";

function initialPushStatus(): BrowserPushStatus {
  const supported = supportsPushNotifications();
  return {
    supported,
    permission: supported ? Notification.permission : "unsupported",
    subscribed: false,
    subscriptionId: null,
    preferences: null,
  };
}

/** 浏览器订阅是设备状态；读取失败不应清除有效登录。 */
export function useNotifications(
  token: string | null,
  setNotice: Dispatch<SetStateAction<Notice>>,
) {
  const [pushStatus, setPushStatus] = useState<BrowserPushStatus>(initialPushStatus);
  const [notificationAction, setNotificationAction] = useState<NotificationAction | null>(null);
  const reset = useCallback(() => setPushStatus(initialPushStatus()), []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    void readBrowserPushStatus()
      .then((status) => {
        if (active) setPushStatus(status);
      })
      .catch(() => {
        // Notification status is secondary and must not invalidate a valid login session.
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function withNotificationFeedback<T>(
    notificationAction: NotificationAction,
    action: () => Promise<T>,
    successText: string,
  ) {
    setNotificationAction(notificationAction);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ tone: "success", text: successText });
      return result;
    } catch (error) {
      setNotice({ tone: "error", text: resolveErrorMessage(error) });
      throw error;
    } finally {
      setNotificationAction(null);
    }
  }

  async function handleEnableNotifications(preferences: NotificationPreferences) {
    const status = await withNotificationFeedback(
      "enable",
      () => enablePushNotifications(preferences),
      "此设备的签到与信件通知已开启。",
    );
    setPushStatus(status);
  }

  async function handleSaveNotificationPreferences(preferences: NotificationPreferences) {
    const hasReminder = preferences.dailyReminderEnabled || preferences.letterWarningEnabled;
    const status = await withNotificationFeedback(
      "save",
      () => savePushPreferences(preferences),
      hasReminder ? "通知设置已保存。" : "所有提醒已取消，设备订阅已清理。",
    );
    setPushStatus(status);
  }

  async function handleDisableNotifications() {
    const status = await withNotificationFeedback(
      "disable",
      disablePushNotifications,
      "此设备的系统通知已关闭。",
    );
    setPushStatus(status);
  }

  return {
    pushStatus,
    notificationAction,
    reset,
    enable: handleEnableNotifications,
    savePreferences: handleSaveNotificationPreferences,
    disable: handleDisableNotifications,
  };
}
