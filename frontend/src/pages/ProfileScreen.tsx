import { Input } from "../components/ui";
import { FormEvent, useEffect, useState } from "react";
import { DashboardData } from "../lib/api";
import { AvatarPreview } from "../components/shared/AvatarPreview";
import { Button } from "../components/ui/button";
import { readFileAsDataUrl } from "../lib/format";

import { hasAdminAccess } from "../lib/format";

export function ProfileScreen(props: {
  user: DashboardData["user"];
  avatar: string | null;
  loading: boolean;
  onSave: (payload: {
    username: string;
    email: string;
    password?: string;
    avatar?: string | null;
  }) => Promise<void>;
}) {
  const isAdmin = hasAdminAccess(props.user);
  const [form, setForm] = useState({
    username: props.user?.username || "",
    email: props.user?.email || "",
    password: "",
    avatar: props.avatar || "",
    avatarChanged: false,
  });

  useEffect(() => {
    setForm({
      username: props.user?.username || "",
      email: props.user?.email || "",
      password: "",
      avatar: props.avatar || "",
      avatarChanged: false,
    });
  }, [props.user, props.avatar]);

  async function handleAvatarChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const avatar = await readFileAsDataUrl(file);
    setForm((current) => ({ ...current, avatar, avatarChanged: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await props.onSave({
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password.trim() || undefined,
      avatar: form.avatarChanged ? form.avatar || null : undefined,
    });
    setForm((current) => ({ ...current, password: "" }));
  }

  return (
    <section className="split-grid">
      <form
        className="panel form-panel"
        onSubmit={(event) => void handleSubmit(event).catch(() => undefined)}
      >
        <div className="panel-head">
          <h3>更新个人资料</h3>
          <span>Profile settings</span>
        </div>
        <label>
          用户名
          <Input
            value={form.username}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                username: event.target.value,
              }))
            }
            required
          />
        </label>
        <label>
          邮箱
          <Input
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            required
          />
        </label>
        <label>
          新密码
          <Input
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                password: event.target.value,
              }))
            }
            placeholder="留空则不修改"
          />
        </label>
        <label>
          头像
          <Input accept="image/*" type="file" onChange={handleAvatarChange} />
        </label>
        <div className="avatar-editor">
          <AvatarPreview value={form.avatar} label={form.username} />
          <div className="avatar-editor-copy">
            <span>选择头像后，点击“保存资料”完成更新。</span>
            {form.avatar ? (
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    avatar: "",
                    avatarChanged: true,
                  }))
                }
              >
                清除头像
              </Button>
            ) : null}
          </div>
        </div>
        <Button variant="default" busy={props.loading} type="submit">
          {props.loading ? "保存中..." : "保存资料"}
        </Button>
      </form>

      <section className="panel">
        <div className="panel-head">
          <h3>账号状态</h3>
          <span>Account snapshot</span>
        </div>
        <dl className="detail-list">
          <div>
            <dt>用户 UUID</dt>
            <dd>{props.user?.uuid || "暂无"}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{props.user?.role?.name || "user"}</dd>
          </div>
          <div>
            <dt>邮箱</dt>
            <dd>{props.user?.email || "暂无"}</dd>
          </div>
        </dl>
        <p className="muted">
          {isAdmin
            ? "管理员账号可查看和维护用户、角色与权限，请仅在系统管理时使用。"
            : "日常账户只可访问你本人的资料、信件和联系人，不具备系统管理权限。"}
        </p>
      </section>
    </section>
  );
}
