import { useEffect, useState } from "react";
import {
  ApiError,
  checkSetupDatabase,
  fetchSetupStatus,
  initializeSetup,
  SetupPayload,
  SetupStatus,
} from "../lib/api";
import { resolveErrorMessage } from "../lib/format";
import { rememberSetupLoginEmail } from "../lib/setup-session";
import { readStartupOverride } from "../lib/startup-session";
import { useFeedback } from "./useFeedback";

type Feedback = Pick<ReturnType<typeof useFeedback>, "setLoading" | "setNotice" | "withFeedback">;

/** 安装状态与登录状态独立：保存成功后，要等新进程提供业务接口才能跳转。 */
export function useSetup(clearSession: () => void, feedback: Feedback) {
  const { setLoading, setNotice, withFeedback } = feedback;
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [checkVersion, setCheckVersion] = useState(0);
  useEffect(() => {
    let active = true;

    async function checkSetup() {
      setChecking(true);
      setConnectionError("");
      try {
        const status = await fetchSetupStatus();
        if (!active) return;
        setSetupStatus(status);
        if (status.needsSetup) {
          clearSession();
        }
      } catch (error) {
        if (!active) return;
        setNotice({
          tone: "error",
          text: resolveErrorMessage(error),
        });
        setConnectionError(resolveErrorMessage(error));
      } finally {
        if (active) setChecking(false);
      }
    }

    void checkSetup();

    return () => {
      active = false;
    };
  }, [clearSession, setNotice, checkVersion]);

  useEffect(() => {
    const waitingForRestart =
      setupComplete || setupStatus?.requiresRestart === true || setupStatus?.initializing === true;
    if (!waitingForRestart) return;

    let active = true;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      try {
        const status = await fetchSetupStatus();
        if (!active) return;
        setSetupStatus(status);
        if (!status.needsSetup && !status.requiresRestart && !status.initializing) {
          // Keep annotation previews in place until the user explicitly continues.
          if (readStartupOverride(window.location.search) !== "hold") {
            window.location.replace("/login");
          }
          return;
        }
      } catch {
        // The API can be briefly unavailable while the server process reloads.
      }

      if (attempts === 20 && active) {
        setNotice({
          tone: "error",
          text: "服务重新加载超时，仍在自动重试。请检查后端日志。",
        });
      }
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [setNotice, setupComplete, setupStatus?.initializing, setupStatus?.requiresRestart]);

  async function handleSetupSave(payload: SetupPayload) {
    setLoading(true);
    setNotice(null);
    try {
      await initializeSetup(payload);
      rememberSetupLoginEmail(payload.initialUser.email.trim().toLowerCase());
      setSetupComplete(true);
      setNotice({
        tone: "success",
        text: "配置已保存，正在等待服务重启。",
      });

      try {
        setSetupStatus(await fetchSetupStatus());
      } catch {
        // The service may restart immediately after accepting the setup request.
      }
    } catch (error) {
      setNotice({ tone: "error", text: resolveErrorMessage(error) });
      // Reconcile a failed request with the server without clearing the wizard draft.
      try {
        const status = await fetchSetupStatus();
        setSetupStatus(status);
        setSetupComplete(false);
      } catch {
        // Preserve both the original error and the entered form if status is unavailable.
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function handleSetupDatabaseCheck(payload: SetupPayload) {
    await withFeedback(async () => {
      const result = await checkSetupDatabase(payload);
      if (!result.connected || result.error) {
        throw new ApiError(result.error || "数据库连接失败，请检查连接配置。", 400);
      }
      return result;
    }, "数据库连接测试通过。");
  }

  return {
    checking,
    connectionError,
    retryConnection: () => setCheckVersion((version) => version + 1),
    setupStatus,
    setupComplete,
    save: handleSetupSave,
    checkDatabase: handleSetupDatabaseCheck,
  };
}
