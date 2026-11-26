import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SetupStatus } from "../lib/api";
import {
  forgetStartup,
  hasPlayedStartup,
  readStartupOverride,
  readStartupSnapshot,
  rememberStartup,
} from "../lib/startup-session";

export type StartupPhase = "connecting" | "calibrating" | "loading" | "ready";

function subscribeToMotion(callback: () => void): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function removeStartupOverride(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("startup");
  window.history.replaceState(window.history.state, "", url);
}

export function useStartupSequence(status: SetupStatus | null, checking: boolean) {
  const [snapshot] = useState(readStartupSnapshot);
  const [policy] = useState(() => ({
    mode: readStartupOverride(window.location.search),
    played: hasPlayedStartup(),
  }));
  const [completed, setCompleted] = useState(
    policy.mode === "skip" || (policy.mode === "auto" && policy.played),
  );
  const [released, setReleased] = useState(false);
  const [phase, setPhase] = useState<StartupPhase>("connecting");
  const currentStatus = useRef(status);
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  useEffect(() => {
    currentStatus.current = status;
  }, [status]);

  useEffect(() => {
    if (policy.mode !== "reset") return;
    forgetStartup();
    // A reset applies once; preserve all other route parameters and history state.
    removeStartupOverride();
  }, [policy.mode]);

  const complete = useCallback(() => {
    const latest = currentStatus.current;
    if (!latest) return;
    rememberStartup(latest);
    setPhase("ready");
    setCompleted(true);
  }, []);
  const hasStatus = Boolean(status);
  useEffect(() => {
    if (checking || !hasStatus || completed) return;
    if (reducedMotion) {
      complete();
      return;
    }
    setPhase("calibrating");
    const loading = window.setTimeout(() => setPhase("loading"), 1300);
    const ready = window.setTimeout(() => setPhase("ready"), 2600);
    const finish = window.setTimeout(complete, 3400);
    return () => {
      window.clearTimeout(loading);
      window.clearTimeout(ready);
      window.clearTimeout(finish);
    };
  }, [hasStatus, checking, completed, reducedMotion, complete]);
  // Cached public flags only choose the provisional entry screen; the cookie controls playback.
  useEffect(() => {
    if (!checking && status && completed) rememberStartup(status);
  }, [checking, status, completed]);
  const holdMode = policy.mode === "hold";
  const held = holdMode && completed && !released;
  return {
    showStartup: !completed || held,
    holdMode,
    held,
    phase: checking ? ("connecting" as const) : phase,
    cachedStatus: snapshot,
    skip: () => {
      if (!checking) complete();
    },
    replay: () => {
      if (!held || checking) return;
      setPhase("calibrating");
      setCompleted(false);
    },
    proceed: () => {
      if (!held) return;
      removeStartupOverride();
      setReleased(true);
    },
  };
}
