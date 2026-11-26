import { createContext, useContext } from "react";

// Portals must stay inside a native modal's top layer and inert boundary.
export const OverlayContainerContext = createContext<HTMLElement | undefined>(undefined);
export function useOverlayContainer(): HTMLElement | undefined {
  return useContext(OverlayContainerContext);
}
