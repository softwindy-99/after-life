import { SETUP_LOGIN_EMAIL_STORAGE_KEY } from "./api";

export function readSetupLoginEmail() {
  try {
    return window.sessionStorage.getItem(SETUP_LOGIN_EMAIL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function rememberSetupLoginEmail(email: string) {
  try {
    window.sessionStorage.setItem(SETUP_LOGIN_EMAIL_STORAGE_KEY, email);
  } catch {
    // The setup succeeds even when the browser blocks session storage.
  }
}

export function forgetSetupLoginEmail() {
  try {
    window.sessionStorage.removeItem(SETUP_LOGIN_EMAIL_STORAGE_KEY);
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
}
