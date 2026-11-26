import { Input, Table } from "../components/ui";
import { Dispatch, FormEvent, SetStateAction, useRef, useState, type ChangeEvent } from "react";
import { Pencil, Plus, Search } from "lucide-react";
import { PagedUsers, RoleRecord, UserRecord } from "../lib/api";
import { AvatarPreview } from "../components/shared/AvatarPreview";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { Select } from "../components/ui/select";
import { readFileAsDataUrl } from "../lib/format";
import { emptyUserDraft, UserDraft, UserQuery } from "../types";

export function UsersScreen(props: {
  loading: boolean;
  usersPage: PagedUsers;
  roles: RoleRecord[];
  query: UserQuery;
  onQueryChange: Dispatch<SetStateAction<UserQuery>>;
  onFetchAvatar: (uuid: string) => Promise<string | null>;
  onCreate: (payload: UserDraft) => Promise<void>;
  onSave: (uuid: string, payload: UserDraft) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft>(emptyUserDraft);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const avatarRequestRef = useRef<string | null>(null);

  function closeEditor() {
    if (props.loading) return;
    setEditorOpen(false);
    setEditingUuid(null);
    setDraft(emptyUserDraft);
    setAvatarLoading(false);
    avatarRequestRef.current = null;
  }

  function beginCreate() {
    const defaultRole = props.roles.find((role) => role.name === "user") || props.roles[0] || null;
    avatarRequestRef.current = null;
    setEditingUuid(null);
    setDraft({
      ...emptyUserDraft,
      roleUuid: defaultRole?.uuid || "",
    });
    setEditorOpen(true);
  }

  async function beginEdit(user: UserRecord) {
    setEditingUuid(user.uuid);
    setDraft({
      username: user.username,
      email: user.email,
      password: "",
      roleUuid: user.role?.uuid || "",
      avatar: "",
      avatarChanged: false,
    });
    setEditorOpen(true);
    setAvatarLoading(true);
    avatarRequestRef.current = user.uuid;
    try {
      const avatar = await props.onFetchAvatar(user.uuid);
      if (avatarRequestRef.current === user.uuid) {
        setDraft((current) => ({ ...current, avatar: avatar || "", avatarChanged: false }));
      }
    } catch {
      // The editor can still be used when the existing avatar cannot be loaded.
    } finally {
      if (avatarRequestRef.current === user.uuid) {
        setAvatarLoading(false);
      }
    }
  }

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const avatar = await readFileAsDataUrl(file);
    setDraft((current) => ({ ...current, avatar, avatarChanged: true }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (editingUuid) {
        await props.onSave(editingUuid, draft);
      } else if (draft.roleUuid) {
        await props.onCreate(draft);
      } else {
        return;
      }
      closeEditor();
    } catch {
      // App-level feedback remains visible while the editor stays open for correction.
    }
  }

  const totalPages = Math.max(1, Math.ceil(props.usersPage.total / props.query.pageSize));
  const creating = !editingUuid;

  return (
    <>
      <section className="panel management-panel">
        <div className="panel-head management-head">
          <div>
            <h3>用户列表</h3>
            <p>检索用户并维护账号资料、头像和角色。</p>
          </div>
          <div className="management-actions">
            <span className="record-count">共 {props.usersPage.total} 位</span>
            <Button disabled={props.roles.length === 0} type="button" onClick={beginCreate}>
              <Plus aria-hidden="true" size={17} />
              新建用户
            </Button>
          </div>
        </div>

        <div className="management-filters">
          <label className="search-field">
            <Search aria-hidden="true" size={17} />
            <Input
              aria-label="搜索用户"
              placeholder="搜索用户名或邮箱"
              value={props.query.keyword}
              onChange={(event) =>
                props.onQueryChange((current) => ({
                  ...current,
                  page: 1,
                  keyword: event.target.value,
                }))
              }
            />
          </label>
          <div className="filter-select">
            <Select
              ariaLabel="角色筛选"
              options={[
                { value: "", label: "全部角色" },
                ...props.roles.map((role) => ({ value: role.uuid, label: role.name })),
              ]}
              value={props.query.roleUuid}
              onValueChange={(roleUuid) =>
                props.onQueryChange((current) => ({ ...current, page: 1, roleUuid }))
              }
            />
          </div>
          <div className="filter-select filter-select-compact">
            <Select
              ariaLabel="每页条数"
              options={[
                { value: "10", label: "每页 10 条" },
                { value: "20", label: "每页 20 条" },
                { value: "50", label: "每页 50 条" },
              ]}
              value={String(props.query.pageSize)}
              onValueChange={(pageSize) =>
                props.onQueryChange((current) => ({
                  ...current,
                  page: 1,
                  pageSize: Number(pageSize),
                }))
              }
            />
          </div>
        </div>

        <div className="management-table-wrap">
          <Table scrollLabel="用户列表" className="management-table users-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>权限</th>
                <th className="table-actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.usersPage.data.map((user) => (
                <tr key={user.uuid}>
                  <td>
                    <div className="user-table-cell">
                      {user.avatar ? (
                        <img alt="" className="user-cell-avatar" src={user.avatar} />
                      ) : (
                        <span aria-hidden="true" className="user-cell-avatar user-cell-initial">
                          {user.username.trim().slice(0, 1).toUpperCase() || "U"}
                        </span>
                      )}
                      <span>
                        <strong className="table-primary">{user.username}</strong>
                        <span className="table-secondary">{user.email}</span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className="chip">{user.role?.name || "user"}</span>
                  </td>
                  <td>
                    {(user.role?.permissions || []).length ? (
                      <div className="chip-row table-chip-row">
                        {(user.role?.permissions || []).map((permission) => (
                          <span className="chip" key={permission.uuid || permission.name}>
                            {permission.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="table-secondary">暂无权限</span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => void beginEdit(user)}
                      >
                        <Pencil aria-hidden="true" size={15} />
                        编辑
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {props.usersPage.data.length === 0 ? (
            <div className="management-empty">
              <strong>当前筛选下没有用户</strong>
              <span>可以调整关键字或角色筛选条件。</span>
            </div>
          ) : null}
        </div>

        <div className="pagination-bar">
          <Button
            disabled={props.query.page <= 1}
            type="button"
            variant="outline"
            onClick={() =>
              props.onQueryChange((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            上一页
          </Button>
          <span>
            第 {props.query.page} / {totalPages} 页
          </span>
          <Button
            disabled={props.query.page >= totalPages}
            type="button"
            variant="outline"
            onClick={() =>
              props.onQueryChange((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            下一页
          </Button>
        </div>
      </section>

      <Dialog
        closeDisabled={props.loading}
        description={
          editingUuid ? "更新账号资料；密码留空时不会修改。" : "创建账号并分配初始角色。"
        }
        open={editorOpen}
        title={editingUuid ? "编辑用户" : "新建用户"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <form className="dialog-form" onSubmit={submit}>
          <div className="dialog-body modal-form-grid">
            <label>
              用户名
              <Input
                autoComplete="username"
                maxLength={50}
                required
                value={draft.username}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, username: event.target.value }))
                }
              />
            </label>
            <label>
              邮箱
              <Input
                autoComplete="email"
                maxLength={50}
                required
                type="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              {creating ? "登录密码" : "新密码"}
              <Input
                autoComplete="new-password"
                maxLength={128}
                minLength={creating ? 8 : undefined}
                placeholder={creating ? "至少 8 个字符" : "留空则不修改"}
                required={creating}
                type="password"
                value={draft.password}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
            <div className="form-field">
              <span className="form-field-label">角色</span>
              <Select
                ariaLabel="角色"
                options={[
                  { value: "", label: "请选择角色" },
                  ...props.roles.map((role) => ({
                    value: role.uuid,
                    label: role.name,
                    description: role.description,
                  })),
                ]}
                value={draft.roleUuid}
                onValueChange={(roleUuid) => setDraft((current) => ({ ...current, roleUuid }))}
              />
            </div>
            <label className="field-span-full">
              头像
              <Input accept="image/*" type="file" onChange={handleAvatarChange} />
            </label>
            <div className="avatar-editor field-span-full">
              <AvatarPreview label={draft.username} value={draft.avatar} />
              <div className="avatar-editor-copy">
                <span>{avatarLoading ? "正在读取当前头像..." : "选择图片后可在保存前预览"}</span>
                {draft.avatar ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setDraft((current) => ({ ...current, avatar: "", avatarChanged: true }))
                    }
                  >
                    清除头像
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <div className="dialog-footer">
            <Button disabled={props.loading} type="button" variant="outline" onClick={closeEditor}>
              取消
            </Button>
            <Button busy={props.loading} disabled={creating && !draft.roleUuid} type="submit">
              {props.loading ? "保存中..." : creating ? "创建用户" : "保存用户"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
