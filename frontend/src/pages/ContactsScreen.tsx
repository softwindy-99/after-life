import { Table, Input, Textarea } from "../components/ui";
import { FormEvent, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ContactRecord, LetterRecord } from "../lib/api";
import { Button } from "../components/ui/button";
import { ConfirmDialog, Dialog } from "../components/ui/dialog";
import { MultiSelect } from "../components/ui/select";
import { formatDate } from "../lib/format";
import { ContactDraft, emptyContact } from "../types";

export function ContactsScreen(props: {
  contacts: ContactRecord[];
  letters: LetterRecord[];
  loading: boolean;
  onCreate: (payload: ContactDraft) => Promise<void>;
  onUpdate: (uuid: string, payload: ContactDraft) => Promise<void>;
  onRemove: (uuid: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ContactDraft>(emptyContact);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ContactRecord | null>(null);

  function beginCreate() {
    setEditingUuid(null);
    setDraft(emptyContact);
    setEditorOpen(true);
  }

  function beginEdit(contact: ContactRecord) {
    setEditingUuid(contact.uuid);
    setDraft({
      expectedUpdatedAt: contact.updatedAt,
      name: contact.name,
      email: contact.email || "",
      phone: contact.phone || "",
      note: contact.note || "",
      letterUuids: contact.letters?.map((item) => item.uuid) || [],
    });
    setEditorOpen(true);
  }

  function closeEditor() {
    if (props.loading) return;
    setEditorOpen(false);
    setEditingUuid(null);
    setDraft(emptyContact);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (editingUuid) {
        await props.onUpdate(editingUuid, draft);
      } else {
        await props.onCreate(draft);
      }
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
            <h3>联系人列表</h3>
            <p>集中管理联系方式、备注与关联信件。</p>
          </div>
          <div className="management-actions">
            <span className="record-count">共 {props.contacts.length} 位</span>
            <Button type="button" onClick={beginCreate}>
              <Plus aria-hidden="true" size={17} />
              新建联系人
            </Button>
          </div>
        </div>

        <div className="management-table-wrap">
          <Table scrollLabel="联系人列表" className="management-table contacts-table">
            <thead>
              <tr>
                <th>联系人</th>
                <th>联系方式</th>
                <th>关联信件</th>
                <th>更新时间</th>
                <th className="table-actions-heading">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.contacts.map((contact) => (
                <tr key={contact.uuid}>
                  <td>
                    <strong className="table-primary">{contact.name}</strong>
                    <span className="table-secondary table-clamp">
                      {contact.note || "暂无备注"}
                    </span>
                  </td>
                  <td>
                    {contact.email ? <span className="table-primary">{contact.email}</span> : null}
                    {contact.phone ? (
                      <span className="table-secondary">{contact.phone}</span>
                    ) : null}
                    {!contact.email && !contact.phone ? (
                      <span className="table-secondary">暂无联系信息</span>
                    ) : null}
                  </td>
                  <td>
                    {(contact.letters || []).length ? (
                      <div className="chip-row table-chip-row">
                        {(contact.letters || []).map((letter) => (
                          <span className="chip" key={letter.uuid}>
                            {letter.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="table-secondary">暂未关联</span>
                    )}
                  </td>
                  <td>
                    <span className="table-nowrap">
                      {formatDate(contact.updatedAt || contact.createdAt)}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => beginEdit(contact)}
                      >
                        <Pencil aria-hidden="true" size={15} />
                        编辑
                      </Button>
                      <Button
                        aria-label={`删除联系人 ${contact.name}`}
                        size="sm"
                        type="button"
                        variant="destructive"
                        onClick={() => setPendingDelete(contact)}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {props.contacts.length === 0 ? (
            <div className="management-empty">
              <strong>还没有联系人</strong>
              <span>点击右上角“新建联系人”，建立第一条关系记录。</span>
            </div>
          ) : null}
        </div>
      </section>

      <Dialog
        closeDisabled={props.loading}
        description={editingUuid ? "更新联系方式、备注与关联信件。" : "添加新的投递联系人。"}
        open={editorOpen}
        title={editingUuid ? "编辑联系人" : "新建联系人"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <form className="dialog-form" onSubmit={submit}>
          <div className="dialog-body modal-form-grid">
            <label className="field-span-full">
              姓名
              <Input
                autoComplete="name"
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              邮箱
              <Input
                autoComplete="email"
                type="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label>
              电话
              <Input
                autoComplete="tel"
                value={draft.phone}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label className="field-span-full">
              备注
              <Textarea
                rows={5}
                value={draft.note}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, note: event.target.value }))
                }
              />
            </label>
            <div className="form-field field-span-full">
              <span className="form-field-label">关联信件</span>
              <MultiSelect
                ariaLabel="关联信件"
                emptyText="还没有可关联的信件。"
                options={props.letters.map((letter) => ({
                  value: letter.uuid,
                  label: letter.title,
                }))}
                placeholder="选择关联信件"
                value={draft.letterUuids}
                onValueChange={(letterUuids) =>
                  setDraft((current) => ({ ...current, letterUuids }))
                }
              />
            </div>
          </div>
          <div className="dialog-footer">
            <Button disabled={props.loading} type="button" variant="outline" onClick={closeEditor}>
              取消
            </Button>
            <Button busy={props.loading} type="submit">
              {props.loading ? "提交中..." : editingUuid ? "保存修改" : "创建联系人"}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        description={
          pendingDelete
            ? `删除联系人“${pendingDelete.name}”后将解除其信件关联，且无法恢复。`
            : "删除后将无法恢复。"
        }
        loading={props.loading}
        open={Boolean(pendingDelete)}
        title="删除联系人？"
        onOpenChange={(open) => {
          if (!open && !props.loading) setPendingDelete(null);
        }}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await props.onRemove(pendingDelete.uuid);
            setPendingDelete(null);
          } catch {
            // App-level feedback reports the failure and keeps the confirmation open.
          }
        }}
      />
    </>
  );
}
