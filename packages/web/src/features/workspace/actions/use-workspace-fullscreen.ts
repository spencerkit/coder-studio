import { useSetAtom } from "jotai";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../../lib/i18n";
import { pushToastAtom } from "../../notifications/atoms";

export interface WorkspaceFullscreenController {
  supported: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

type FullscreenMethod = () => Promise<void> | void;

type FullscreenDocument = Document & {
  webkitCurrentFullScreenElement?: Element | null;
  webkitExitFullscreen?: FullscreenMethod;
  webkitCancelFullScreen?: FullscreenMethod;
};

type FullscreenTarget = HTMLElement & {
  requestFullscreen?: FullscreenMethod;
  webkitRequestFullscreen?: FullscreenMethod;
  webkitRequestFullScreen?: FullscreenMethod;
};

function getFullscreenElement(doc: Document): Element | null {
  const fullscreenDocument = doc as FullscreenDocument;
  return doc.fullscreenElement ?? fullscreenDocument.webkitCurrentFullScreenElement ?? null;
}

function getRequestFullscreenMethod(target: HTMLElement | null): FullscreenMethod | null {
  if (!target) {
    return null;
  }

  const fullscreenTarget = target as FullscreenTarget;

  if (typeof fullscreenTarget.requestFullscreen === "function") {
    return fullscreenTarget.requestFullscreen.bind(fullscreenTarget);
  }

  if (typeof fullscreenTarget.webkitRequestFullscreen === "function") {
    return fullscreenTarget.webkitRequestFullscreen.bind(fullscreenTarget);
  }

  if (typeof fullscreenTarget.webkitRequestFullScreen === "function") {
    return fullscreenTarget.webkitRequestFullScreen.bind(fullscreenTarget);
  }

  return null;
}

function getExitFullscreenMethod(doc: Document): FullscreenMethod | null {
  const fullscreenDocument = doc as FullscreenDocument;

  if (typeof doc.exitFullscreen === "function") {
    return doc.exitFullscreen.bind(doc);
  }

  if (typeof fullscreenDocument.webkitExitFullscreen === "function") {
    return fullscreenDocument.webkitExitFullscreen.bind(doc);
  }

  if (typeof fullscreenDocument.webkitCancelFullScreen === "function") {
    return fullscreenDocument.webkitCancelFullScreen.bind(doc);
  }

  return null;
}

function canUseFullscreen(target: HTMLElement | null): boolean {
  return Boolean(getRequestFullscreenMethod(target) && getExitFullscreenMethod(document));
}

function getErrorMessage(error: unknown): string | null {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : null;
}

export function useWorkspaceFullscreen(
  targetRef: RefObject<HTMLElement | null>
): WorkspaceFullscreenController {
  const t = useTranslation();
  const pushToast = useSetAtom(pushToastAtom);
  const [supported, setSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const showUnsupportedToast = useCallback(() => {
    pushToast({
      kind: "info",
      title: t("workspace.fullscreen.unsupported_title"),
      body: t("workspace.fullscreen.unsupported_body"),
    });
  }, [pushToast, t]);

  useEffect(() => {
    const syncState = () => {
      const target = targetRef.current;
      setSupported(canUseFullscreen(target));
      setIsFullscreen(Boolean(target && getFullscreenElement(document) === target));
    };

    syncState();
    document.addEventListener("fullscreenchange", syncState);
    document.addEventListener("webkitfullscreenchange", syncState as EventListener);

    return () => {
      document.removeEventListener("fullscreenchange", syncState);
      document.removeEventListener("webkitfullscreenchange", syncState as EventListener);
    };
  }, [targetRef]);

  const enterFullscreen = useCallback(async () => {
    const target = targetRef.current;
    const requestFullscreen = getRequestFullscreenMethod(target);

    if (!requestFullscreen || !getExitFullscreenMethod(document)) {
      showUnsupportedToast();
      return;
    }

    try {
      await Promise.resolve(requestFullscreen());
    } catch (error) {
      console.warn("Failed to enter fullscreen", error);
      pushToast({
        kind: "warning",
        title: t("workspace.fullscreen.enter_failed_title"),
        body: getErrorMessage(error) ?? t("workspace.fullscreen.enter_failed_body"),
      });
    }
  }, [pushToast, showUnsupportedToast, t, targetRef]);

  const exitFullscreen = useCallback(async () => {
    const exitFullscreenMethod = getExitFullscreenMethod(document);

    if (!getFullscreenElement(document)) {
      return;
    }

    if (!exitFullscreenMethod) {
      showUnsupportedToast();
      return;
    }

    try {
      await Promise.resolve(exitFullscreenMethod());
    } catch (error) {
      console.warn("Failed to exit fullscreen", error);
      pushToast({
        kind: "warning",
        title: t("workspace.fullscreen.exit_failed_title"),
        body: getErrorMessage(error) ?? t("workspace.fullscreen.exit_failed_body"),
      });
    }
  }, [pushToast, showUnsupportedToast, t]);

  const toggleFullscreen = useCallback(async () => {
    if (targetRef.current && getFullscreenElement(document) === targetRef.current) {
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
