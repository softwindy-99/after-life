import { LetterPreview } from "../components/letters/LetterPreview";
import { useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Dialog, Field, Input, Select, Textarea } from "../components/ui";
import type { McpGrant, McpGrantDraft, LetterRecord } from "../lib/api";
import type { McpSettingsState } from "../hooks/useMcpSettings";
import { absoluteResourceUrl } from "../lib/api";
import { formatDate } from "../lib/format";
import "../styles/mcp.css";

const readScopes = ["mcp:letters:read", "mcp:contacts:read"];
const editScopes = [
  ...readScopes,
  "mcp:resources:read",
  "mcp:letters:write",
  "mcp:contacts:write",
  "mcp:resources:write",
];
const emptyDraft = (): McpGrantDraft => ({ name: "", scopes: [...readScopes], days: 30 });
const outcomes: Record<string, string> = {
  success: "成功",
  error: "失败",
  pending: "等待确认",
  approved: "已批准",
  rejected: "已拒绝",
  ready: "已预览",
  consumed: "已使用",
  expired: "已失效",
};
const toolLabels: Record<string, string> = {
  afterlife_get_my_profile: "读取个人资料",
  afterlife_list_contacts: "查询联系人列表",
  afterlife_get_contact: "读取联系人",
  afterlife_create_contact: "新增联系人",
  afterlife_update_contact: "修改联系人",
  afterlife_list_letters: "查询信件列表",
  afterlife_get_letter: "读取信件",
  afterlife_read_letter_content: "分段读取正文",
  afterlife_create_letter: "新建信件",
  afterlife_update_letter: "修改信件",
  afterlife_create_letter_draft: "新建草稿",
  afterlife_update_letter_draft: "修改草稿",
  afterlife_preview_delivery: "预览检测设置",
  afterlife_set_delivery: "调整检测开关",
  afterlife_get_check_in_status: "查询签到状态",
  afterlife_record_check_in: "辅助签到",
  afterlife_list_letter_resources: "查询附件",
  afterlife_get_resource_access: "访问附件",
  afterlife_prepare_resource_upload: "申请上传附件",
  resource_upload: "附件上传凭证",
};

export function McpSettingsScreen(props: McpSettingsState & { letters: LetterRecord[] }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<string>();
  const [confirm, setConfirm] = useState<{ uuid?: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const data = props.settings;
  const endpoint = absoluteResourceUrl("/mcp");
  function selectScope(scope: string, checked: boolean) {
    const scopes = new Set(draft.scopes);
    if (checked) {
      scopes.add(scope);
      if (
        scope.endsWith(":write") &&
        scope !== "mcp:check-in:write" &&
        scope !== "mcp:delivery:write"
      )
        scopes.add(scope.replace(/:write$/, ":read"));
      if (scope === "mcp:delivery:write")
        for (const value of [...readScopes, "mcp:resources:read"]) scopes.add(value);
    } else {
      scopes.delete(scope);
      if (scope.endsWith(":read")) {
        scopes.delete(scope.replace(/:read$/, ":write"));
        scopes.delete("mcp:delivery:write");
      }
    }
    setDraft({ ...draft, scopes: [...scopes] });
  }
  function edit(grant: McpGrant) {
    setEditing(grant.uuid);
    setDraft({
      name: grant.name,
      scopes: grant.scopes?.filter((value) => value !== "mcp:read") ?? [],
      days: 30,
    });
    document
      .getElementById("mcp-grant-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await props.save(draft, editing)) {
      setDraft(emptyDraft());
      setEditing(undefined);
    }
  }
  return (
    <section className="stack mcp-settings">
      <div className="panel">
        <p className="eyebrow">AI CONNECTION / MCP · CLI · SKILL</p>
        <h3>让 AI 在你授予的范围内协助管理</h3>
        <p className="muted">
          每个 agent
          使用独立凭证。始终可以读取你的用户名、邮箱、账号角色及签到状态；其他信息和操作由下方权限决定。
        </p>
        <Field label="接入地址">
          <Input readOnly value={endpoint} onFocus={(event) => event.currentTarget.select()} />
        </Field>
        <p className="muted">
          支持 MCP 的 AI 可直接配置上方地址；可运行命令的 AI 也能使用 CLI，两者共用下方授权。 Skill
          包含操作说明和 CLI，下载后需安装到 AI 客户端的技能目录。
        </p>
        <div className="form-actions">
          <a href={absoluteResourceUrl("/ai/SKILL.md")} target="_blank" rel="noreferrer">
            查看 Skill 说明
          </a>
          <a href={absoluteResourceUrl("/ai/skill.tar.gz")} download>
            下载完整 Skill
          </a>
          <a href={absoluteResourceUrl("/ai/cli.mjs")} download>
            下载 CLI
          </a>
        </div>
        <Field label="CLI 服务器地址（AFTERLIFE_SERVER_URL）">
          <Input
            readOnly
            value={absoluteResourceUrl("")}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
        <p className="muted">
          撤销会阻止后续工具调用；已签发的附件链接在到期前（通常 15 分钟）仍可访问。无法收回 AI
          已读取的数据，也不会自动关闭已配置的信件检测。AI
          服务可能保留处理过的内容，请只接入你信任的服务。
        </p>
      </div>
      {props.error && (
        <div className="notice notice-error" role="alert">
          {props.error}
          <Button
            variant="outline"
            disabled={props.busy}
            onClick={() => void props.refresh(data?.page ?? 1)}
          >
            重试
          </Button>
        </div>
      )}
      <form
        id="mcp-grant-form"
        className="panel form-panel"
        onSubmit={(event) => void submit(event)}
      >
        <div className="panel-head">
          <h3>{editing ? "调整授权" : "新建 agent 授权"}</h3>
          <span>随时可调整或撤销</span>
        </div>
        <div className="form-grid">
          <Field label="授权名称">
            <Input
              required
              maxLength={80}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="例如：我的日常 AI 助手"
            />
          </Field>
          {!editing && (
            <Field label="有效期">
              <Select
                ariaLabel="有效期"
                value={String(draft.days ?? "permanent")}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    days: value === "permanent" ? null : Number(value),
                  })
                }
                options={[
                  { value: "7", label: "7 天" },
                  { value: "30", label: "30 天" },
                  { value: "90", label: "90 天" },
                  { value: "permanent", label: "永久" },
                ]}
              />
            </Field>
          )}
        </div>
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({ ...draft, scopes: [...readScopes] })}
          >
            只读
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({ ...draft, scopes: [...editScopes] })}
          >
            协助编辑
          </Button>
          <span className="muted">检测管理与辅助签到需单独勾选</span>
        </div>
        <div className="mcp-permissions">
          {data?.permissions.map((permission) => (
            <label
              className={`mcp-permission ${permission.scope === "mcp:delivery:write" || permission.scope === "mcp:check-in:write" ? "mcp-permission-sensitive" : ""}`}
              key={permission.scope}
            >
              <Input
                type="checkbox"
                checked={draft.scopes.includes(permission.scope)}
                onChange={(event) => selectScope(permission.scope, event.target.checked)}
              />
              <span>
                <strong>{permission.label}</strong>
                <small>{permission.risk}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="muted">
          勾选即表示允许该 agent 执行对应操作。辅助签到仅限近期真实人类交互，AI
          回复、定时任务和后台活动均不得续期。
        </p>
        <div className="form-actions">
          <Button type="submit" busy={props.busy} disabled={!data || props.busy}>
            {editing ? "保存授权" : "授权并生成凭证"}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(undefined);
                setDraft(emptyDraft());
              }}
            >
              取消编辑
            </Button>
          )}
        </div>
      </form>
      <div className="panel stack">
        <div className="panel-head">
          <h3>已授权的 agent</h3>
          <div className="form-actions">
            <Button variant="outline" disabled={props.busy} onClick={() => void props.refresh()}>
              刷新
            </Button>
            <Button
              variant="destructive"
              disabled={props.busy || !data?.grants.length}
              onClick={() => setConfirm({ name: "全部 agent" })}
            >
              撤销全部
            </Button>
          </div>
        </div>
        {!data ? (
          <p className="muted">正在读取授权…</p>
        ) : !data.grants.length ? (
          <p className="muted">尚未创建授权。</p>
        ) : (
          data.grants.map((grant) => (
            <article key={grant.uuid} className="mcp-grant">
              <div>
                <h4>{grant.name}</h4>
                <p className="muted">
                  {grant.legacy
                    ? "旧版可读取资料、信件和联系人，也可能允许修改联系人及关闭状态草稿；确切范围以原凭证为准。建议撤销并重新创建细分授权。"
                    : grant.scopes
                        ?.filter((scope) => scope !== "mcp:read")
                        .map(
                          (scope) =>
                            data.permissions.find((permission) => permission.scope === scope)
                              ?.label ?? scope,
                        )
                        .join("、") || "仅基本资料与签到状态"}
                </p>
                <small>
                  到期：
                  {grant.expiresAt
                    ? formatDate(grant.expiresAt)
                    : grant.legacy
                      ? "以原凭证为准"
                      : "永久"}{" "}
                  · 最近调用：{grant.lastUsedAt ? formatDate(grant.lastUsedAt) : "暂无记录"} ·
                  最近代签到：{grant.lastCheckInAt ? formatDate(grant.lastCheckInAt) : "暂无记录"}
                </small>
              </div>
              <div className="form-actions">
                {!grant.legacy && (
                  <Button variant="outline" disabled={props.busy} onClick={() => edit(grant)}>
                    调整权限
                  </Button>
                )}
                <Button
                  variant="destructive"
                  disabled={props.busy}
                  onClick={() => setConfirm({ uuid: grant.uuid, name: grant.name })}
                >
                  撤销
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      <div className="panel stack">
        <div className="panel-head">
          <h3>待确认的启用请求</h3>
          <span>仅限 10 分钟内的有效请求</span>
        </div>
        <p className="muted">
          这些信件已达到未活跃时限，启用后可能立即投递。批准只允许 agent
          提交当前版本；不会直接发送邮件。请打开请求详情，核对最新正文、附件与联系人。
        </p>
        {!data?.pending.length ? (
          <p className="muted">暂无待确认请求。</p>
        ) : (
          data.pending.map((event) => (
            <article className="mcp-grant" key={event.uuid}>
              <div>
                <h4>
                  {props.letters.find((letter) => letter.uuid === event.resourceUuid)?.title ??
                    "信件启用请求"}
                </h4>
                <p>
                  {data.grants.find((grant) => grant.uuid === event.authUuid)?.name} ·{" "}
                  {event.details?.contactCount ?? 0} 位邮件收件人 ·{" "}
                  {event.details?.resourceCount ?? 0} 个附件
                </p>
                <small>
                  时限：{event.details?.inactiveAfterMinutes} 分钟 · 预计触发：
                  {formatDate(event.details?.dueAt)} · 到期：
                  {formatDate(event.expiresAt ?? undefined)}
                </small>
              </div>
              <div className="form-actions">
                <Button
                  variant="outline"
                  disabled={props.busy}
                  onClick={() => void props.approve(event.uuid, false)}
                >
                  拒绝
                </Button>
                <Button
                  variant="outline"
                  disabled={props.busy}
                  onClick={() => void props.reviewApproval(event.uuid)}
                >
                  核对并确认
                </Button>
              </div>
            </article>
          ))
        )}
      </div>
      <div className="panel stack">
        <div className="panel-head">
          <h3>操作记录</h3>
          <span>不记录正文、附件内容或凭证</span>
        </div>
        {!data?.events.length ? (
          <p className="muted">暂无操作记录。</p>
        ) : (
          <ul className="mcp-events">
            {data.events.map((event) => (
              <li key={event.uuid}>
                <div>
                  <strong>{toolLabels[event.tool] ?? event.tool}</strong>
                  <small>
                    {event.agentName ??
                      data.grants.find((grant) => grant.uuid === event.authUuid)?.name ??
                      event.authUuid}
                    {event.resourceUuid
                      ? ` · ${props.letters.find((letter) => letter.uuid === event.resourceUuid)?.title ?? event.resourceUuid}`
                      : ""}
                  </small>
                </div>
                <span>
                  {outcomes[event.outcome] ?? event.outcome}
                  <small>{formatDate(event.createdAt)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={props.busy || !data || data.page <= 1}
            onClick={() => void props.refresh((data?.page ?? 1) - 1)}
          >
            上一页
          </Button>
          <span>第 {data?.page ?? 1} 页</span>
          <Button
            variant="outline"
            disabled={props.busy || !data || data.page * 30 >= data.total}
            onClick={() => void props.refresh((data?.page ?? 1) + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
      <Dialog
        open={Boolean(props.secret)}
        title="保存接入凭证"
        description="完整凭证仅本次显示。关闭后无法找回；遗失时请撤销并重新创建。"
        onOpenChange={() => {
          props.dismissSecret();
          setCopied(false);
        }}
      >
        <div className="stack">
          <Field label="接入地址">
            <Input readOnly value={endpoint} />
          </Field>
          <Field label="接入凭证">
            <Textarea readOnly value={props.secret} rows={5} />
          </Field>
          <p className="muted">
            在支持 Streamable HTTP 的客户端中配置此地址，并将凭证填写到 Bearer
            Token；不要放入公开对话或分享给其他人。 CLI 使用同一凭证，通过 AFTERLIFE_TOKEN_FILE
            指定私有凭证文件；不要把凭证放进命令参数。
          </p>
          <div className="form-actions">
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(
                    JSON.stringify(
                      { url: endpoint, headers: { Authorization: `Bearer ${props.secret}` } },
                      null,
                      2,
                    ),
                  )
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? "已复制" : "复制接入配置"}
            </Button>
            <Button variant="outline" onClick={props.dismissSecret}>
              已保存，关闭
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={Boolean(props.review)}
        title="核对即将启用的信件"
        description="批准后，agent 可在预览有效期内启用此版本；信件可能立即自动投递。"
        onOpenChange={props.dismissReview}
      >
        <div className="stack">
          {props.review && (
            <>
              <h4>{props.review.letter.title}</h4>
              <LetterPreview
                content={props.review.letter.content}
                contentFormat={props.review.letter.contentFormat}
              />
              <div>
                <strong>邮件收件人</strong>
                {props.review.letter.contacts
                  ?.filter((contact) => contact.email)
                  .map((contact) => (
                    <p key={contact.uuid}>
                      {contact.name} · {contact.email}
                    </p>
                  ))}
              </div>
              <div>
                <strong>附件</strong>
                {!props.review.resources.length ? (
                  <p className="muted">无附件</p>
                ) : (
                  props.review.resources.map((file) => (
                    <p key={file.uuid}>
                      <a
                        href={absoluteResourceUrl(file.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {file.filename}
                      </a>{" "}
                      · {Math.ceil(file.sizeBytes / 1024)} KB
                    </p>
                  ))
                )}
              </div>
              <p className="muted">
                时限：{props.review.event.details?.inactiveAfterMinutes} 分钟 · 预计触发：
                {formatDate(props.review.event.details?.dueAt)}
              </p>
              <Button
                variant="destructive"
                disabled={props.busy}
                onClick={async () => {
                  if (props.review && (await props.approve(props.review.event.uuid, true)))
                    props.dismissReview();
                }}
              >
                我已核对，允许启用
              </Button>
            </>
          )}
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(confirm)}
        title="撤销授权"
        description={`撤销 ${confirm?.name ?? ""} 的后续访问权限。已读取的数据无法收回，现有信件检测继续生效。`}
        confirmLabel="确认撤销"
        loading={props.busy}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={async () => {
          if (await props.revoke(confirm?.uuid)) setConfirm(null);
        }}
      />
    </section>
  );
}
