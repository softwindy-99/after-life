import { useEffect, useRef, useState } from "react";
import { TOKEN_STORAGE_KEY, type LetterRecord } from "../lib/api";
import {
  readLetterDraft,
  removeLetterDraft,
  writeLetterDraft,
  type SavedLetterDraft,
} from "../lib/letter-drafts";
import {
  letterHtml,
  resolveLetterHtml,
  storedLetterHtml,
  withoutPrivateAttachments,
} from "../lib/letter-content";
import { emptyLetter, type LetterDraft } from "../types";

function canonicalDraft(draft: LetterDraft): LetterDraft {
  const content = { ...draft, content: storedLetterHtml(draft.content) };
  delete content.deliveryPreviewToken;
  return content;
}

function letterDraft(letter: LetterRecord): LetterDraft {
  return {
    expectedUpdatedAt: letter.updatedAt,
    title: letter.title,
    content: letterHtml(letter.content, letter.contentFormat),
    contentFormat: "html",
    deliveryEnabled: letter.deliveryEnabled,
    inactiveAfterMinutes: letter.inactiveAfterMinutes ? String(letter.inactiveAfterMinutes) : "",
    contactUuids: letter.contacts?.map((contact) => contact.uuid) ?? [],
  };
}

export function useLetterComposer(ownerUuid: string) {
  const [recovery, setRecovery] = useState(() => readLetterDraft(ownerUuid));
  const [draft, setDraft] = useState<LetterDraft>(emptyLetter);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [protectedDraft, setProtectedDraft] = useState(true);
  const [resourceWarning, setResourceWarning] = useState("");
  const initial = useRef("");
  const request = useRef<AbortController | null>(null);
  const sessionKey = useRef(localStorage.getItem(TOKEN_STORAGE_KEY));
  const isCurrentSession = () =>
    sessionKey.current !== null && localStorage.getItem(TOKEN_STORAGE_KEY) === sessionKey.current;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open || !dirty) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty]);

  async function begin(letter?: LetterRecord, saved?: SavedLetterDraft, asNew = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPreparing(true);
    const original = letter ? letterDraft(letter) : emptyLetter;
    const next = { ...(saved?.draft ?? original) };
    if (asNew) {
      delete next.expectedUpdatedAt;
      next.deliveryEnabled = false;
      next.content = withoutPrivateAttachments(next.content);
    }
    try {
      const resolved = await resolveLetterHtml(next.content, "html", controller.signal, true);
      if (controller.signal.aborted || !isCurrentSession()) return;
      initial.current = JSON.stringify(canonicalDraft(asNew ? emptyLetter : original));
      setDraft({ ...next, content: resolved.html });
      setEditingUuid(asNew ? null : saved?.editingUuid ?? letter?.uuid ?? null);
      setResourceWarning(
        asNew
          ? "已作为新信恢复，原信件的私有附件需要重新上传。"
          : resolved.unavailable
            ? "部分附件暂时无法访问；原引用已保留，请刷新或重新上传后保存。"
            : "",
      );
      setDirty(Boolean(saved));
      if (saved) {
        const recoveryDraft = {
          editingUuid: asNew ? null : saved.editingUuid,
          draft: canonicalDraft(next),
          savedAt: Date.now(),
        };
        const protectedNext = writeLetterDraft(ownerUuid, recoveryDraft);
        setProtectedDraft(protectedNext);
        if (protectedNext) setRecovery(recoveryDraft);
      } else setProtectedDraft(true);
      setOpen(true);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      if (!controller.signal.aborted) setPreparing(false);
    }
  }

  function change(next: LetterDraft) {
    if (!isCurrentSession()) return;
    setDraft(next);
    const canonical = canonicalDraft(next);
    const changed = JSON.stringify(canonical) !== initial.current;
    setDirty(changed);
    if (changed) {
      const saved = { editingUuid, draft: canonical, savedAt: Date.now() };
      // 同步保存每次修改，使刷新、路由离开和移动端后台切换都无需等待计时器。
      // Save synchronously so refreshes, navigation and mobile backgrounding need no timer flush.
      const protectedNext = writeLetterDraft(ownerUuid, saved);
      setProtectedDraft(protectedNext);
      if (protectedNext) setRecovery(saved);
    } else {
      removeLetterDraft(ownerUuid);
      setRecovery(null);
    }
  }

  function discard() {
    if (!isCurrentSession()) return;
    removeLetterDraft(ownerUuid);
    setRecovery(null);
    setDirty(false);
    setOpen(false);
  }

  return {
    draft,
    editingUuid,
    open,
    preparing,
    dirty,
    protectedDraft,
    resourceWarning,
    recovery,
    change,
    begin,
    discard,
    close: () => setOpen(false),
  };
}

export type LetterComposer = ReturnType<typeof useLetterComposer>;
