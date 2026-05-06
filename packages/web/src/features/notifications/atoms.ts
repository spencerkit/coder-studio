/**
 * Notification State Atoms
 *
 * Toast queue persisted in Jotai. Written by the notification engine,
 * consumed by the ToastContainer component.
 */

import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
}

export const notificationPreferencesAtom = atomWithStorage<NotificationPreferences>(
  "ui.notificationPreferences",
  {
    enabled: true,
    soundEnabled: true,
  }
);

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Workspace ID to navigate to on click */
  workspaceId?: string;
  /** Session ID to navigate to on click */
  sessionId?: string;
  /** Auto-dismiss after this many ms (0 = manual only) */
  duration?: number;
  createdAt: number;
}

/** Active toast queue (max 5, FIFO) */
export const toastsAtom = atom<Toast[]>([]);

/** Push a toast */
export const pushToastAtom = atom(null, (get, set, toast: Omit<Toast, "id" | "createdAt">) => {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: Toast = { ...toast, id, createdAt: Date.now() };
  set(toastsAtom, (prev) => [...prev.slice(-4), entry]);
});

/** Dismiss a toast by id */
export const dismissToastAtom = atom(null, (get, set, id: string) => {
  set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
});
