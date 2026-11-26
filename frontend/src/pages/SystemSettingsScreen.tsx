import { Input } from "../components/ui";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import type { SystemSettingsDraft, SystemSettingsStatus } from "../lib/api";
import { useStorageSettings } from "../hooks/useStorageSettings";
import { StorageSettingsPanel } from "./StorageSettingsPanel";

function sourceLabel(source: SystemSettingsStatus["pushProxySource"]): string {
  if (source === "WEB_PUSH_PROXY") return "系统设置";
  if (source === "HTTPS_PROXY" || source === "https_proxy") return source;
  return "直连";
}

function editableProxy(settings: SystemSettingsStatus | null): string {
  if (!settings || settings.pushProxyHasCredentials) return "";
  return settings.pushProxy;
}

export function SystemSettingsScreen(props: {
  settings: SystemSettingsStatus | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onSave: (payload: SystemSettingsDraft) => Promise<SystemSettingsStatus>;
}) {
  const storage = useStorageSettings();
  const [pushProxy, setPushProxy] = useState(() => editableProxy(props.settings));
  const [proxyChanged, setProxyChanged] = useState(false);

  useEffect(() => {
    setPushProxy(editableProxy(props.settings));
    setProxyChanged(false);
  }, [props.settings]);

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settings = await props.onSave({
      pushProxy: proxyChanged ? pushProxy : null,
    });
    setPushProxy(editableProxy(settings));
    setProxyChanged(false);
  }

  const statusLabel = !props.settings?.pushProxyConfigured
    ? "Direct"
    : props.settings.pushProxyValid
      ? "Ready"
      : "Invalid";

  return (
    <section className="stack">
      <form
        className="panel form-panel"
        onSubmit={(event) => void submitSettings(event).catch(() => undefined)}
      >
        <div className="panel-head">
          <div>
            <p className="eyebrow">System settings</p>
            <h3>系统设置</h3>
          </div>
          <span>{statusLabel}</span>
        </div>

        <div className="form-grid">
          <label>
            Web Push 出站代理
            <Input
              value={pushProxy}
              onChange={(event) => {
                setPushProxy(event.target.value);
                setProxyChanged(true);
              }}
              placeholder={
                props.settings?.pushProxyHasCredentials
                  ? "已配置认证代理；留空将保留现有值"
                  : "http://127.0.0.1:7890"
              }
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        <p className="muted">
          当前生效：{props.settings?.pushProxyConfigured ? props.settings.pushProxy : "未配置"}
          ；来源：{sourceLabel(props.settings?.pushProxySource || null)}。仅支持 HTTP 或 HTTPS
          代理，保存后服务会自动重新加载。
        </p>

        {props.settings?.pushProxyHasCredentials ? (
          <div className="notice notice-success">
            当前代理包含认证信息，管理员界面仅显示已脱敏的地址；不修改输入框即可保留原值。
          </div>
        ) : null}
        {props.settings?.pushProxyConfigured && !props.settings.pushProxyValid ? (
          <div className="notice notice-error">
            当前代理格式无效，请保存有效的 HTTP/HTTPS 代理地址或清除该设置。
          </div>
        ) : null}

        <div className="form-actions">
          <Button
            variant="default"
            type="submit"
            busy={props.loading}
            disabled={props.loading || !props.settings || !proxyChanged}
          >
            保存并重载
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={props.loading}
            onClick={() => void props.onRefresh().catch(() => undefined)}
          >
            刷新设置
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={
              props.loading ||
              !props.settings?.pushProxyConfigured ||
              props.settings.pushProxySource !== "WEB_PUSH_PROXY"
            }
            onClick={() => {
              setPushProxy("");
              setProxyChanged(true);
            }}
          >
            清除代理
          </Button>
        </div>
      </form>
      <StorageSettingsPanel {...storage} />
    </section>
  );
}
