/**
 * Notification State Atoms
 *
 * Toast queue persisted in Jotai. Written by the notification engine,
 * consumed by the ToastContainer component.
 */

import { atom } from 'jotai';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

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
export const pushToastAtom = atom(null, (get, set, toast: Omit<Toast, 'id' | 'createdAt'>) => {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: Toast = { ...toast, id, createdAt: Date.now() };
  set(toastsAtom, (prev) => [...prev.slice(-4), entry]);
});

/** Dismiss a toast by id */
export const dismissToastAtom = atom(null, (get, set, id: string) => {
  set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
});

/* ------------------------------------------------------------------ *
 * Per-session output tail buffer
 *
 * The notification engine pulls a short text summary from the agent's
 * most recent stdout when firing "turn complete". We keep at most
 * SESSION_OUTPUT_TAIL_BYTES of UTF-8 text per session, already stripped
 * of ANSI escapes and control characters, in this single atom.
 *
 * Written by: WS event router in `app/providers.tsx` on every
 *             `workspace.{ws}.terminal.{tid}.output` event whose
 *             terminal is associated with a known session.
 * Read by:    useSessionNotifications when assembling the summary.
 * ------------------------------------------------------------------ */

/** Keep at most this many characters per session. Trim from the head. */
export const SESSION_OUTPUT_TAIL_BYTES = 4_096;

export const sessionOutputTailAtom = atom<Record<string, string>>({});

/**
 * Append a chunk of cleaned text to the tail buffer for `sessionId`,
 * truncating from the head so we never exceed the byte cap.
 */
export const appendSessionOutputAtom = atom(
  null,
  (get, set, payload: { sessionId: string; text: string }) => {
    if (!payload.text) return;
    const current = get(sessionOutputTailAtom)[payload.sessionId] ?? '';
    const merged = current + payload.text;
    const trimmed = merged.length > SESSION_OUTPUT_TAIL_BYTES
      ? merged.slice(merged.length - SESSION_OUTPUT_TAIL_BYTES)
      : merged;
    set(sessionOutputTailAtom, (prev) => ({ ...prev, [payload.sessionId]: trimmed }));
  }
);

/** Drop a session's tail buffer (call when the session is removed). */
export const clearSessionOutputAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const current = get(sessionOutputTailAtom);
    if (!(sessionId in current)) return;
    const next = { ...current };
    delete next[sessionId];
    set(sessionOutputTailAtom, next);
  }
);
