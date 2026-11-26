import type { LetterDraft } from "../types";

const prefix = "after-life-letter-draft-v1:";
const maxAge = 7 * 86400_000;

export interface SavedLetterDraft {
  editingUuid: string | null;
  draft: LetterDraft;
  savedAt: number;
}

/** 每位所有者只保留一份恢复草稿；退出登录时统一清除。
 * Keep one recovery draft per owner and remove private drafts on logout. */
export function readLetterDraft(ownerUuid: string): SavedLetterDraft | null {
  try {
    const saved: SavedLetterDraft | null = JSON.parse(
      localStorage.getItem(prefix + ownerUuid) || "null",
    );
    if (!saved) return null;
    const draft = saved.draft;
    if (
      !Number.isFinite(saved.savedAt) ||
      Date.now() - saved.savedAt > maxAge ||
      (saved.editingUuid !== null && typeof saved.editingUuid !== "string") ||
      !draft ||
      typeof draft.title !== "string" ||
      typeof draft.content !== "string" ||
      draft.contentFormat !== "html" ||
      typeof draft.deliveryEnabled !== "boolean" ||
      typeof draft.inactiveAfterMinutes !== "string" ||
      (draft.expectedUpdatedAt !== undefined && typeof draft.expectedUpdatedAt !== "string") ||
      !Array.isArray(draft.contactUuids) ||
      !draft.contactUuids.every((uuid) => typeof uuid === "string")
    ) {
      removeLetterDraft(ownerUuid);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function writeLetterDraft(ownerUuid: string, saved: SavedLetterDraft): boolean {
  try {
    localStorage.setItem(prefix + ownerUuid, JSON.stringify(saved));
    return true;
  } catch {
    return false;
  }
}

export function removeLetterDraft(ownerUuid: string): void {
  try {
    localStorage.removeItem(prefix + ownerUuid);
  } catch {
    // 存储被禁用时仍允许手动提交。 / Manual saving remains available without browser storage.
  }
}

export function clearLetterDrafts(): void {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => localStorage.removeItem(key));
  } catch {
    // 清理失败不应阻止退出登录。 / Storage failures must not prevent logout.
  }
}
