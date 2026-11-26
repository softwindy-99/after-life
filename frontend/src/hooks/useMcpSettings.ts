import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMcpGrant,
  fetchMcpApproval,
  fetchMcpSettings,
  resolveMcpApproval,
  revokeMcpGrant,
  updateMcpGrant,
  type McpApprovalReview,
  type McpGrantDraft,
  type McpSettings,
} from "../lib/api";
import { resolveErrorMessage } from "../lib/format";

export function useMcpSettings() {
  const [settings, setSettings] = useState<McpSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<McpApprovalReview | null>(null);
  const [secret, setSecret] = useState("");
  const generation = useRef(0);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const load = useCallback(async (page = 1) => {
    const current = generation.current;
    const id = ++requestId.current;
    const next = await fetchMcpSettings(page);
    if (mounted.current && generation.current === current && id === requestId.current)
      setSettings(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const current = ++generation.current;
    void load().catch((reason) => {
      if (mounted.current && generation.current === current) setError(resolveErrorMessage(reason));
    });
    return () => {
      mounted.current = false;
      generation.current = current + 1;
    };
  }, [load]);
  async function perform(action: () => Promise<unknown>, reload = true) {
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await action();
      if (reload && mounted.current && generation.current === current) {
        try {
          await load(settings?.page ?? 1);
        } catch (reason) {
          if (mounted.current && generation.current === current)
            setError(resolveErrorMessage(reason));
        }
      }
      return mounted.current && generation.current === current;
    } catch (reason) {
      if (mounted.current && generation.current === current) setError(resolveErrorMessage(reason));
      return false;
    } finally {
      if (mounted.current && generation.current === current) setBusy(false);
    }
  }
  async function save(draft: McpGrantDraft, uuid?: string) {
    return perform(async () => {
      if (uuid) await updateMcpGrant(uuid, { name: draft.name, scopes: draft.scopes });
      else {
        const current = generation.current;
        const result = await createMcpGrant(draft);
        if (mounted.current && generation.current === current) setSecret(result.token);
      }
    });
  }
  return {
    settings,
    busy,
    error,
    secret,
    review,
    dismissReview: () => setReview(null),
    reviewApproval: (uuid: string) =>
      perform(async () => {
        const current = generation.current;
        const next = await fetchMcpApproval(uuid);
        if (mounted.current && generation.current === current) setReview(next);
      }, false),
    dismissSecret: () => setSecret(""),
    save,
    refresh: (page = 1) => perform(() => load(page), false),
    revoke: (uuid?: string) => perform(() => revokeMcpGrant(uuid)),
    approve: (uuid: string, approve: boolean) => perform(() => resolveMcpApproval(uuid, approve)),
  };
}
export type McpSettingsState = ReturnType<typeof useMcpSettings>;
