import { Table } from "../components/ui";
import { FormEvent, useState } from "react";
import { Pencil } from "lucide-react";
import { PermissionRecord, RoleRecord } from "../lib/api";
import { Button } from "../components/ui/button";
import { Dialog } from "../components/ui/dialog";
import { MultiSelect } from "../components/ui/select";

export function RolesScreen(props: {
  roles: RoleRecord[];
  permissions: PermissionRecord[];
  loading: boolean;
  onSave: (roleUuid: string, permissionUuids: string[]) => Promise<void>;
}) {
  const [editingRoleUuid, setEditingRoleUuid] = useState<string | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const editingRole = props.roles.find((role) => role.uuid === editingRoleUuid) || null;

  function beginEdit(role: RoleRecord) {
    setEditingRoleUuid(role.uuid);
    setSelectedPermissions(role.permissions.map((permission) => permission.uuid));
  }

  function closeEditor() {
    if (props.loading) return;
    setEditingRoleUuid(null);
    setSelectedPermissions([]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRoleUuid) return;
    try {
      await props.onSave(editingRoleUuid, selectedPermissions);
      closeEditor();
    } catch {
      // App-level feedback remains visible while the editor stays open for correction.
    }
  }

  return (
    <>
      <section className="panel management-panel">
        <div className="panel-head management-head">
          <div>
            <h3>角色权限列表</h3>
            <p>查看系统角色，并从对应角色行进入权限配置。</p>
          </div>
          <span className="record-count">共 {props.roles.length} 个角色</span>
        </div>

        <div className="management-table-wrap">
          <Table scrollLabel="角色权限列表" className="management-table roles-table">
            <thead>
              <tr>
                <th>角色</th>
                <th>说明</th>
                <th>权限集合</th>
                <th className="table-actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.roles.map((role) => (
                <tr key={role.uuid}>
                  <td>
                    <strong className="table-primary">{role.name}</strong>
                    <span className="table-secondary">{role.permissions.length} 项权限</span>
                  </td>
                  <td>
                    <span className="table-secondary">{role.description || "暂无说明"}</span>
                  </td>
                  <td>
                    {role.permissions.length ? (
                      <div className="chip-row table-chip-row">
                        {role.permissions.map((permission) => (
                          <span className="chip" key={permission.uuid}>
                            {permission.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="table-secondary">暂未授予权限</span>
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => beginEdit(role)}
                      >
                        <Pencil aria-hidden="true" size={15} />
                        编辑权限
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {props.roles.length === 0 ? (
            <div className="management-empty">
              <strong>暂无角色</strong>
              <span>系统中还没有可配置的角色。</span>
            </div>
          ) : null}
        </div>
      </section>

      <Dialog
        closeDisabled={props.loading}
        description="勾选该角色可以访问的功能权限。"
        open={Boolean(editingRole)}
        title={editingRole ? `编辑“${editingRole.name}”权限` : "编辑角色权限"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <form className="dialog-form" onSubmit={submit}>
          <div className="dialog-body form-panel">
            {editingRole ? (
              <div className="role-editor-summary">
                <strong>{editingRole.name}</strong>
                <span>{editingRole.description || "暂无角色说明"}</span>
              </div>
            ) : null}
            <div className="form-field">
              <span className="form-field-label">权限集合</span>
              <MultiSelect
                ariaLabel="权限集合"
                emptyText="系统中还没有可分配的权限。"
                options={props.permissions.map((permission) => ({
                  value: permission.uuid,
                  label: permission.name,
                  description: permission.description,
                }))}
                placeholder="选择权限"
                value={selectedPermissions}
                onValueChange={setSelectedPermissions}
              />
            </div>
            <p className="dialog-hint">已选择 {selectedPermissions.length} 项权限</p>
          </div>
          <div className="dialog-footer">
            <Button disabled={props.loading} type="button" variant="outline" onClick={closeEditor}>
              取消
            </Button>
            <Button busy={props.loading} disabled={!editingRoleUuid} type="submit">
              {props.loading ? "保存中..." : "保存权限"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
