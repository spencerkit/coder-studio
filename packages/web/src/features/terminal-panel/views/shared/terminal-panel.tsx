import { Plus, X, ChevronDown, Terminal } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';
import { formatTerminalTitle } from '../../components/title-format';
import { useTerminalActions } from '../../actions/use-terminal-actions';
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
  const {
    activeTerminalId,
    activeTerminalMeta,
    activeWorkspaceId,
    handleCloseTerminal,
    handleCreateTerminal,
    handleSwitchTerminal,
    hasTerminals,
    terminalIds,
  } = useTerminalActions();
  const activeTerminalIndex = activeTerminalId ? terminalIds.indexOf(activeTerminalId) : 0;
  const activeTerminalTitle = formatTerminalTitle(
    activeTerminalMeta,
    activeTerminalIndex >= 0 ? activeTerminalIndex : 0,
    t('terminal.shell')
  );

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
