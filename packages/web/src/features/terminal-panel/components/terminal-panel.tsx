/**
 * Terminal Panel Component
 *
 * Bottom panel for shell terminals with multi-tab support.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Plus, X, ChevronDown, Terminal } from 'lucide-react';
import { terminalMetaAtomFamily, TerminalMeta } from '../../../atoms/terminals';
import { activeWorkspaceIdAtom, bottomPanelHeightAtom } from '../../../atoms/ui';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';

/**
 * Terminal Panel
 *
 * PRD §11.2:
 *   - Bottom panel layout with resizer
 *   - Toolbar: kicker, title, selector, close, add buttons
 *   - Multi-terminal support with tabs
 *   - xterm.js rendering area
 *   - Empty state when no terminals
 */
export function TerminalPanel() {
  const t = useTranslation();
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [bottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const dispatch = useSetAtom(dispatchCommandAtom);

  const [terminals, setTerminals] = useState<TerminalMeta[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);

  // Create new terminal
  const handleCreateTerminal = async () => {
    if (!activeWorkspaceId) return;

    const result = await dispatch<{ id: string }>({
      op: 'terminal.create',
      args: {
        workspaceId: activeWorkspaceId,
        kind: 'shell',
      },
    });

    if (result.ok && result.data) {
      setActiveTerminalId(result.data.id);
    }
  };

  // Close terminal
  const handleCloseTerminal = async (terminalId: string) => {
    const result = await dispatch({
      op: 'terminal.close',
      args: { terminalId },
    });

    if (result.ok) {
      setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
      if (activeTerminalId === terminalId) {
        setActiveTerminalId(terminals[0]?.id || null);
      }
    }
  };

  // Get active terminal
  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  // Don't render if panel is collapsed
  if (bottomPanelHeight === 0) {
    return null;
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-panel-header">
        <div className="terminal-panel-header-left">
          <span className="terminal-panel-kicker">{t('terminal.title').toUpperCase()}</span>
          {activeTerminal && (
            <span className="terminal-panel-title">{activeTerminal.title || t('terminal.shell')}</span>
          )}
        </div>

        <div className="terminal-panel-header-right">
          {terminals.length > 0 && (
            <>
              <div className="terminal-selector">
                <button className="terminal-selector-btn">
                  <Terminal size={14} />
                  <span>{activeTerminal?.title || t('terminal.shell')}</span>
                  <ChevronDown size={12} />
                </button>

                <div className="terminal-selector-dropdown">
                  {terminals.map((term) => (
                    <button
                      key={term.id}
                      className={`terminal-selector-item ${
                        term.id === activeTerminalId ? 'terminal-selector-item-active' : ''
                      }`}
                      onClick={() => setActiveTerminalId(term.id)}
                    >
                      <span className="terminal-selector-item-title">{term.title || t('terminal.shell')}</span>
                      <button
                        className="terminal-selector-item-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseTerminal(term.id);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="btn btn-icon btn-sm"
                onClick={() => activeTerminalId && handleCloseTerminal(activeTerminalId)}
                aria-label={t('terminal.close_terminal')}
              >
                <X size={14} />
              </button>
            </>
          )}

          <button
            className="btn btn-icon btn-sm"
            onClick={handleCreateTerminal}
            aria-label={t('terminal.new_terminal')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-panel-content">
        {terminals.length === 0 ? (
          <div className="terminal-panel-empty">
            <Terminal size={32} className="terminal-panel-empty-icon" />
            <p className="terminal-panel-empty-text">{t('terminal.no_terminal')}</p>
            <button className="btn btn-primary" onClick={handleCreateTerminal}>
              <Plus size={14} />
              <span>{t('terminal.new_terminal')}</span>
            </button>
          </div>
        ) : (
          <div className="terminal-panel-tabs">
            {terminals.map((term) => (
              <div
                key={term.id}
                className={`terminal-tab ${term.id === activeTerminalId ? 'terminal-tab-active' : ''}`}
              >
                <button
                  className="terminal-tab-label"
                  onClick={() => setActiveTerminalId(term.id)}
                >
                  <span className="terminal-tab-title">{term.title || t('terminal.shell')}</span>
                </button>
                <button
                  className="terminal-tab-close"
                  onClick={() => handleCloseTerminal(term.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTerminal && (
          <div className="terminal-panel-xterm">
            {/* TODO: Render xterm.js terminal */}
            <div className="terminal-placeholder">
              <p>{t('terminal.title')}: {activeTerminal.id.slice(0, 8)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TerminalPanel;
