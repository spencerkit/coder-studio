/**
 * Session Card Component
 *
 * Individual agent session panel with terminal output,
 * status indicators, and control buttons.
 */

import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  X,
  FlipHorizontal,
  FlipVertical,
  Play,
  Square,
} from 'lucide-react';
import { sessionByIdAtomFamily } from '../../../atoms/sessions';
import { pendingFocusSessionAtom } from '../../../atoms/app-ui';
import type { SessionState } from '@coder-studio/core';
import { ObjectiveDialog } from '../../supervisor/views/shared/objective-dialog';
import { SupervisorCard } from '../../supervisor/views/shared/supervisor-card';
import { useSupervisor } from '../../supervisor/actions/use-supervisor';
import { XtermHost } from '../../terminal-panel/components/xterm-host';

type SessionCardAction = () => void | Promise<void>;

interface SessionCardProps {
  sessionId: string;
  showHeaderActions?: boolean;
  showSupervisorInline?: boolean;
  terminalReadOnlyOverride?: boolean;
  onClose?: SessionCardAction;
  onSplitHorizontal?: SessionCardAction;
  onSplitVertical?: SessionCardAction;
  onStart?: SessionCardAction;
  onStop?: SessionCardAction;
}

/**
 * Session Card
 *
 * PRD §8.3.1:
 *   - Progress bar (top)
 *   - Header: status dot, title, provider badge, status label, actions
 *   - Terminal area (xterm.js)
 */
export const SessionCard: FC<SessionCardProps> = ({
  sessionId,
  showHeaderActions = true,
  showSupervisorInline = true,
  terminalReadOnlyOverride,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onStart,
  onStop,
}) => {
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const pendingFocus = useAtomValue(pendingFocusSessionAtom);
  const setPendingFocus = useSetAtom(pendingFocusSessionAtom);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState(false);
  useSupervisor(session);

  // React to a pending-focus request whose target is this card. The atom
  // is shared by all session cards on the page, but only the matching one
  // will (a) scroll itself into view, (b) toggle the pulse class, and
  // (c) clear the marker so siblings stay quiet.
  useEffect(() => {
    if (pendingFocus !== sessionId) return;
    const node = cardRef.current;
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    setHighlight(true);
    setPendingFocus(null);
    const timer = setTimeout(() => setHighlight(false), 1_400);
    return () => clearTimeout(timer);
  }, [pendingFocus, sessionId, setPendingFocus]);

  if (!session) {
    return null;
  }

  const handleStart = async () => {
    await onStart?.();
  };

  const handleStop = async () => {
    await onStop?.();
  };

  /**
   * Close is fully owned by the parent action layer so desktop/mobile can
   * reuse the same session card without embedding feature side effects here.
   */
  const handleClose = async () => {
    await onClose?.();
  };

  /**
   * Split is also routed through explicit callbacks so the view stays
   * decoupled from pane state wiring.
   */
  const handleSplitHorizontal = () => {
    onSplitHorizontal?.();
  };

  const handleSplitVertical = () => {
    onSplitVertical?.();
  };

  const progressWidth = getProgressWidth(session.state);
  const sessionTitle = session.title?.trim() || formatSessionLabel(session.id);
  const providerLabel = formatProviderLabel(session.providerId);
  const sessionStateLabel = formatSessionStateLabel(session.state);
  const terminalReadOnly = terminalReadOnlyOverride ?? !isSessionInteractive(session.state);

  return (
    <div
      ref={cardRef}
      className={`session-card agent-pane${highlight ? ' session-card--focus-pulse' : ''}`}
      data-session-id={sessionId}
    >
      <div className="session-progress">
        <div
          className={`session-progress-bar ${getSessionProgressClass(session.state)}`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      <div className="session-header">
        <div className="session-header-left">
          <span className={`session-dot ${getSessionDotClass(session.state)}`} />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{sessionTitle}</span>
              <span className="badge badge-blue session-provider-badge">{providerLabel}</span>
              <span className={`session-state-badge ${getSessionBadgeClass(session.state)}`}>
                {sessionStateLabel}
              </span>
            </div>
          </div>
        </div>

        {showHeaderActions ? (
          <div className="session-header-actions">
            {session.state === 'idle' || session.state === 'interrupted' ? (
              <button className="session-action-btn" onClick={handleStart} title="Start" aria-label="Start">
                <Play size={13} />
              </button>
            ) : session.state === 'running' ? (
              <button className="session-action-btn" onClick={handleStop} title="Stop" aria-label="Stop">
                <Square size={13} />
              </button>
            ) : null}
            <button
              className="session-action-btn"
              onClick={handleSplitHorizontal}
              title="Split horizontal"
              aria-label="Split horizontal"
            >
              <FlipHorizontal size={13} />
            </button>
            <button
              className="session-action-btn"
              onClick={handleSplitVertical}
              title="Split vertical"
              aria-label="Split vertical"
            >
              <FlipVertical size={13} />
            </button>
            <button
              className="session-action-btn session-action-btn-close"
              onClick={handleClose}
              title="Close"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
      </div>

      {showSupervisorInline &&
      session.capability === 'full' &&
      session.state !== 'draft' &&
      session.state !== 'ended' &&
      session.state !== 'unavailable' ? (
        <>
          <SupervisorCard sessionId={session.id} workspaceId={session.workspaceId} />
          <ObjectiveDialog workspaceId={session.workspaceId} sessionId={session.id} />
        </>
      ) : null}

      <div className="session-terminal">
        <XtermHost
          terminalId={session.terminalId}
          workspaceId={session.workspaceId}
          readOnly={terminalReadOnly}
        />
      </div>
    </div>
  );
};

function getProgressWidth(state: SessionState): number {
  switch (state) {
    case 'starting':
      return 18;
    case 'running':
      return 42;
    case 'ended':
      return 100;
    case 'unavailable':
      return 100;
    default:
      return 8;
  }
}

function getSessionProgressClass(state: SessionState) {
  switch (state) {
    case 'starting':
      return 'session-progress-starting';
    case 'running':
      return 'session-progress-running';
    case 'idle':
      return 'session-progress-idle';
    case 'interrupted':
      return 'session-progress-interrupted';
    case 'ended':
      return 'session-progress-complete';
    case 'unavailable':
      return 'session-progress-unavailable';
    default:
      return 'session-progress-idle';
  }
}

function getSessionDotClass(state: SessionState) {
  switch (state) {
    case 'starting':
      return 'session-dot-starting';
    case 'running':
      return 'session-dot-running';
    case 'interrupted':
      return 'session-dot-interrupted';
    case 'ended':
      return 'session-dot-complete';
    case 'unavailable':
      return 'session-dot-unavailable';
    default:
      return 'session-dot-idle';
  }
}

function getSessionBadgeClass(state: SessionState) {
  switch (state) {
    case 'starting':
      return 'badge badge-amber';
    case 'running':
      return 'badge badge-green';
    case 'interrupted':
      return 'badge badge-pink';
    case 'ended':
      return 'badge badge-blue';
    case 'unavailable':
      return 'badge badge-pink';
    default:
      return 'badge badge-gray';
  }
}

function formatSessionLabel(sessionId: string) {
  const numericId = sessionId.match(/(\d+)/)?.[1];

  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, '0')}`;
  }

  return sessionId.replace(/[_-]/g, ' ').toUpperCase();
}

function formatSessionStateLabel(state: SessionState) {
  return state
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatProviderLabel(providerId: string) {
  return providerId.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isSessionInteractive(state: SessionState) {
  return state === 'running' || state === 'idle' || state === 'starting';
}

export default SessionCard;
