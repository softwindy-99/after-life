import { Field, Input, Select, Textarea } from "../components/ui";
import { FormEvent, useEffect, useState } from "react";
import {
  MailConfigDraft,
  MailConfigStatus,
  SendMailNotification,
  SendMailResult,
} from "../lib/api";
import { Button } from "../components/ui/button";

type MailConfigFormDraft = Omit<MailConfigDraft, "port"> & { port: string };

function configDraft(config: MailConfigStatus | null): MailConfigFormDraft {
  const defaultFrom = config ? `No Reply <${config.user}>` : "";
  return {
    host: config?.host || "",
    port: String(config?.port || 587),
    secure: config?.secure || false,
    user: config?.user || "",
    password: "",
    from: config?.from === defaultFrom ? "" : config?.from || "",
  };
}

function resultText(result: SendMailResult | null) {
  if (!result) return "暂无发送记录";
  const accepted = result.accepted.length ? result.accepted.join(", ") : "无";
  const rejected = result.rejected.length ? result.rejected.join(", ") : "无";
  return `已接受：${accepted}；被拒绝：${rejected}${
    result.messageId ? `；消息 ID：${result.messageId}` : ""
  }`;
}

export function MailScreen(props: {
  config: MailConfigStatus | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onSave: (payload: MailConfigDraft) => Promise<MailConfigStatus>;
  onVerify: () => Promise<boolean>;
  onTest: (to: string) => Promise<SendMailResult>;
  onNotify: (payload: SendMailNotification) => Promise<SendMailResult>;
}) {
  const [mailDraft, setMailDraft] = useState<MailConfigFormDraft>(() => configDraft(props.config));
  const [testTo, setTestTo] = useState("");
  const [notifyDraft, setNotifyDraft] = useState({
    to: "",
    subject: "",
    text: "",
    html: "",
  });
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);
  const [sendResult, setSendResult] = useState<SendMailResult | null>(null);

  useEffect(() => {
    setMailDraft(configDraft(props.config));
  }, [props.config]);

  async function submitConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextConfig = await props.onSave({
      ...mailDraft,
      port: Number(mailDraft.port),
      password: mailDraft.password || undefined,
      from: mailDraft.from || undefined,
    });
    setMailDraft(configDraft(nextConfig));
    setVerifyResult(null);
  }

  async function submitTest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendResult(await props.onTest(testTo));
  }

  async function submitNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const recipients = notifyDraft.to
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    setSendResult(
      await props.onNotify({
        to: recipients.length > 1 ? recipients : recipients[0] || "",
        subject: notifyDraft.subject,
        text: notifyDraft.text || undefined,
        html: notifyDraft.html || undefined,
      }),
    );
  }

  return (
    <section className="stack">
      <div className="split-grid">
        <form
          className="panel form-panel"
          onSubmit={(event) => void submitConfig(event).catch(() => undefined)}
        >
          <div className="panel-head">
            <h3>邮件配置</h3>
            <span>{props.config?.configured ? "Ready" : "Incomplete"}</span>
          </div>
          <div className="form-grid">
            <label>
              SMTP 服务器
              <Input
                value={mailDraft.host}
                onChange={(event) =>
                  setMailDraft((current) => ({ ...current, host: event.target.value }))
                }
                placeholder="smtp.example.com"
                required
              />
            </label>
            <label>
              端口
              <Input
                type="number"
                min="1"
                max="65535"
                value={mailDraft.port}
                onChange={(event) =>
                  setMailDraft((current) => ({
                    ...current,
                    port: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              账号
              <Input
                value={mailDraft.user}
                onChange={(event) =>
                  setMailDraft((current) => ({ ...current, user: event.target.value }))
                }
                placeholder="no-reply@example.com"
                autoComplete="username"
                required
              />
            </label>
            <label>
              密码
              <Input
                type="password"
                value={mailDraft.password || ""}
                onChange={(event) =>
                  setMailDraft((current) => ({ ...current, password: event.target.value }))
                }
                placeholder={
                  props.config?.missingKeys.includes("MAIL_PASSWORD")
                    ? "请输入邮件密码"
                    : "留空则保留现有密码"
                }
                autoComplete="new-password"
                required={props.config?.missingKeys.includes("MAIL_PASSWORD")}
              />
            </label>
            <label>
              发件人显示
              <Input
                value={mailDraft.from || ""}
                onChange={(event) =>
                  setMailDraft((current) => ({ ...current, from: event.target.value }))
                }
                placeholder="After Life <no-reply@example.com>"
              />
            </label>
            <Field label="安全连接">
              <Select
                ariaLabel="安全连接"
                value={String(mailDraft.secure)}
                onValueChange={(value) =>
                  setMailDraft((current) => ({
                    ...current,
                    secure: value === "true",
                  }))
                }
                options={[
                  { value: "false", label: "关闭（常用于 587）" },
                  { value: "true", label: "开启（常用于 465）" },
                ]}
              />
            </Field>
          </div>
          {props.config?.missingKeys.length ? (
            <div className="notice notice-error">
              缺少配置：{props.config.missingKeys.join(", ")}
            </div>
          ) : null}
          <div className="form-actions">
            <Button variant="default" type="submit" busy={props.loading} disabled={!props.config}>
              保存配置
            </Button>
            <Button
              variant="outline"
              type="button"
              disabled={props.loading}
              onClick={() => void props.onRefresh().catch(() => undefined)}
            >
              刷新配置
            </Button>
            <Button
              variant="default"
              type="button"
              disabled={props.loading || !props.config?.configured}
              onClick={() =>
                void props
                  .onVerify()
                  .then(setVerifyResult)
                  .catch(() => undefined)
              }
            >
              验证连接
            </Button>
          </div>
          {verifyResult !== null ? (
            <div className={`notice ${verifyResult ? "notice-success" : "notice-error"}`}>
              {verifyResult ? "SMTP 连接验证通过。" : "SMTP 连接验证失败。"}
            </div>
          ) : null}
        </form>

        <form
          className="panel form-panel"
          onSubmit={(event) => void submitTest(event).catch(() => undefined)}
        >
          <div className="panel-head">
            <h3>发送测试邮件</h3>
            <span>Test mail</span>
          </div>
          <label>
            收件邮箱
            <Input
              type="email"
              value={testTo}
              onChange={(event) => setTestTo(event.target.value)}
              placeholder="person@example.com"
              required
            />
          </label>
          <Button
            variant="default"
            disabled={props.loading || !props.config?.configured}
            type="submit"
          >
            发送测试
          </Button>
        </form>
      </div>

      <form
        className="panel form-panel"
        onSubmit={(event) => void submitNotification(event).catch(() => undefined)}
      >
        <div className="panel-head">
          <h3>发送通知邮件</h3>
          <span>Notify</span>
        </div>
        <div className="form-grid">
          <label>
            收件邮箱
            <Input
              value={notifyDraft.to}
              onChange={(event) =>
                setNotifyDraft((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
              placeholder="多个邮箱用英文逗号分隔"
              required
            />
          </label>
          <label>
            主题
            <Input
              value={notifyDraft.subject}
              onChange={(event) =>
                setNotifyDraft((current) => ({
                  ...current,
                  subject: event.target.value,
                }))
              }
              required
            />
          </label>
        </div>
        <label>
          文本内容
          <Textarea
            value={notifyDraft.text}
            onChange={(event) =>
              setNotifyDraft((current) => ({
                ...current,
                text: event.target.value,
              }))
            }
            rows={6}
            placeholder="普通文本通知内容"
          />
        </label>
        <label>
          HTML 内容
          <Textarea
            value={notifyDraft.html}
            onChange={(event) =>
              setNotifyDraft((current) => ({
                ...current,
                html: event.target.value,
              }))
            }
            rows={6}
            placeholder="<p>可选 HTML 内容</p>"
          />
        </label>
        <div className="form-actions">
          <Button
            variant="default"
            disabled={
              props.loading ||
              !props.config?.configured ||
              (!notifyDraft.text.trim() && !notifyDraft.html.trim())
            }
            type="submit"
          >
            发送通知
          </Button>
          <p className="muted mail-result">{resultText(sendResult)}</p>
        </div>
      </form>
    </section>
  );
}
