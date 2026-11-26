import { Field, Input, Select } from "../components/ui";
import { useEffect, useMemo, useState } from "react";
import { Bell, BellOff, CalendarCheck2, CheckCircle2, FileWarning } from "lucide-react";
import { Button } from "../components/ui/button";
import type { CheckInStatus, DashboardData, NotificationPreferences } from "../lib/api";
import type { BrowserPushStatus } from "../lib/push";
import { defaultNotificationPreferences } from "../lib/push";
import type { NotificationAction } from "../types";
import { formatDateTime } from "../lib/format";

export function CheckInScreen(props: {
  dashboard: DashboardData;
  status: CheckInStatus | null;
  pushStatus: BrowserPushStatus;
  loading: boolean;
  notificationAction: NotificationAction | null;
  onCheckIn: () => Promise<void>;
  onEnableNotifications: (preferences: NotificationPreferences) => Promise<void>;
  onSaveNotificationPreferences: (preferences: NotificationPreferences) => Promise<void>;
  onDisableNotifications: () => Promise<void>;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences>(() =>
    defaultNotificationPreferences(),
  );

  useEffect(() => {
    if (props.pushStatus.preferences) setPreferences(props.pushStatus.preferences);
  }, [props.pushStatus.preferences]);

  const checkedInToday = isToday(props.status?.lastSeenAt);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const baselineAt = props.status?.baselineAt ?? props.status?.lastSeenAt;
  const upcomingLetters = useMemo(
    () => findUpcomingLetters(props.dashboard, baselineAt),
    [props.dashboard, baselineAt],
  );
  const permissionLabel = notificationPermissionLabel(props.pushStatus);
  const interactionPending = props.loading || props.notificationAction !== null;

  return (
    <section className="check-in-stack">
      <div className={`check-in-hero${checkedInToday ? " is-complete" : ""}`}>
        <div className="check-in-hero-icon" aria-hidden="true">
          {checkedInToday ? <CheckCircle2 size={31} /> : <CalendarCheck2 size={31} />}
        </div>
        <div className="check-in-hero-copy">
          <p className="eyebrow">Daily check-in</p>
          <h3>{checkedInToday ? "今天已经签到" : "确认今天一切安好"}</h3>
          <p>
            {checkedInToday
              ? `最近签到：${formatDateTime(props.status?.lastSeenAt)}`
              : props.status?.lastSeenAt
                ? `上次签到：${formatDateTime(props.status.lastSeenAt)}`
                : "还没有签到记录。签到后，所有自动投递倒计时都会从现在重新开始。"}
          </p>
        </div>
        <Button
          busy={props.loading}
          disabled={interactionPending}
          type="button"
          onClick={() => void props.onCheckIn().catch(() => undefined)}
        >
          <CalendarCheck2 aria-hidden="true" size={17} />
          {props.loading ? "签到中..." : checkedInToday ? "再次确认平安" : "立即签到"}
        </Button>
      </div>

      <div className="check-in-grid">
        <article className="panel check-in-panel">
          <div className="check-in-panel-heading">
            <span className="check-in-panel-icon" aria-hidden="true">
              <FileWarning size={20} />
            </span>
            <div>
              <h3>信件投递倒计时</h3>
              <p>
                {props.status?.baselineSource === "account-created"
                  ? "尚无签到记录，当前按账号创建时间计算；签到后会重新计时。"
                  : "按最近一次签到时间计算；再次签到会重置这些时间。"}
              </p>
            </div>
          </div>
          {upcomingLetters.length ? (
            <div className="deadline-list">
              {upcomingLetters.map(({ letter, dueAt }) => (
                <div className="deadline-item" key={letter.uuid}>
                  <div>
                    <strong>{letter.title}</strong>
                    <span>{formatDateTime(dueAt.toISOString())} 预计触发</span>
                  </div>
                  <span className="deadline-remaining">{formatRemaining(dueAt, now)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="check-in-empty">当前没有等待自动投递的信件。</p>
          )}
        </article>

        <article className="panel check-in-panel">
          <div className="check-in-panel-heading">
            <span className="check-in-panel-icon" aria-hidden="true">
              {props.pushStatus.subscribed ? <Bell size={20} /> : <BellOff size={20} />}
            </span>
            <div>
              <h3>系统通知</h3>
              <p>即使 PWA 没有打开，也能收到签到和信件提醒。</p>
            </div>
            <span className={`status-pill${props.pushStatus.subscribed ? " is-active" : ""}`}>
              {permissionLabel}
            </span>
          </div>

          <div className="notification-settings">
            <div className="toggle-row notification-toggle">
              <Input
                checked={preferences.dailyReminderEnabled}
                disabled={interactionPending}
                id="daily-reminder-enabled"
                type="checkbox"
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    dailyReminderEnabled: event.target.checked,
                  }))
                }
              />
              <label htmlFor="daily-reminder-enabled">当天未签到时提醒我</label>
            </div>
            <label>
              每日提醒时间
              <Input
                disabled={interactionPending || !preferences.dailyReminderEnabled}
                type="time"
                value={preferences.dailyReminderTime}
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    dailyReminderTime: event.target.value,
                  }))
                }
              />
            </label>
            <div className="toggle-row notification-toggle">
              <Input
                checked={preferences.letterWarningEnabled}
                disabled={interactionPending}
                id="letter-warning-enabled"
                type="checkbox"
                onChange={(event) =>
                  setPreferences((current) => ({
                    ...current,
                    letterWarningEnabled: event.target.checked,
                  }))
                }
              />
              <label htmlFor="letter-warning-enabled">信件即将发送时提醒我</label>
            </div>
            <Field label="信件提前提醒时间">
              <Select
                ariaLabel="信件提前提醒时间"
                disabled={interactionPending || !preferences.letterWarningEnabled}
                value={String(preferences.letterWarningMinutes)}
                onValueChange={(value) =>
                  setPreferences((current) => ({
                    ...current,
                    letterWarningMinutes: Number(value),
                  }))
                }
                options={[
                  { value: "15", label: "提前 15 分钟" },
                  { value: "30", label: "提前 30 分钟" },
                  { value: "60", label: "提前 1 小时" },
                  { value: "180", label: "提前 3 小时" },
                  { value: "1440", label: "提前 1 天" },
                  { value: "10080", label: "提前 7 天" },
                ]}
              />
            </Field>
            <p className="settings-hint">
              当前时区：{preferences.timezone}。浏览器曾被拒绝通知时，请先在站点设置中恢复权限。
            </p>
          </div>

          <div className="inline-actions">
            {props.pushStatus.subscribed ? (
              <>
                <Button
                  busy={props.notificationAction === "save"}
                  disabled={interactionPending}
                  type="button"
                  onClick={() =>
                    void props.onSaveNotificationPreferences(preferences).catch(() => undefined)
                  }
                >
                  {props.notificationAction === "save"
                    ? "保存中..."
                    : preferences.dailyReminderEnabled || preferences.letterWarningEnabled
                      ? "保存提醒设置"
                      : "取消全部提醒"}
                </Button>
                <Button
                  busy={props.notificationAction === "disable"}
                  disabled={interactionPending}
                  type="button"
                  variant="outline"
                  onClick={() => void props.onDisableNotifications().catch(() => undefined)}
                >
                  {props.notificationAction === "disable" ? "关闭中..." : "关闭此设备通知"}
                </Button>
              </>
            ) : (
              <Button
                busy={props.notificationAction === "enable"}
                disabled={interactionPending || !props.pushStatus.supported}
                type="button"
                onClick={() => void props.onEnableNotifications(preferences).catch(() => undefined)}
              >
                <Bell aria-hidden="true" size={17} />
                {props.notificationAction === "enable" ? "开启中..." : "开启此设备通知"}
              </Button>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}

function isToday(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function findUpcomingLetters(dashboard: DashboardData, lastSeenAt?: string | null) {
  if (!lastSeenAt) return [];
  const baseline = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(baseline)) return [];
  return dashboard.letters
    .flatMap((letter) => {
      if (
        !letter.deliveryEnabled ||
        !letter.inactiveAfterMinutes ||
        letter.lastTriggeredAt ||
        !letter.contacts?.some((contact) => Boolean(contact.email))
      ) {
        return [];
      }
      return [
        {
          letter,
          dueAt: new Date(baseline + letter.inactiveAfterMinutes * 60 * 1000),
        },
      ];
    })
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
}

function formatRemaining(dueAt: Date, now: number): string {
  const minutes = Math.ceil((dueAt.getTime() - now) / 60000);
  if (minutes <= 0) return "等待服务处理";
  if (minutes < 60) return `${minutes} 分钟后`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)} 小时后`;
  return `${Math.ceil(minutes / 1440)} 天后`;
}

function notificationPermissionLabel(status: BrowserPushStatus): string {
  if (!status.supported) return "此环境不支持";
  if (status.subscribed) return "已开启";
  if (status.permission === "denied") return "权限已拒绝";
  return "未开启";
}
