import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ContactRecord, LetterRecord } from "../lib/api";
import type { LetterDraft } from "../types";
import { formatDate } from "../lib/format";
import { useLetterComposer } from "../hooks/useLetterComposer";
import { LetterPreview } from "../components/letters/LetterPreview";
import { LetterComposerDialog } from "../components/letters/LetterComposerDialog";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  PageHeader,
  Panel,
} from "../components/ui";

export function LettersScreen(props: {
  ownerUuid: string;
  letters: LetterRecord[];
  contacts: ContactRecord[];
  loading: boolean;
  onCreate: (payload: LetterDraft) => Promise<void>;
  onUpdate: (uuid: string, payload: LetterDraft) => Promise<void>;
  onRemove: (uuid: string) => Promise<void>;
}) {
  const composer = useLetterComposer(props.ownerUuid);
  const [pendingDelete, setPendingDelete] = useState<LetterRecord | null>(null);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const recoveryAction = useRef<HTMLButtonElement>(null);
  const writeBlocked = props.loading || composer.preparing || Boolean(composer.recovery);
  useEffect(() => {
    if (!composer.recovery || composer.open) return;
    recoveryAction.current?.focus();
  }, [composer.recovery, composer.open]);
  const recoveryLetter = props.letters.find(
    (letter) => letter.uuid === composer.recovery?.editingUuid,
  );
  const staleRecovery = Boolean(
    composer.recovery?.editingUuid &&
      (!recoveryLetter || recoveryLetter.updatedAt !== composer.recovery.draft.expectedUpdatedAt),
  );
  const filteredLetters = props.letters.filter((letter) =>
    letter.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const selected =
    filteredLetters.find((letter) => letter.uuid === selectedUuid) || filteredLetters[0];

  return (
    <>
      <section className="stack">
        <PageHeader
          eyebrow="LETTERS / WORDS THAT STAY"
          title="留一些话，给重要的人。"
          description="编写信件，选择收件人，并按需要设置自动投递。"
          actions={
            <Button disabled={writeBlocked} onClick={() => void composer.begin()}>
              <Plus aria-hidden="true" size={17} />
              写一封信
            </Button>
          }
        />
        {composer.recovery && !composer.open && (
          <Panel className="draft-recovery" aria-label="待恢复的信件草稿">
            <div>
              <strong>有一份尚未提交的草稿</strong>
              <p>
                {composer.recovery.draft.title || "未命名信件"} ·{" "}
                {formatDate(new Date(composer.recovery.savedAt).toISOString())}
              </p>
              <p className="settings-hint">
                {staleRecovery
                  ? "原信件已变化或被删除。可以作为新信恢复，自动投递默认关闭，私有附件需重新上传。"
                  : "保存在此浏览器，尚未更新正式信件或投递设置。请先恢复或丢弃这份草稿。"}
              </p>
            </div>
            <div className="inline-actions">
              <Button
                ref={recoveryAction}
                disabled={composer.preparing}
                onClick={() =>
                  void composer.begin(recoveryLetter, composer.recovery!, staleRecovery)
                }
              >
                {staleRecovery ? "作为新信恢复" : "恢复草稿"}
              </Button>
              <Button variant="outline" onClick={composer.discard}>
                丢弃草稿
              </Button>
            </div>
          </Panel>
        )}
        {props.letters.length ? (
          <div className="letter-workspace">
            <div className="letter-index">
              <div className="letter-index-header">
                <span>我的信件</span>
                <span>
                  {filteredLetters.length} / {props.letters.length}
                </span>
              </div>
              <div className="letter-search">
                <Input
                  type="search"
                  aria-label="搜索信件"
                  placeholder="搜索信件标题"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {filteredLetters.map((letter, index) => (
                <button
                  type="button"
                  className="letter-index-item"
                  key={letter.uuid}
                  aria-pressed={selected?.uuid === letter.uuid}
                  onClick={() => setSelectedUuid(letter.uuid)}
                >
                  <span>LETTER / {String(index + 1).padStart(2, "0")}</span>
                  <strong>{letter.title}</strong>
                  <span className="letter-index-meta">
                    <span>{formatDate(letter.updatedAt || letter.createdAt)}</span>
                    <Badge variant={letter.deliveryEnabled ? "default" : "secondary"}>
                      {letter.deliveryEnabled ? "已启用" : "草稿"}
                    </Badge>
                  </span>
                </button>
              ))}
              {!filteredLetters.length && (
                <EmptyState title="没有匹配的信件" description="换一个标题关键词试试。" />
              )}
            </div>
            {selected ? (
              <article className="letter-preview" aria-label="信件预览">
                <div className="letter-preview-head">
                  <span>
                    TO /{" "}
                    {selected.contacts?.map((contact) => contact.name).join("、") || "未指定联系人"}
                  </span>
                  <Badge variant={selected.deliveryEnabled ? "default" : "secondary"}>
                    {selected.deliveryEnabled ? "自动投递已开启" : "发送未启用"}
                  </Badge>
                </div>
                <h3>{selected.title}</h3>
                <LetterPreview content={selected.content} contentFormat={selected.contentFormat} />
                <div className="letter-preview-contacts">
                  {selected.contacts?.map((contact) => (
                    <Badge key={contact.uuid} variant="outline">
                      {contact.name}
                    </Badge>
                  ))}
                </div>
                <div className="letter-preview-footer">
                  <span className="muted">
                    {selected.deliveryEnabled && selected.inactiveAfterMinutes
                      ? `${selected.inactiveAfterMinutes} 分钟未活跃后触发`
                      : "不会自动发送"}
                    {selected.lastTriggeredAt
                      ? ` · 上次触发 ${formatDate(selected.lastTriggeredAt)}`
                      : ""}
                  </span>
                  <div className="ui-panel-actions">
                    <Button
                      disabled={writeBlocked}
                      variant="outline"
                      onClick={() => void composer.begin(selected)}
                    >
                      <Pencil aria-hidden="true" size={16} />
                      继续写
                    </Button>
                    <Button
                      disabled={props.loading}
                      variant="destructive"
                      aria-label={`删除信件 ${selected.title}`}
                      onClick={() => setPendingDelete(selected)}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      删除
                    </Button>
                  </div>
                </div>
              </article>
            ) : (
              <div className="letter-preview">
                <EmptyState
                  title="选择一封信"
                  description="从左侧索引选择信件，或修改搜索关键词。"
                />
              </div>
            )}
          </div>
        ) : (
          <Panel>
            <EmptyState
              title="还没有信件"
              description="从一句想说的话开始。创建的信件默认不会自动发送。"
              icon={<Plus />}
              action={
                <Button disabled={writeBlocked} onClick={() => void composer.begin()}>
                  写第一封信
                </Button>
              }
            />
          </Panel>
        )}
      </section>

      {composer.open && (
        <LetterComposerDialog
          composer={composer}
          contacts={props.contacts}
          loading={props.loading}
          liveDeliveryEnabled={Boolean(
            props.letters.find((letter) => letter.uuid === composer.editingUuid)?.deliveryEnabled,
          )}
          onCreate={props.onCreate}
          onUpdate={props.onUpdate}
        />
      )}

      <ConfirmDialog
        description={
          pendingDelete
            ? `删除“${pendingDelete.title}”后将无法恢复，请确认是否继续。`
            : "删除后将无法恢复。"
        }
        loading={props.loading}
        open={Boolean(pendingDelete)}
        title="删除信件？"
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
