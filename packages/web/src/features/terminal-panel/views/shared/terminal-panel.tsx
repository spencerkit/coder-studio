import { Plus, X, ChevronDown, Terminal } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'jotai';
import { useTranslation } from '../../../../lib/i18n';
import { formatTerminalTitle } from '../../components/title-format';
import { useTerminalActions } from '../../actions/use-terminal-actions';
import { terminalMetaAtomFamily } from '../../atoms';
import { XtermHost } from './xterm-host';
import { TerminalTab } from './terminal-tab';
import { TerminalSelectorItem } from './terminal-selector-item';
import { MobileInlineSheet } from '../../../../shells/shared/mobile-inline-sheet';

interface TerminalPanelProps {
  chrome?: 'default' | 'mobile-fullscreen';
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
export function TerminalPanel({ chrome = 'default' }: TerminalPanelProps) {
  const t = useTranslation();
  const store = useStore();
  const [selectorSheetOpen, setSelectorSheetOpen] = useState(false);
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
  const isMobileFullscreen = chrome === 'mobile-fullscreen';
  const showSelector = hasTerminals && (!isMobileFullscreen || terminalIds.length > 1);
  const showTabs = terminalIds.length > 1 && !isMobileFullscreen;

  return (
    <div className={`bottom-terminal${isMobileFullscreen ? ' bottom-terminal--mobile-fullscreen' : ''}`}>
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          {isMobileFullscreen ? null : (
            <div className="terminal-title-stack">
              <span className="terminal-kicker">{t('terminal.kicker')}</span>
              {activeTerminalMeta ? (
                <span className="terminal-title">{activeTerminalTitle}</span>
              ) : null}
            </div>
          )}
        </div>

        <div className="terminal-toolbar-right">
          {hasTerminals && (
            <>
              {showSelector ? (
                <div className="terminal-selector">
                  <button
                    className="terminal-selector-btn"
                    aria-label={isMobileFullscreen ? t('terminal.selector.switch') : activeTerminalTitle}
                    aria-expanded={isMobileFullscreen ? selectorSheetOpen : undefined}
                    onClick={() => {
                      if (!isMobileFullscreen) {
                        return;
                      }

                      setSelectorSheetOpen((value) => !value);
                    }}
                  >
                    <span>{activeTerminalTitle}</span>
                    <ChevronDown size={12} />
                  </button>

                  {isMobileFullscreen ? (
                    selectorSheetOpen ? (
                      <MobileInlineSheet
                        title={t('terminal.selector.title')}
                        className="terminal-selector-sheet"
                        onClose={() => setSelectorSheetOpen(false)}
                      >
                        <div className="mobile-inline-sheet__list">
                          {terminalIds.map((id, index) => {
                            const terminalMeta = store.get(terminalMetaAtomFamily(id));
                            const label = formatTerminalTitle(
                              terminalMeta,
                              index,
                              t('terminal.shell')
                            );
                            return (
                              <button
                                key={id}
                                type="button"
                                className={`mobile-inline-sheet__option${id === activeTerminalId ? ' mobile-inline-sheet__option--active' : ''}`}
                                aria-label={label}
                                onClick={() => {
                                  handleSwitchTerminal(id);
                                  setSelectorSheetOpen(false);
                                }}
                              >
                                <span className="mobile-inline-sheet__option-copy">
                                  <span className="mobile-inline-sheet__option-title">{label}</span>
                                  <span className="mobile-inline-sheet__option-meta">
                                    {id === activeTerminalId
                                      ? t('terminal.selector.current')
                                      : t('terminal.selector.indexed', { index: index + 1 })}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </MobileInlineSheet>
                    ) : null
                  ) : terminalIds.length > 1 ? (
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
              ) : null}

              <div className="terminal-toolbar-actions">
                <button
                  className="panel-toolbar-btn"
                  onClick={() => {
                    if (!activeTerminalId) {
                      return;
                    }

                    setSelectorSheetOpen(false);
                    void handleCloseTerminal(activeTerminalId);
                  }}
                  aria-label={t('terminal.close_terminal')}
                  title={t('action.close')}
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
              title={t('action.open')}
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
              {t('terminal.empty_hint')}
            </p>
            <button className="btn btn-primary btn-sm" onClick={handleCreateTerminal}>
              <Plus size={14} />
              <span>{t('terminal.new_terminal')}</span>
            </button>
          </div>
        ) : (
          <>
            {showTabs ? (
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
