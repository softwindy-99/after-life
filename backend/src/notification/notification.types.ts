export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPreferencesInput {
  dailyReminderEnabled?: boolean;
  dailyReminderTime?: string;
  timezone?: string;
  letterWarningEnabled?: boolean;
  letterWarningMinutes?: number;
}

export interface PushSubscriptionRemovalInput {
  endpoint?: string;
  subscriptionId?: string;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSubscriptionStatus {
  subscribed: boolean;
  subscriptionId: string | null;
  preferences: {
    dailyReminderEnabled: boolean;
    dailyReminderTime: string;
    timezone: string;
    letterWarningEnabled: boolean;
    letterWarningMinutes: number;
  } | null;
}
