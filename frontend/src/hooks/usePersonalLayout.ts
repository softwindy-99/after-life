import { useSyncExternalStore } from "react";

const query = "(display-mode: standalone), (max-width: 1080px)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return (
    window.matchMedia(query).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePersonalLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
