import { useEffect, useState } from "react";

export type Viewport = "mobile" | "desktop";

const WIDTH_QUERY = "(max-width: 899px)";

function computeViewport(): Viewport {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }

  return window.matchMedia(WIDTH_QUERY).matches ? "mobile" : "desktop";
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(computeViewport);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const widthList = window.matchMedia(WIDTH_QUERY);
    const handleChange = () => {
      setViewport(computeViewport());
    };

    widthList.addEventListener("change", handleChange);
    handleChange();

    return () => {
      widthList.removeEventListener("change", handleChange);
    };
  }, []);

  return viewport;
}
