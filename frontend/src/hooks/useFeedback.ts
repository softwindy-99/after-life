import { useCallback, useRef, useState } from "react";
import { resolveErrorMessage } from "../lib/format";
import { Notice } from "../types";

/** 错误继续抛给表单以保留输入；会话切换后丢弃旧提示。
 * Preserve failed form input and discard feedback from a previous session. */
export function useFeedback() {
  const generation = useRef(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const withFeedback = useCallback(async <T>(action: () => Promise<T>, successText: string) => {
    const current = generation.current;
    setLoading(true);
    setNotice(null);
    try {
      const result = await action();
      if (current === generation.current) setNotice({ tone: "success", text: successText });
      return result;
    } catch (error) {
      if (current === generation.current)
        setNotice({ tone: "error", text: resolveErrorMessage(error) });
      throw error;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const reset = useCallback(() => {
    generation.current++;
    setLoading(false);
    setNotice(null);
  }, []);
  return { loading, setLoading, notice, setNotice, dismissNotice, withFeedback, reset };
}
