/**
 * Session Card Component
 *
 * Individual agent session panel with terminal output,
 * status indicators, and control buttons.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { X, SplitHorizontal, SplitVertical } from 'lucide-react';
import { sessionByIdAtomFamily } from '../../../atoms/sessions';
import { useTranslation } from '../../../lib/i18n';
import type { Session, SessionState } from '@coder-studio/core';

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

  if (!session) {
    return null;
  }

  const handleClose = () => {
    // TODO: Dispatch session stop command
    console.log('Close session:', sessionId);
  };

  const handleSplitHorizontal = () => {
    // TODO: Dispatch split panel command
    console.log('Split horizontal');
  };

  const handleSplitVertical = () => {
    // TODO: Dispatch split panel command
    console.log('Split vertical');
  };

  const progressWidth = getProgressWidth(session.state);

  return (
    <div className="session-card">
      {/* Progress bar */}
      <div className="session-progress">
        <div
          className={`session-progress-bar session-progress-${session.state}`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      {/* Header */}
      <div className="session-header">
        <div className="session-header-left">
          <span className={`session-dot session-dot-${session.state}`} />
          <span className="session-title">{session.id.slice(0, 8)}</span>
          <span className="session-provider-badge">{session.provider}</span>
          <span className="session-status-label">{t(`session.state.${session.state}`)}</span>
        </div>

        <div className="session-header-actions">
          <button
            className="btn btn-icon btn-sm"
            onClick={handleSplitHorizontal}
            aria-label={t('tooltip.split_horizontal')}
          >
            <SplitHorizontal size={13} />
          </button>
          <button
            className="btn btn-icon btn-sm"
            onClick={handleSplitVertical}
            aria-label={t('tooltip.split_vertical')}
          >
            <SplitVertical size={13} />
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
      <div className="session-terminal">
        {/* TODO: Render xterm.js terminal */}
        <div className="session-terminal-placeholder">
          <p>{t('terminal.title')}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Get progress bar width based on session state
 */
function getProgressWidth(state: SessionState): number {
  switch (state) {
    case 'loading':
      return 14;
    case 'running':
      return 34;
    case 'error':
      return 100;
    default:
      return 6;
  }
}

export default SessionCard;
