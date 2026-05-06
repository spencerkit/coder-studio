import { useEffect, useState } from "react";

export type MobileMotionMode = "default" | "reduced";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function computeMobileMotionMode(): MobileMotionMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "default";
  }

  return window.matchMedia(REDUCED_MOTION_QUERY).matches ? "reduced" : "default";
}

export function useMobileMotionMode(): MobileMotionMode {
  const [mode, setMode] = useState<MobileMotionMode>(computeMobileMotionMode);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handleChange = () => {
      setMode(mediaQuery.matches ? "reduced" : "default");
    };

    mediaQuery.addEventListener("change", handleChange);
    handleChange();

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  return mode;
}
