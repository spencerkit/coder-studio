import type {
  BrowserNotificationSupport,
} from "../../types/app.ts";

export type CompletionReminderTarget = {
  workspaceId: string;
  workspaceTitle: string;
  sessionId: string;
  sessionTitle: string;
};

export type CompletionReminderEnvironment = {
  activeWorkspaceId?: string;
  activeSessionId?: string;
  documentVisible: boolean;
  windowFocused: boolean;
};

export const getBrowserNotificationPermissionState = (): BrowserNotificationSupport => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return window.Notification.permission === "granted"
    ? "allowed"
    : "not-enabled";
};

export const isCompletionReminderBackgroundCase = (
  target: CompletionReminderTarget,
  environment: CompletionReminderEnvironment,
) => (
  target.workspaceId !== environment.activeWorkspaceId
  || target.sessionId !== environment.activeSessionId
  || !environment.documentVisible
  || !environment.windowFocused
);

export const playCompletionReminderSound = async (
  audio: HTMLAudioElement | null,
) => {
  if (!audio) return;

  try {
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // Ignore browser autoplay or playback failures.
  }
};

export const notifyCompletionReminder = async ({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) => {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  let permission = window.Notification.permission;
  if (permission === "default") {
    permission = await window.Notification.requestPermission();
  }

  if (permission !== "granted") {
    return;
  }

  const notification = new window.Notification(title, { body });
  notification.onclick = () => {
    window.focus?.();
    onClick();
  };
};
