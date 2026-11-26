import type { SetupStatus } from "./api-types";

export const STARTUP_STORAGE_KEY = "after-life-startup-v1";
export const STARTUP_COOKIE_NAME = "after-life-startup";
export type StartupOverride = "auto" | "play" | "skip" | "reset" | "hold";
export type StartupSnapshot = Pick<SetupStatus, "needsSetup" | "requiresRestart" | "initializing">;

export function readStartupOverride(search: string): StartupOverride {
  const mode = new URLSearchParams(search).get("startup");
  return mode === "play" || mode === "skip" || mode === "reset" || mode === "hold" ? mode : "auto";
}

export function hasPlayedStartup(): boolean {
  try {
    return document.cookie
      .split(";")
      .some((cookie) => cookie.trim() === `${STARTUP_COOKIE_NAME}=1`);
  } catch {
    return false;
  }
}

function writeStartupCookie(maxAge: number): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  try {
    document.cookie = `${STARTUP_COOKIE_NAME}=1; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    /* Restricted cookies fall back to this page session. */
  }
}

export function forgetStartup(): void {
  writeStartupCookie(0);
}

export function readStartupSnapshot(): StartupSnapshot | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(STARTUP_STORAGE_KEY) || "null");
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      ["needsSetup", "requiresRestart", "initializing"].some(
        (key) => typeof candidate[key] !== "boolean",
      )
    )
      return null;
    return {
      needsSetup: candidate.needsSetup as boolean,
      requiresRestart: candidate.requiresRestart as boolean,
      initializing: candidate.initializing as boolean,
    };
  } catch {
    return null;
  }
}

export function rememberStartup(status: SetupStatus): void {
  writeStartupCookie(365 * 24 * 60 * 60);
  // Only public lifecycle metadata is cached; installation tokens and values stay in memory.
  const snapshot: StartupSnapshot = {
    needsSetup: status.needsSetup,
    requiresRestart: status.requiresRestart,
    initializing: status.initializing,
  };
  try {
    window.localStorage.setItem(STARTUP_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Restricted storage falls back to this page session. */
  }
}
