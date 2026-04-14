/**
 * Session Card Component
 *
 * Individual agent session panel with terminal output,
 * status indicators, and control buttons.
 */

import type { FC } from 'react';
import { useState, useEffect, useRef } from 'react';
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
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

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
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Initialize xterm.js terminal
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new Terminal({
      fontSize: 13,
      fontFamily: 'JetBrains Mono, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Fit terminal when session changes
  useEffect(() => {
    if (fitAddonRef.current) {
      fitAddonRef.current.fit();
    }
  }, [session]);

  if (!session) {
    return null;
  }

  /**
   * Start session: dispatch session.start command
   */
  const handleStart = async () => {
    const result = await dispatch<{ sessionId: string }>('session.start', {
      sessionId,
    });

    if (!result.ok) {
      console.error('Failed to start session:', result.error?.message);
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
      data: inputValue + '\n',
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
          <span className="session-provider-badge">{session.providerId}</span>
          <span className="session-status-label">
            {t(`session.state.${session.state}`)}
          </span>
        </div>

        <div className="session-header-actions">
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
      <div className="session-terminal" ref={terminalRef} />

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
