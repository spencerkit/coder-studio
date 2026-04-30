/**
 * Terminal Panel Component
 *
 * Bottom panel for shell terminals with multi-tab support.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { Plus, X, ChevronDown, Terminal } from 'lucide-react';
import { terminalMetaAtomFamily, terminalOutputAtomFamily } from '../../../atoms/terminals';
import { resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import { dispatchCommandAtom, wsClientAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import { Topics } from '@coder-studio/core';
import { XtermHost } from './xterm-host';
import { TerminalTab } from './terminal-tab';
import { TerminalSelectorItem } from './terminal-selector-item';
import { formatTerminalTitle } from './title-format';
import type { Terminal as TerminalDto } from '@coder-studio/core';
import type { TerminalBinaryPayload } from '../../../ws/client';

const EMPTY_TERMINAL_ID = '__terminal_panel_empty__';

function mergeTerminalIds(existing: string[], incoming: string[]): string[] {
  const seen = new Set(incoming);
  const merged = [...incoming];

  for (const id of existing) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }

  return merged;
}

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
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const store = useStore();

  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const activeTerminalMetaState = useAtomValue(
    terminalMetaAtomFamily(activeTerminalId ?? EMPTY_TERMINAL_ID)
  );
  const activeTerminalMeta = activeTerminalId ? activeTerminalMetaState : null;
  const activeTerminalIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : 0;
  const activeTerminalTitle = formatTerminalTitle(
    activeTerminalMeta,
    activeTerminalIndex >= 0 ? activeTerminalIndex : 0,
    t('terminal.shell')
  );

  useEffect(() => {
    if (!activeWorkspaceId) {
      setTerminalIds([]);
      setActiveTerminalId(null);
      return;
    }

    let cancelled = false;
    setTerminalIds([]);
    setActiveTerminalId(null);

    dispatch<TerminalDto[]>('terminal.list', { workspaceId: activeWorkspaceId })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          console.error('Failed to fetch terminals:', result.error?.message);
          return;
        }

        const shellTerminals = result.data.filter((terminal) => terminal.kind === 'shell');
        const shellIds = shellTerminals.map((terminal) => terminal.id);

        for (const terminal of shellTerminals) {
          store.set(terminalMetaAtomFamily(terminal.id), {
            id: terminal.id,
            workspaceId: terminal.workspaceId,
            kind: terminal.kind,
            alive: terminal.alive,
            exitCode: terminal.exitCode,
            title: terminal.title,
          });
        }

        setTerminalIds((current) => mergeTerminalIds(current, shellIds));
        setActiveTerminalId((current) => current ?? shellIds[0] ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch terminals:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, dispatch, store]);

  useEffect(() => {
    if (!wsClient || !activeWorkspaceId) return;

    const allTerminalsTopic = Topics.terminalsAll(activeWorkspaceId);

    unsubscribeRef.current = wsClient.subscribe(
      [allTerminalsTopic],
      (topic, payload, _seq) => {
        const parts = topic.split('.');
        if (parts.length < 5) return;

        const terminalId = parts[3];
        const event = parts[4];

        if (event === 'created') {
          const createData = payload as { id: string; kind: 'shell' | 'agent' };
          if (createData.kind !== 'shell') {
            return;
          }

          setTerminalIds((prev) => {
            if (prev.includes(createData.id)) return prev;
            return [...prev, createData.id];
          });
          setActiveTerminalId(createData.id);
        } else if (event === 'output') {
          const outputData = payload as TerminalBinaryPayload;
          const meta = store.get(terminalMetaAtomFamily(terminalId));
          if (!meta || meta.kind !== 'shell') return;

          const outputAtom = terminalOutputAtomFamily(terminalId);
          const prev = store.get(outputAtom);
          if (_seq <= prev.lastSeq) return;

          store.set(outputAtom, {
            chunks: [...prev.chunks, outputData.bytes],
            lastSeq: _seq,
          });
        }
      }
    );

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [wsClient, activeWorkspaceId, store]);

  const handleCreateTerminal = async () => {
    if (!activeWorkspaceId) return;

    const result = await dispatch<TerminalDto>('terminal.create', {
      workspaceId: activeWorkspaceId,
      kind: 'shell',
    });

    if (result.ok && result.data) {
      const terminal = result.data;

      store.set(terminalMetaAtomFamily(terminal.id), {
        id: terminal.id,
        workspaceId: terminal.workspaceId,
        kind: terminal.kind,
        alive: terminal.alive,
        title: terminal.title,
      });

      setTerminalIds((prev) => {
        if (prev.includes(terminal.id)) return prev;
        return [...prev, terminal.id];
      });

      setActiveTerminalId(terminal.id);
    }
  };

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

  const handleSwitchTerminal = useCallback((terminalId: string) => {
    setActiveTerminalId(terminalId);
  }, []);

  const hasTerminals = terminalIds.length > 0;

  return (
    <div className="bottom-terminal">
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <div className="terminal-title-stack">
            <span className="terminal-kicker">TERMINAL</span>
            {activeTerminalMeta ? (
              <span className="terminal-title">{activeTerminalTitle}</span>
            ) : null}
          </div>
        </div>

        <div className="terminal-toolbar-right">
          {hasTerminals && (
            <>
              <div className="terminal-selector">
                <button className="terminal-selector-btn">
                  <span>{activeTerminalTitle}</span>
                  <ChevronDown size={12} />
                </button>

                {terminalIds.length > 1 ? (
                  <div className="terminal-selector-dropdown">
                    {terminalIds.map((id, index) => (
                      <TerminalSelectorItem
                        key={id}
                        id={id}
                        index={index}
                        isActive={id === activeTerminalId}
                        onSelect={() => handleSwitchTerminal(id)}
                        onClose={() => handleCloseTerminal(id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="terminal-toolbar-actions">
                <button
                  className="panel-toolbar-btn"
                  onClick={() => activeTerminalId && handleCloseTerminal(activeTerminalId)}
                  aria-label={t('terminal.close_terminal')}
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>
            </>
          )}

          <div className="terminal-toolbar-actions">
            <button
              className="panel-toolbar-btn"
              onClick={handleCreateTerminal}
              aria-label={t('terminal.new_terminal')}
              title="Add"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="bottom-terminal-content">
        {!hasTerminals ? (
          <div className="bottom-terminal-empty">
            <Terminal size={32} className="bottom-terminal-empty-icon" />
            <p className="bottom-terminal-empty-text">{t('terminal.no_terminal')}</p>
            <p className="bottom-terminal-empty-hint">
              Launch a shell to inspect files, run commands, and verify changes without leaving the workspace.
            </p>
            <button className="btn btn-primary btn-sm" onClick={handleCreateTerminal}>
              <Plus size={14} />
              <span>{t('terminal.new_terminal')}</span>
            </button>
          </div>
        ) : (
          <>
            {terminalIds.length > 1 ? (
              <div className="bottom-terminal-tabs">
                {terminalIds.map((id, index) => (
                  <TerminalTab
                    key={id}
                    id={id}
                    index={index}
                    isActive={id === activeTerminalId}
                    onSelect={() => handleSwitchTerminal(id)}
                    onClose={() => handleCloseTerminal(id)}
                  />
                ))}
              </div>
            ) : null}
            {activeTerminalMeta && activeWorkspaceId && (
              <div className="bottom-terminal-xterm">
                <XtermHost
                  terminalId={activeTerminalMeta.id}
                  workspaceId={activeWorkspaceId}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default TerminalPanel;
