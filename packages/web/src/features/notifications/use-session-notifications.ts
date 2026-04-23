/**
 * Session Completion Notification Engine
 *
 * PRD §15: Notify the user when long-running agent sessions complete
 * their work, especially when the user is working in another tab/app.
 *
 * - Watches session state transitions (running/idle → ended)
 * - Plays a task-complete sound
 * - Shows browser push notification (if permission granted)
 * - Shows in-app toast notification
 * - Respects "notify only in background" setting
 */

import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { connectionStatusAtom, dispatchCommandAtom } from '../../atoms/connection';
import { sessionsAtom } from '../../atoms/sessions';
import { notificationPreferencesAtom } from '../../atoms/ui';
import { pushToastAtom } from './atoms';
import { useTranslation } from '../../lib/i18n';
import type { SessionState } from '@coder-studio/core';

/**
 * Check whether the browser window is in the background.
 */
function isBackgrounded(): boolean {
  return document.hidden;
}

/**
 * Play the task-complete sound using the Web Audio API.
 * Prefer the PRD-specified `task-complete.wav`; fall back to a synthesised
 * chime if the browser blocks media playback.
 */
async function playCompletionSound(): Promise<void> {
  try {
    const audio = new Audio('/task-complete.wav');
    audio.volume = 0.75;
    await audio.play();
    return;
  } catch {
    // Fall back to Web Audio below.
  }

  try {
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;

    // First tone — higher pitch
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 880;
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc1.connect(gain1).connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);

    // Second tone — lower pitch, delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 660;
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2).connect(ctx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.5);

    // Cleanup
    setTimeout(() => ctx.close(), 2000);
  } catch {
    // Web Audio not available — silently skip
  }
}

/**
 * Show a browser push notification.
 * Clicking it focuses the window.
 */
function focusWorkspace(workspaceId: string): void {
  localStorage.setItem('ui.activeWorkspaceId', JSON.stringify(workspaceId));
  const path = `/workspace/${workspaceId}`;
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

function showBrowserNotification(title: string, body: string, tag: string, workspaceId: string): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(title, {
      body,
      tag,
      silent: true, // we play our own sound
    });

    notification.onclick = () => {
      window.focus();
      focusWorkspace(workspaceId);
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
  const pushToast = useSetAtom(pushToastAtom);
  const t = useTranslation();

  // Track previous session states to detect transitions
  const prevStatesRef = useRef<Map<string, SessionState>>(new Map());
  // Track which sessions we've already notified for (avoid duplicates)
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      const result = await dispatch<Record<string, unknown>>('settings.get', {});
      if (cancelled || !result.ok || !result.data) {
        return;
      }

      setNotificationPreferences({
        enabled: typeof result.data['notifications.enabled'] === 'boolean'
          ? result.data['notifications.enabled']
          : true,
        onlyWhenBackgrounded: typeof result.data['notifications.onlyWhenBackgrounded'] === 'boolean'
          ? result.data['notifications.onlyWhenBackgrounded']
          : true,
      });
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, setNotificationPreferences]);

  useEffect(() => {
    const prevStates = prevStatesRef.current;
    const notified = notifiedRef.current;

    if (!notificationPreferences.enabled) {
      // Still track state transitions even when disabled
      for (const session of Object.values(sessions)) {
        prevStates.set(session.id, session.state);
      }
      return;
    }

    for (const session of Object.values(sessions)) {
      const prevState = prevStates.get(session.id);
      const currState = session.state;
      prevStates.set(session.id, currState);

      // Detect transition to 'ended' from running/idle/starting/interrupted
      const wasActive = prevState === 'running' || prevState === 'idle'
        || prevState === 'starting' || prevState === 'interrupted';
      const isEnded = currState === 'ended';

      if (wasActive && isEnded && !notified.has(session.id)) {
        notified.add(session.id);

        // Respect "only in background" setting
        const shouldNotify = !notificationPreferences.onlyWhenBackgrounded || isBackgrounded();

        if (shouldNotify) {
          // Play sound
          void playCompletionSound();

          // Show browser push notification
          const title = t('notification.session_completed_title', {
            session: formatSessionLabel(session.id),
          });
          const body = t('notification.session_completed_body');
          showBrowserNotification(title, body, `session-end-${session.id}`, session.workspaceId);

          // Show in-app toast
          pushToast({
            kind: 'success',
            title,
            body,
            workspaceId: session.workspaceId,
            sessionId: session.id,
            duration: 6000,
          });
        }
      }

      // Clean up tracking for sessions that were removed from the map
      // (shouldn't normally happen, but be safe)
      if (currState === 'ended') {
        // We keep the notified flag for the session's lifetime
        // It will be garbage-collected when the session disappears from `sessions`
      }
    }

    // Purge prevStates for sessions that no longer exist
    const currentIds = new Set(Object.keys(sessions));
    for (const id of prevStates.keys()) {
      if (!currentIds.has(id)) {
        prevStates.delete(id);
        notified.delete(id);
      }
    }
  }, [sessions, notificationPreferences, pushToast, t]);
}

function formatSessionLabel(sessionId: string): string {
  const numericId = sessionId.match(/(\d+)/)?.[1];
  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, '0')}`;
  }
  return sessionId.replace(/[_-]/g, ' ').toUpperCase();
}
