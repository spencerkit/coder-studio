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
import { useTranslation } from '../../../lib/i18n';
import type { SessionState } from '@coder-studio/core';
import { XtermHost } from '../../terminal-panel/components/xterm-host';

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
  const t = useTranslation();
  const session = useAtomValue(sessionByIdAtomFamily(sessionId));
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [inputValue, setInputValue] = useState('');

  if (!session) {
    return null;
  }

  /**
   * Resume session: dispatch session.resume command
   */
  const handleStart = async () => {
    const result = await dispatch<{ sessionId: string }>('session.resume', {
      sessionId,
    });

    if (!result.ok) {
      console.error('Failed to resume session:', result.error?.message);
    }
  };

  /**
   * Stop session: dispatch session.stop command
   */
  const handleStop = async () => {
    const result = await dispatch<void>('session.stop', {
      sessionId,
    });

    if (!result.ok) {
      console.error('Failed to stop session:', result.error?.message);
    }
  };

  /**
   * Send input: dispatch terminal.input command
   */
  const handleSendInput = async () => {
    if (!inputValue.trim()) return;

    const result = await dispatch<void>('terminal.input', {
      terminalId: session.terminalId,
      bytes: btoa(inputValue + '\n'), // Base64 encode for binary-safe transport
    });

    if (result.ok) {
      setInputValue('');
    } else {
      console.error('Failed to send input:', result.error?.message);
    }
  };

  /**
   * Close session: dispatch session.stop command
   */
  const handleClose = async () => {
    await handleStop();
  };

  /**
   * Split panel horizontally
   */
  const handleSplitHorizontal = () => {
    // Dispatch custom event for panel split
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId, direction: 'horizontal' },
      })
    );
  };

  /**
   * Split panel vertically
   */
  const handleSplitVertical = () => {
    // Dispatch custom event for panel split
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId, direction: 'vertical' },
      })
    );
  };

  const progressWidth = getProgressWidth(session.state);

  return (
    <div className="agent-pane">
      {/* Progress bar */}
      <div className="agent-progress">
        <div
          className={`fill ${session.state === 'unavailable' ? 'error' : ''}`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      {/* Header */}
      <div className="agent-header">
        <div className="agent-header-left">
          <span className={`agent-session-dot ${session.state === 'running' ? 'active' : ''}`} />
          <span className="agent-title">{session.id.slice(0, 8)}</span>
          <span className="agent-badge">{session.providerId}</span>
          <span className="agent-status">
            {t(`session.state.${session.state}`)}
          </span>
        </div>

        <div className="agent-header-actions">
          {session.state === 'idle' || session.state === 'interrupted' ? (
            <button
              className="btn btn-icon btn-sm"
              onClick={handleStart}
              aria-label="Start"
            >
              <Play size={13} />
            </button>
          ) : session.state === 'running' ? (
            <button
              className="btn btn-icon btn-sm"
              onClick={handleStop}
              aria-label="Stop"
            >
              <Square size={13} />
            </button>
          ) : null}
          <button
            className="btn btn-icon btn-sm"
            onClick={handleSplitHorizontal}
            aria-label={t('tooltip.split_horizontal')}
          >
            <FlipHorizontal size={13} />
          </button>
          <button
            className="btn btn-icon btn-sm"
            onClick={handleSplitVertical}
            aria-label={t('tooltip.split_vertical')}
          >
            <FlipVertical size={13} />
          </button>
          <button
            className="btn btn-icon btn-sm"
            onClick={handleClose}
            aria-label={t('action.close')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="agent-terminal">
        <XtermHost
          terminalId={session.terminalId}
          workspaceId={session.workspaceId}
        />
      </div>

      {/* Input area */}
      {(session.state === 'running' || session.state === 'idle') && (
        <div className="session-input">
          <input
            className="input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSendInput();
              }
            }}
            placeholder="Type a message..."
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

/**
 * Get progress bar width based on session state
 */
function getProgressWidth(state: SessionState): number {
  switch (state) {
    case 'starting':
      return 14;
    case 'running':
      return 34;
    case 'unavailable':
      return 100;
    default:
      return 6;
  }
}

export default SessionCard;
