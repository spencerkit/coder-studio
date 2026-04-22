/**
 * Session Card Component
 *
 * Individual agent session panel with terminal output,
 * status indicators, and control buttons.
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useAtomValue } from 'jotai';
import {
  X,
  FlipHorizontal,
  FlipVertical,
  Play,
  Square,
  Send,
} from 'lucide-react';
import { sessionByIdAtomFamily } from '../../../atoms/sessions';
import { dispatchCommandAtom } from '../../../atoms/connection';
import type { SessionState } from '@coder-studio/core';
import { ObjectiveDialog } from '../../supervisor/components/objective-dialog';
import { SupervisorCard } from '../../supervisor/components/supervisor-card';
import { useSupervisor } from '../../supervisor/hooks/use-supervisor';
import { XtermHost } from '../../terminal-panel/components/xterm-host';
import { encodeUtf8ToBase64 } from '../../../lib/base64';

interface SessionCardProps {
  sessionId: string;
}

/**
 * Session Card
 *
 * PRD §8.3.1:
 *   - Progress bar (top)
 *   - Header: status dot, title, provider badge, status label, actions
 *   - Terminal area (xterm.js)
 */
export const SessionCard: FC<SessionCardProps> = ({ sessionId }) => {
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [inputValue, setInputValue] = useState('');
  useSupervisor(session);

  if (!session) {
    return null;
  }

  const handleStart = async () => {
    const result = await dispatch<{ sessionId: string }>('session.resume', {
      sessionId,
    });

    if (!result.ok) {
      console.error('Failed to resume session:', result.error?.message);
    }
  };

  const handleStop = async () => {
    const result = await dispatch<void>('session.stop', {
      sessionId,
    });

    if (!result.ok) {
      console.error('Failed to stop session:', result.error?.message);
    }
  };

  const handleSendInput = async () => {
    if (!inputValue.trim()) return;

    const result = await dispatch<void>('terminal.input', {
      terminalId: session.terminalId,
      bytes: encodeUtf8ToBase64(inputValue + '\n'),
      activity: 'submit',
    });

    if (result.ok) {
      setInputValue('');
    } else {
      console.error('Failed to send input:', result.error?.message);
    }
  };

  /**
   * Close stops the session and removes it from the pane layout.
   * The session is NOT removed from the server - it remains with state='ended'
   * so that the layout sanitizer can properly replace it with a draft leaf
   * while preserving the split structure.
   */
  const handleClose = async () => {
    // Remove from pane layout immediately (don't wait for stop to avoid UI flicker)
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-close', {
        detail: { sessionId },
      })
    );

    // Stop the session process
    await dispatch<void>('session.stop', { sessionId }).catch(() => {});
  };

  /**
   * Split fires a custom event that the AgentPanes container
   * handles by updating the pane layout tree. It does NOT
   * stop or restart the session.
   */
  const handleSplitHorizontal = () => {
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId, direction: 'horizontal' },
      })
    );
  };

  const handleSplitVertical = () => {
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId, direction: 'vertical' },
      })
    );
  };

  const progressWidth = getProgressWidth(session.state);
  const sessionTitle = formatSessionLabel(session.id);
  const providerLabel = formatProviderLabel(session.providerId);
  const sessionStateLabel = formatSessionStateLabel(session.state);

  return (
    <div className="session-card agent-pane">
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
      </div>

      {session.capability === 'full' &&
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
          readOnly={!isSessionInteractive(session.state)}
        />
      </div>

      {isSessionInteractive(session.state) && (
        <div className="session-input">
          <input
            className="input"
            type="text"
            value={inputValue}
            onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
            onCompositionEnd={(e) => {
              setInputValue((e.target as HTMLInputElement).value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                handleSendInput();
              }
            }}
            placeholder="Ask the agent to inspect, edit, or run a command"
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSendInput}
            disabled={!inputValue.trim()}
          >
            <Send size={14} />
          </button>
        </div>
      )}
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
  return state !== 'ended' && state !== 'unavailable';
}

export default SessionCard;
