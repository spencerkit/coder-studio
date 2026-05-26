import { useSyncExternalStore } from "react";

const POINTER_QUERY = "(pointer: coarse)";

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const mediaQueryList = window.matchMedia(POINTER_QUERY);
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

const getSnapshot = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return !window.matchMedia(POINTER_QUERY).matches;
};

const getServerSnapshot = () => true;

export function usePaneDragEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
