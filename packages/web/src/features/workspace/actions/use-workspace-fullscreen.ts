import { type RefObject, useCallback, useEffect, useState } from "react";

export interface WorkspaceFullscreenController {
  supported: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

function canEnterFullscreen(
  target: HTMLElement | null
): target is HTMLElement & { requestFullscreen: NonNullable<HTMLElement["requestFullscreen"]> } {
  return Boolean(
    document.fullscreenEnabled &&
      target &&
      typeof target.requestFullscreen === "function" &&
      typeof document.exitFullscreen === "function"
  );
}

export function useWorkspaceFullscreen(
  targetRef: RefObject<HTMLElement | null>
): WorkspaceFullscreenController {
  const [supported, setSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const syncState = () => {
      const target = targetRef.current;
      setSupported(canEnterFullscreen(target));
      setIsFullscreen(Boolean(target && document.fullscreenElement === target));
    };

    syncState();
    document.addEventListener("fullscreenchange", syncState);

    return () => {
      document.removeEventListener("fullscreenchange", syncState);
    };
  }, [targetRef]);

  const enterFullscreen = useCallback(async () => {
    const target = targetRef.current;
    if (!canEnterFullscreen(target)) {
      return;
    }

    try {
      await target.requestFullscreen();
    } catch (error) {
      console.warn("Failed to enter fullscreen", error);
    }
  }, [targetRef]);

  const exitFullscreen = useCallback(async () => {
    if (typeof document.exitFullscreen !== "function" || !document.fullscreenElement) {
      return;
    }

    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn("Failed to exit fullscreen", error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (targetRef.current && document.fullscreenElement === targetRef.current) {
      await exitFullscreen();
      return;
    }

    await enterFullscreen();
  }, [enterFullscreen, exitFullscreen, targetRef]);

  return {
    supported,
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
