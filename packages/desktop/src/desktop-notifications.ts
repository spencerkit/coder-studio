import type { Event, NotificationCloseEventParams, NotificationConstructorOptions } from "electron";
import type {
  DesktopNotificationRequest,
  DesktopNotificationResult,
  DesktopNotificationTarget,
} from "./protocol.js";

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 4_096;
const MAX_TAG_LENGTH = 128;
const MAX_TARGET_ID_LENGTH = 256;
const DEFAULT_DELIVERY_TIMEOUT_MS = 1_000;
const MAX_RETAINED_NOTIFICATIONS = 100;

interface NativeNotificationPort {
  once(event: "show", listener: (event: Event) => void): unknown;
  once(event: "failed", listener: (event: Event, error: string) => void): unknown;
  once(event: "click", listener: (event: Event) => void): unknown;
  once(event: "close", listener: (details: Event<NotificationCloseEventParams>) => void): unknown;
  show(): void;
  close(): void;
}

interface DesktopNotificationServiceOptions {
  isSupported(): boolean;
  createNotification(options: NotificationConstructorOptions): NativeNotificationPort;
  onClick(target: DesktopNotificationTarget): void;
  onWarning(message: string, details: unknown): void;
  platform: NodeJS.Platform;
  deliveryTimeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

export interface DesktopNotificationService {
  isSupported(): boolean;
  show(value: unknown): Promise<DesktopNotificationResult>;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function parseDesktopNotificationRequest(value: unknown): DesktopNotificationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (!isBoundedString(candidate.title, MAX_TITLE_LENGTH)) return null;
  if (!isBoundedString(candidate.body, MAX_BODY_LENGTH)) return null;
  if (!isBoundedString(candidate.tag, MAX_TAG_LENGTH)) return null;
  if (!isBoundedString(candidate.workspaceId, MAX_TARGET_ID_LENGTH)) return null;
  if (!isBoundedString(candidate.sessionId, MAX_TARGET_ID_LENGTH)) return null;

  return {
    title: candidate.title,
    body: candidate.body,
    tag: candidate.tag,
    workspaceId: candidate.workspaceId,
    sessionId: candidate.sessionId,
  };
}

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const timeout = setTimeout(callback, delayMs);
  timeout.unref?.();
  return () => clearTimeout(timeout);
}

export function createDesktopNotificationService(
  options: DesktopNotificationServiceOptions
): DesktopNotificationService {
  const activeNotifications = new Map<string, NativeNotificationPort>();
  const schedule = options.schedule ?? defaultSchedule;

  const release = (tag: string, notification: NativeNotificationPort): void => {
    if (activeNotifications.get(tag) === notification) {
      activeNotifications.delete(tag);
    }
  };

  const retain = (tag: string, notification: NativeNotificationPort): void => {
    const previous = activeNotifications.get(tag);
    if (previous && previous !== notification) {
      activeNotifications.delete(tag);
      try {
        previous.close();
      } catch (error) {
        options.onWarning(`Unable to replace Desktop notification on ${options.platform}`, error);
      }
    }

    activeNotifications.set(tag, notification);
    while (activeNotifications.size > MAX_RETAINED_NOTIFICATIONS) {
      const oldest = activeNotifications.entries().next().value as
        | [string, NativeNotificationPort]
        | undefined;
      if (!oldest) break;
      activeNotifications.delete(oldest[0]);
      try {
        oldest[1].close();
      } catch (error) {
        options.onWarning(`Unable to release Desktop notification on ${options.platform}`, error);
      }
    }
  };

  return {
    isSupported: () => options.isSupported(),
    show: async (value) => {
      const request = parseDesktopNotificationRequest(value);
      if (!request) {
        options.onWarning("Rejected an invalid Desktop notification request", undefined);
        return { status: "failed" };
      }
      if (!options.isSupported()) return { status: "unsupported" };

      let notification: NativeNotificationPort;
      try {
        notification = options.createNotification({
          title: request.title,
          body: request.body,
          id: request.tag,
          silent: true,
        });
      } catch (error) {
        options.onWarning(`Unable to create Desktop notification on ${options.platform}`, error);
        return { status: "failed" };
      }

      retain(request.tag, notification);

      return await new Promise<DesktopNotificationResult>((resolve) => {
        let settled = false;
        let cancelTimeout = () => {};
        const settle = (result: DesktopNotificationResult) => {
          if (settled) return;
          settled = true;
          cancelTimeout();
          resolve(result);
        };

        notification.once("show", () => settle({ status: "shown" }));
        notification.once("failed", (_event: unknown, error: string) => {
          options.onWarning(`Desktop notification failed on ${options.platform}`, error);
          release(request.tag, notification);
          settle({ status: "failed" });
        });
        notification.once("click", () => {
          release(request.tag, notification);
          try {
            options.onClick({
              workspaceId: request.workspaceId,
              sessionId: request.sessionId,
            });
          } catch (error) {
            options.onWarning(
              `Unable to activate Desktop notification on ${options.platform}`,
              error
            );
          }
        });
        notification.once("close", () => release(request.tag, notification));

        cancelTimeout = schedule(
          () => settle({ status: "shown" }),
          options.deliveryTimeoutMs ?? DEFAULT_DELIVERY_TIMEOUT_MS
        );

        try {
          notification.show();
        } catch (error) {
          options.onWarning(`Unable to show Desktop notification on ${options.platform}`, error);
          release(request.tag, notification);
          settle({ status: "failed" });
        }
      });
    },
  };
}
