import { useRegisterSW } from "virtual:pwa-register/react";

export function usePushServiceWorker(): void {
  useRegisterSW({ immediate: true });
}
