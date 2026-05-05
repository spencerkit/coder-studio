/**
 * Session Completion Notification Engine
 *
 * PRD §15: Notify the user when long-running agent turns complete, so
 * they can come back from another tab/window and look at the result.
 *
 *  Trigger
 *  -------
 *  Primary:  running → idle      (Agent finished a turn, waiting for user)
 *  Fallback: running → ended     (terminal exited or user clicked Stop without
 *                                 ever returning to idle — fire once anyway)
 *
 *  Any running turn that later returns to `idle` or `ended` may fire a
 *  completion notification.
 *
 *  We deliberately ignore extremely short turns (< MIN_NOTIFY_DURATION_MS)
 *  because echoing "hi" to the agent and getting an instant reply should not
 *  ding. The threshold is measured from the moment the session entered an
 *  active state.
 *
 *  Channel selection is automatic based on workspace focus + page visibility:
 *
 *    ┌────────────────────────────┬────────────────────────────────┐
 *    │ Page visible (document)    │ Page hidden (tab in background)│
 *    ├────────────────────────────┼────────────────────────────────┤
 *    │ session.workspaceId is the │ Always send a system (browser) │
 *    │ active workspace           │ push notification              │
 *    │   → suppress (user is here)│                                │
 *    │ Otherwise                  │                                │
 *    │   → in-app banner toast    │                                │
 *    └────────────────────────────┴────────────────────────────────┘
 *
 *  Sound is an independent toggle; it only plays when a notification
 *  actually fires.
 */

import type { SessionState } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";
import { pendingFocusSessionAtom, visibleMobileSessionIdAtom } from "../../atoms/app-ui";
import { connectionStatusAtom, dispatchCommandAtom } from "../../atoms/connection";
import { sessionsAtom } from "../../atoms/sessions";
import {
  activeWorkspaceIdAtom,
  resolvedActiveWorkspaceIdAtom,
  workspacesAtom,
} from "../../atoms/workspaces";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { notificationPreferencesAtom, pushToastAtom } from "./atoms";
import { focusSession } from "./focus-session";
import { formatDuration, formatProviderLabel, formatWorkspaceLabel } from "./format";

type NotificationChannel = "none" | "toast" | "system";

/**
 * Turns shorter than this (active → idle/ended) are not worth interrupting
 * the user for. Picked to comfortably swallow trivial echo-replies while
 * still catching anything a human would meaningfully wait on.
 */
const MIN_NOTIFY_DURATION_MS = 4_000;

/** What we remember about each session between renders. */
interface SessionTrace {
  /** State as of the last time we observed this session. */
  state: SessionState;
  /** Timestamp (ms) when the session most recently entered an active state. */
  activeSince: number | null;
  /** Whether we've already notified for the currently in-flight turn. */
  notifiedForTurn: boolean;
}

// States that represent "a turn is in flight and we should notify the user
// when it finishes". We intentionally exclude `starting` because it only
// tracks provider-CLI boot, not a user-submitted turn — otherwise the first
// SessionStart→idle transition after boot would fire a bogus
// "session completed" toast before the user has done anything.
const ACTIVE_STATES: ReadonlySet<SessionState> = new Set(["running"]);

/** Terminal states for our purposes — these are the ones that trigger a check. */
const COMPLETION_STATES: ReadonlySet<SessionState> = new Set(["idle", "ended"]);

/**
 * Decide whether a visible-page completion should stay silent because the user
 * is already looking at the relevant session/workspace.
 */
function shouldSuppressVisibleNotification(
  sessionWorkspaceId: string,
  sessionId: string,
  activeWorkspaceId: string | null,
  viewport: "mobile" | "desktop",
  visibleMobileSessionId: string | null
): boolean {
  if (activeWorkspaceId !== sessionWorkspaceId) {
    return false;
  }
  if (viewport !== "mobile") {
    return true;
  }
  return visibleMobileSessionId === sessionId;
}

/**
 * Decide which delivery channel to use for a session-completion event.
 *
 * - If the page is hidden (`document.hidden`), use a system push so the
 *   user sees it from another tab/app.
 * - Otherwise, visible-page events that are not suppressed use an in-app toast.
 */
function selectChannel(hidden: boolean, suppressed: boolean): NotificationChannel {
  if (hidden) {
    return "system";
  }
  if (suppressed) {
    return "none";
  }
  return "toast";
}

function isDocumentHidden(): boolean {
  if (typeof document !== "undefined" && document.hidden) {
    return true;
  }
  return false;
}

/**
 * Play the task-complete sound using the Web Audio API.
 * Prefer the PRD-specified `task-complete.wav`; fall back to a synthesised
 * chime if the browser blocks media playback.
 */
async function playCompletionSound(): Promise<void> {
  try {
    const audio = new Audio("/task-complete.wav");
    audio.volume = 0.75;
    await audio.play();
    return;
  } catch {
    // Fall back to Web Audio below.
  }

  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;

    // First tone — higher pitch
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 880;
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second tone — lower pitch, delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 660;
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);

    setTimeout(() => ctx.close(), 2000);
  } catch {
    // Web Audio not available — silently skip
  }
}

interface BrowserNotificationOptions {
  title: string;
  body: string;
  tag: string;
  workspaceId: string;
  sessionId: string;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  /** Set the pending-focus marker so the target SessionCard reacts on
   *  mount (or the next render if it's already mounted). */
  setPendingFocus: (sessionId: string | null) => void;
}

function showBrowserNotification(opts: BrowserNotificationOptions): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    // `silent: true` keeps the OS chime off — we already play our own
    // sound (gated by the `soundEnabled` preference) when needed, and
    // doubling up creates an unpleasant beep-stack.
    const notification = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      silent: true,
    });

    notification.onclick = () => {
      // Bring the tab to the foreground first; otherwise a window.focus()
      // after navigation gets eaten by some OSes.
      window.focus();
      focusSession({
        workspaceId: opts.workspaceId,
        sessionId: opts.sessionId,
        setActiveWorkspaceId: opts.setActiveWorkspaceId,
        setPendingFocus: opts.setPendingFocus,
        // No router available here — focusSession falls back to
        // history.pushState + popstate, which the SPA router handles.
      });
      notification.close();
    };
  } catch {
    // Notification API may not be available in all contexts
  }
}

/**
 * Hook: useSessionNotifications
 *
 * Call once at the app root (inside AppProviders).
 * Monitors session state transitions and fires notifications.
 */
export function useSessionNotifications(): void {
  const sessions = useAtomValue(sessionsAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const notificationPreferences = useAtomValue(notificationPreferencesAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const visibleMobileSessionId = useAtomValue(visibleMobileSessionIdAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setPendingFocus = useSetAtom(pendingFocusSessionAtom);
  const t = useTranslation();
  const viewport = useViewport();
  // Read-on-demand handle for atoms we don't want to trigger re-renders for —
  // notably the workspaces map, which we snapshot only when a notification fires.
  const store = useStore();

  // Per-session trace: previous state + when the current turn started + whether
  // we've already fired for this turn. Re-entering an active state resets the
  // notified flag, so a session that goes running→idle→running→idle gets two
  // notifications (one per turn).
  const tracesRef = useRef<Map<string, SessionTrace>>(new Map());

  useEffect(() => {
    if (connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      const result = await dispatch<Record<string, unknown>>("settings.get", {});
      if (cancelled || !result.ok || !result.data) {
        return;
      }

      setNotificationPreferences({
        enabled:
          typeof result.data["notifications.enabled"] === "boolean"
            ? result.data["notifications.enabled"]
            : true,
        soundEnabled:
          typeof result.data["notifications.soundEnabled"] === "boolean"
            ? result.data["notifications.soundEnabled"]
            : true,
      });
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, setNotificationPreferences]);

  useEffect(() => {
    const traces = tracesRef.current;

    for (const session of Object.values(sessions)) {
      const trace = traces.get(session.id);
      const prev = trace?.state;
      const curr = session.state;

      // Update / seed trace bookkeeping. We do this even if notifications are
      // disabled so that flipping the switch back on does not retroactively
      // fire stale transitions.
      const enteringActive = ACTIVE_STATES.has(curr) && (!trace || !ACTIVE_STATES.has(trace.state));
      const next: SessionTrace = {
        state: curr,
        activeSince: enteringActive
          ? Date.now()
          : (trace?.activeSince ?? (ACTIVE_STATES.has(curr) ? Date.now() : null)),
        // Re-entering an active state begins a new turn → reset the flag so
        // the next active→idle/ended transition can fire again.
        notifiedForTurn: enteringActive ? false : (trace?.notifiedForTurn ?? false),
      };
      traces.set(session.id, next);

      if (!notificationPreferences.enabled) continue;
      if (!prev) continue; // First time we see this session — no transition yet.
      if (!ACTIVE_STATES.has(prev)) continue;
      if (!COMPLETION_STATES.has(curr)) continue;
      if (next.notifiedForTurn) continue;

      // Suppress trivial-length turns — but only for the running→idle path.
      // If the session actually `ended`, the user almost certainly cares
      // (a long task crashed, the CLI quit, etc.) regardless of duration.
      if (curr === "idle" && next.activeSince !== null) {
        const duration = Date.now() - next.activeSince;
        if (duration < MIN_NOTIFY_DURATION_MS) {
          // Mark as handled so we don't fire on a later, unrelated render of
          // the same idle state. The flag will reset on the next running edge.
          next.notifiedForTurn = true;
          continue;
        }
      }

      next.notifiedForTurn = true;

      const hidden = isDocumentHidden();
      const suppressed = hidden
        ? false
        : shouldSuppressVisibleNotification(
            session.workspaceId,
            session.id,
            activeWorkspaceId,
            viewport,
            visibleMobileSessionId
          );
      const channel = selectChannel(hidden, suppressed);
      if (channel === "none") continue;

      const sessionLabel = session.title?.trim() || formatSessionLabel(session.id);
      const title = t("notification.session_completed_title", {
        session: sessionLabel,
      });

      // Body has two parts:
      //   line 1: structured metadata — provider, workspace, duration
      //   line 2: a fixed completion hint (running→idle vs running→ended)
      const workspace = store.get(workspacesAtom)[session.workspaceId];
      const metaParts: string[] = [];
      const providerLabel = formatProviderLabel(session.providerId).replace(/\s+/g, " ").trim();
      if (providerLabel) metaParts.push(providerLabel);
      const workspaceLabel = formatWorkspaceLabel(workspace ?? null)
        .replace(/\s+/g, " ")
        .trim();
      if (workspaceLabel) metaParts.push(workspaceLabel);
      const durationMs = next.activeSince !== null ? Date.now() - next.activeSince : null;
      const durationLabel = durationMs !== null ? formatDuration(durationMs) : "";
      if (durationLabel) metaParts.push(durationLabel);
      const metaLine = metaParts.join(" · ");

      const hint =
        curr === "ended"
          ? t("notification.session_ended_hint")
          : t("notification.session_turn_completed");

      const bodyLines: string[] = [];
      if (metaLine) bodyLines.push(metaLine);
      bodyLines.push(hint);
      const body = bodyLines.join("\n");

      if (notificationPreferences.soundEnabled) {
        void playCompletionSound();
      }

      if (channel === "system") {
        // Tag scopes the notification to "this turn" so a later turn can
        // replace it instead of stacking.
        const tag = `session-${session.id}-${next.activeSince ?? "unknown"}`;
        showBrowserNotification({
          title,
          body,
          tag,
          workspaceId: session.workspaceId,
          sessionId: session.id,
          setActiveWorkspaceId,
          setPendingFocus,
        });
      } else {
        pushToast({
          kind: "success",
          title,
          body,
          workspaceId: session.workspaceId,
          sessionId: session.id,
          duration: 6000,
        });
      }
    }

    // Purge traces for sessions that no longer exist.
    const currentIds = new Set(Object.keys(sessions));
    for (const id of traces.keys()) {
      if (!currentIds.has(id)) {
        traces.delete(id);
      }
    }
  }, [
    sessions,
    notificationPreferences,
    activeWorkspaceId,
    visibleMobileSessionId,
    viewport,
    pushToast,
    setActiveWorkspaceId,
    setPendingFocus,
    store,
    t,
  ]);
}

function formatSessionLabel(sessionId: string): string {
  const numericId = sessionId.match(/(\d+)/)?.[1];
  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, "0")}`;
  }
  return sessionId.replace(/[_-]/g, " ").toUpperCase();
}
