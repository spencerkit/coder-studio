import { useSyncExternalStore } from "react";

export type Viewport = "mobile" | "desktop";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const mediaQueryList = window.matchMedia(VIEWPORT_QUERY);
  const supportsEventListener = typeof mediaQueryList.addEventListener === "function";

  if (supportsEventListener) {
    mediaQueryList.addEventListener("change", onStoreChange);
    return () => {
      mediaQueryList.removeEventListener("change", onStoreChange);
    };
  }

  mediaQueryList.addListener(onStoreChange);
  return () => {
    mediaQueryList.removeListener(onStoreChange);
  };
};

const getSnapshot = (): Viewport => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }

  return window.matchMedia(VIEWPORT_QUERY).matches ? "mobile" : "desktop";
};

const getServerSnapshot = (): Viewport => "desktop";

export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
