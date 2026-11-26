import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchStorageSettings,
  migrateStorageBatch,
  testStorageSettings,
  updateStorageSettings,
} from "../lib/api";
import type { StorageDraft, StorageStatus } from "../lib/api-types";

export function useStorageSettings() {
  const [settings, setSettings] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const active = useRef(false);
  const running = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = generation.current;
    const next = await fetchStorageSettings();
    if (active.current && generation.current === current) setSettings(next);
  }, []);

  useEffect(() => {
    active.current = true;
    const current = ++generation.current;
    void refresh().catch((reason: unknown) => {
      if (active.current && generation.current === current)
        setError(reason instanceof Error ? reason.message : "读取存储配置失败");
    });
    return () => {
      active.current = false;
      generation.current = current + 1;
    };
  }, [refresh]);

  async function run(work: (isCurrent: () => boolean) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    const current = generation.current;
    const isCurrent = () => active.current && generation.current === current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work(isCurrent);
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message : "存储操作失败");
    } finally {
      running.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  return {
    settings,
    busy,
    message,
    error,
    refresh: () => run(async () => refresh()),
    save: (draft: StorageDraft) =>
      run(async (isCurrent) => {
        const next = await updateStorageSettings(draft);
        if (isCurrent()) {
          setSettings(next);
          setMessage("存储配置已保存，新上传文件将使用此配置。");
        }
      }),
    test: (draft: StorageDraft) =>
      run(async (isCurrent) => {
        await testStorageSettings(draft);
        if (isCurrent()) setMessage("连接测试通过：已完成临时对象的写入、读取校验和删除。");
      }),
    migrate: () =>
      run(async (isCurrent) => {
        let remaining: number;
        let total = 0;
        do {
          const batch = await migrateStorageBatch();
          remaining = batch.remaining;
          total += batch.migrated;
          if (!isCurrent()) return;
          setMessage(`已迁移 ${total} 个文件，剩余 ${remaining} 个。`);
          if (remaining && !batch.migrated) throw new Error("迁移没有进展，请刷新后重试。");
        } while (remaining > 0);
        await refresh();
        if (isCurrent()) setMessage(`迁移完成，共迁移 ${total} 个文件。本地原件已保留。`);
      }),
  };
}
