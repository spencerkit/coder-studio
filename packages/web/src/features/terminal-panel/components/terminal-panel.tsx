/**
 * Terminal Panel Component
 *
 * Bottom panel for shell terminals with multi-tab support.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Plus, X, ChevronDown, Terminal } from 'lucide-react';
import { terminalMetaAtomFamily } from '../../../atoms/terminals';
import { activeWorkspaceIdAtom, bottomPanelHeightAtom } from '../../../atoms/ui';
import { dispatchCommandAtom, wsClientAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import { Topics } from '@coder-studio/core';
import { XtermHost } from './xterm-host';
import { TerminalTab } from './terminal-tab';
import { TerminalSelectorItem } from './terminal-selector-item';

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
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);

  // Track terminal IDs in local state
  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Get active terminal metadata (hook at top level)
  const activeTerminalMeta = activeTerminalId
    ? useAtomValue(terminalMetaAtomFamily(activeTerminalId))
    : null;

  /**
   * Subscribe to terminal events for the active workspace
   */
  useEffect(() => {
    if (!wsClient || !activeWorkspaceId) return;

    const allTerminalsTopic = Topics.terminalsAll(activeWorkspaceId);

    unsubscribeRef.current = wsClient.subscribe(
      [allTerminalsTopic],
      (topic, payload, _seq) => {
        const parts = topic.split('.');
        // Topic format: workspace.{id}.terminal.{terminalId}.{event}
        // parts:        [0]       [1]    [2]        [3]         [4]
        if (parts.length < 5) return;

        const terminalId = parts[3];
        const event = parts[4];

        if (event === 'created') {
          const createData = payload as { id: string; kind: 'shell' | 'agent' };
          setTerminalIds((prev) => {
            if (prev.includes(createData.id)) return prev;
            return [...prev, createData.id];
          });
          setActiveTerminalId(createData.id);
        }
      }
    );

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [wsClient, activeWorkspaceId]);

  /**
   * Create new terminal
   */
  const handleCreateTerminal = useCallback(async () => {
    if (!activeWorkspaceId) return;

    const result = await dispatch('terminal.create', {
      workspaceId: activeWorkspaceId,
      kind: 'shell',
    });

    if (result.ok && result.data) {
      const data = result.data as { id: string };
      const terminalId = data.id;

      setTerminalIds((prev) => {
        if (prev.includes(terminalId)) return prev;
        return [...prev, terminalId];
      });

      setActiveTerminalId(terminalId);
    }
  }, [activeWorkspaceId, dispatch]);

  /**
   * Close terminal
   */
  const handleCloseTerminal = useCallback(
    async (terminalId: string) => {
      const result = await dispatch('terminal.close', { terminalId });

      if (result.ok) {
        setTerminalIds((prev) => prev.filter((id) => id !== terminalId));

        if (activeTerminalId === terminalId) {
          const remainingIds = terminalIds.filter((id) => id !== terminalId);
          setActiveTerminalId(remainingIds[0] || null);
        }
      }
    },
    [dispatch, activeTerminalId, terminalIds]
  );

  /**
   * Switch active terminal
   */
  const handleSwitchTerminal = useCallback((terminalId: string) => {
    setActiveTerminalId(terminalId);
  }, []);

  // Don't render if panel is collapsed
  if (bottomPanelHeight === 0) {
    return null;
  }

  const hasTerminals = terminalIds.length > 0;

  return (
    <div className="bottom-terminal">
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <span className="terminal-kicker">{t('terminal.title').toUpperCase()}</span>
          {activeTerminalMeta && (
            <span className="terminal-title">
              {activeTerminalMeta.title || t('terminal.shell')}
            </span>
          )}
        </div>

        <div className="terminal-toolbar-right">
          {hasTerminals && (
            <>
              <div className="terminal-selector">
                <button className="terminal-selector-btn">
                  <Terminal size={14} />
                  <span>{activeTerminalMeta?.title || t('terminal.shell')}</span>
                  <ChevronDown size={12} />
                </button>

                <div className="terminal-selector-dropdown">
                  {terminalIds.map((id) => (
                    <TerminalSelectorItem
                      key={id}
                      id={id}
                      isActive={id === activeTerminalId}
                      onSelect={() => handleSwitchTerminal(id)}
                      onClose={() => handleCloseTerminal(id)}
                    />
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

      <div className="bottom-terminal-content">
        {!hasTerminals ? (
          <div className="bottom-terminal-empty">
            <Terminal size={32} className="bottom-terminal-empty-icon" />
            <p className="bottom-terminal-empty-text">{t('terminal.no_terminal')}</p>
            <button className="btn btn-primary" onClick={handleCreateTerminal}>
              <Plus size={14} />
              <span>{t('terminal.new_terminal')}</span>
            </button>
          </div>
        ) : (
          <div className="bottom-terminal-tabs">
            {terminalIds.map((id) => (
              <TerminalTab
                key={id}
                id={id}
                isActive={id === activeTerminalId}
                onSelect={() => handleSwitchTerminal(id)}
                onClose={() => handleCloseTerminal(id)}
              />
            ))}
          </div>
        )}

        {activeTerminalMeta && activeWorkspaceId && (
          <div className="bottom-terminal-xterm">
            <XtermHost
              terminalId={activeTerminalMeta.id}
              workspaceId={activeWorkspaceId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default TerminalPanel;