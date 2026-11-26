import { type FormEvent, useEffect, useRef, useState } from "react";
import { previewLetterDelivery, type ContactRecord, type DeliveryReview } from "../../lib/api";
import { storedLetterHtml } from "../../lib/letter-content";
import { resolveErrorMessage } from "../../lib/format";
import type { LetterDraft } from "../../types";
import type { LetterComposer } from "../../hooks/useLetterComposer";
import { Button, Dialog, Input, MultiSelect } from "../ui";
import { RichTextEditor } from "./RichTextEditor";
import { LetterPreview } from "./LetterPreview";
import { DeliveryReviewDialog } from "./DeliveryReviewDialog";

/** 写作、预览、核对与保存集中在同一编辑会话中。
 * Keep writing, previewing, reviewing and saving within one editing session. */
export function LetterComposerDialog(props: {
  composer: LetterComposer;
  contacts: ContactRecord[];
  loading: boolean;
  liveDeliveryEnabled: boolean;
  onCreate: (payload: LetterDraft) => Promise<void>;
  onUpdate: (uuid: string, payload: LetterDraft) => Promise<void>;
}) {
  const { composer } = props;
  const { draft, editingUuid, open: editorOpen, change: setDraft } = composer;
  const [resourceUploading, setResourceUploading] = useState(false);
  const [closeRequested, setCloseRequested] = useState(false);
  const [review, setReview] = useState<DeliveryReview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const busy = props.loading || resourceUploading || reviewing || saving;
  useEffect(() => () => request.current?.abort(), []);

  function closeEditor() {
    if (busy) return;
    if (composer.dirty) setCloseRequested(true);
    else composer.close();
  }

  function payload(): LetterDraft {
    return {
      ...draft,
      content: storedLetterHtml(draft.content),
      inactiveAfterMinutes: draft.deliveryEnabled ? draft.inactiveAfterMinutes : "",
    };
  }

  async function save(deliveryPreviewToken?: string) {
    if (busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    setSaving(true);
    try {
      const next = { ...payload(), deliveryPreviewToken };
      if (editingUuid) await props.onUpdate(editingUuid, next);
      else await props.onCreate(next);
      if (controller.signal.aborted) return;
      composer.discard();
    } catch {
      // 失败时保留输入，由共享提示显示服务端错误；旧会话不能清除新草稿。
      // Preserve failed input and never clear a newer session's draft after an old response.
      if (!controller.signal.aborted) setReview(null);
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!draft.deliveryEnabled) {
      await save();
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setReviewing(true);
    setError("");
    try {
      const next = await previewLetterDelivery(
        { ...payload(), letterUuid: editingUuid ?? undefined },
        controller.signal,
      );
      if (!controller.signal.aborted) setReview(next);
    } catch (cause) {
      if (!controller.signal.aborted) setError(resolveErrorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setReviewing(false);
    }
  }

  return (
    <>
      <Dialog
        className="letter-composer-dialog"
        closeDisabled={busy}
        description={
          editingUuid ? "修改信件内容与自动投递设置。" : "创建一封新的信件并设置投递方式。"
        }
        open={editorOpen}
        title={editingUuid ? "编辑信件" : "新建信件"}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <form className="dialog-form" onSubmit={submit}>
          <div className="dialog-body modal-form-grid">
            <div className="field-span-full draft-status" role="status">
              {composer.dirty
                ? composer.protectedDraft
                  ? "草稿已保存在此浏览器，尚未提交。"
                  : "浏览器无法保存恢复草稿，请及时手动保存；关闭页面可能丢失内容。"
                : "修改会自动保存在此浏览器，正式保存后才更新信件。"}
              <small>仅此浏览器可恢复，7 天内有效；明确退出登录会清除草稿。</small>
              {/\/resource\/[0-9a-f-]{36}/i.test(draft.content) && (
                <small>未正式保存的上传附件可能在 24 小时后清理。</small>
              )}
              {props.liveDeliveryEnabled && (
                <small>这封信已启用自动投递，编辑草稿不会暂停正式投递。</small>
              )}
            </div>
            {composer.resourceWarning && (
              <p className="notice notice-error field-span-full" role="alert">
                {composer.resourceWarning}
              </p>
            )}
            {error && (
              <p className="notice notice-error field-span-full" role="alert">
                {error}
              </p>
            )}
            <label className="field-span-full">
              标题
              <Input
                disabled={busy}
                autoComplete="off"
                placeholder="写一个醒目的标题"
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <div className="form-field field-span-full">
              <span className="form-field-label">信件内容</span>
              <RichTextEditor
                disabled={busy}
                value={draft.content}
                onChange={(content) => setDraft({ ...draft, content })}
                onBusyChange={setResourceUploading}
              />
            </div>
            <div className="toggle-row field-span-full">
              <Input
                disabled={busy}
                checked={draft.deliveryEnabled}
                id="letter-delivery-enabled"
                type="checkbox"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    deliveryEnabled: event.target.checked,
                  })
                }
              />
              <label htmlFor="letter-delivery-enabled">开启离线自动投递</label>
            </div>
            <label>
              离线触发时间（分钟）
              <Input
                disabled={busy || !draft.deliveryEnabled}
                min="1"
                placeholder="例如 1440"
                required={draft.deliveryEnabled}
                type="number"
                value={draft.inactiveAfterMinutes}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    inactiveAfterMinutes: event.target.value,
                  })
                }
              />
            </label>
            <div className="form-field">
              <span className="form-field-label">投递联系人</span>
              <MultiSelect
                disabled={busy}
                ariaLabel="投递联系人"
                emptyText="还没有联系人，请先在联系人页面创建。"
                options={props.contacts.map((contact) => ({
                  value: contact.uuid,
                  label: contact.name,
                  description: contact.email || undefined,
                }))}
                placeholder="选择投递联系人"
                value={draft.contactUuids}
                onValueChange={(contactUuids) => setDraft({ ...draft, contactUuids })}
              />
            </div>
          </div>
          <div className="dialog-footer">
            <Button variant="ghost" disabled={busy} onClick={() => setPreviewOpen(true)}>
              预览正文
            </Button>
            <Button disabled={busy} type="button" variant="outline" onClick={closeEditor}>
              取消
            </Button>
            <Button busy={busy} type="submit">
              {resourceUploading
                ? "上传中..."
                : reviewing
                  ? "生成摘要..."
                  : saving || props.loading
                    ? "提交中..."
                    : draft.deliveryEnabled
                      ? "核对投递并保存"
                      : editingUuid
                        ? "保存修改"
                        : "创建信件"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={previewOpen}
        title="信件完整预览"
        className="letter-composer-dialog"
        onOpenChange={setPreviewOpen}
      >
        <div className="dialog-body">
          <h4 className="letter-preview-title">{draft.title || "未命名信件"}</h4>
          <LetterPreview content={draft.content} />
        </div>
        <div className="dialog-footer">
          <Button onClick={() => setPreviewOpen(false)}>返回编辑</Button>
        </div>
      </Dialog>
      {review && (
        <DeliveryReviewDialog
          review={review}
          busy={busy}
          onClose={() => setReview(null)}
          onConfirm={() => void save(review.token ?? undefined)}
        />
      )}
      <Dialog
        open={closeRequested}
        title="保留尚未提交的修改？"
        className="dialog-surface-sm"
        onOpenChange={setCloseRequested}
        description={
          composer.protectedDraft
            ? "你可以保留浏览器草稿，稍后继续写；正式信件和投递设置尚未改变。"
            : "浏览器无法保留恢复草稿。请返回编辑并手动保存，或确认放弃修改。"
        }
      >
        <div className="dialog-footer draft-close-actions">
          <Button variant="outline" onClick={() => setCloseRequested(false)}>
            继续写
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setCloseRequested(false);
              composer.discard();
            }}
          >
            放弃修改
          </Button>
          {composer.protectedDraft && (
            <Button
              onClick={() => {
                setCloseRequested(false);
                composer.close();
              }}
            >
              保留草稿并关闭
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
