import { useStore } from "jotai";
import { ChevronDown, Plus, Terminal, X } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { MobileSelectSheet } from "../../../mobile-select";
import { useTerminalActions } from "../../actions/use-terminal-actions";
import { terminalMetaAtomFamily } from "../../atoms";
import { formatTerminalTitle } from "../../components/title-format";
import { TerminalSelectorItem } from "./terminal-selector-item";
import { TerminalTab } from "./terminal-tab";
import { XtermHost } from "./xterm-host";

interface TerminalPanelProps {
  chrome?: "default" | "mobile-fullscreen";
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
export function TerminalPanel({ chrome = "default" }: TerminalPanelProps) {
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
    t("terminal.shell")
  );
  const isMobileFullscreen = chrome === "mobile-fullscreen";
  const showSelector = hasTerminals && (!isMobileFullscreen || terminalIds.length > 1);
  const showTabs = terminalIds.length > 1 && !isMobileFullscreen;

  return (
    <div
      className={`bottom-terminal${isMobileFullscreen ? " bottom-terminal--mobile-fullscreen" : ""}`}
    >
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          {isMobileFullscreen ? null : (
            <div className="terminal-title-stack">
              <span className="terminal-kicker">{t("terminal.kicker")}</span>
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
                    aria-label={
                      isMobileFullscreen ? t("terminal.selector.switch") : activeTerminalTitle
                    }
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
                      <MobileSelectSheet
                        title={t("terminal.selector.title")}
                        sections={[
                          {
                            kind: "options",
                            id: "terminals",
                            items: terminalIds.map((id, index) => {
                              const terminalMeta = store.get(terminalMetaAtomFamily(id));
                              const label = formatTerminalTitle(
                                terminalMeta,
                                index,
                                t("terminal.shell")
                              );

                              return {
                                id,
                                label,
                                meta:
                                  id === activeTerminalId
                                    ? t("terminal.selector.current")
                                    : t("terminal.selector.indexed", { index: index + 1 }),
                              };
                            }),
                          },
                        ]}
                        selectedId={activeTerminalId}
                        onSelect={handleSwitchTerminal}
                        onClose={() => setSelectorSheetOpen(false)}
                      />
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
                  aria-label={t("terminal.close_terminal")}
                  title={t("action.close")}
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
              aria-label={t("terminal.new_terminal")}
              title={t("action.open")}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="bottom-terminal-content">
        {!hasTerminals ? (
          <EmptyState
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreateTerminal}
                leadingIcon={<Plus size={14} />}
              >
                {t("terminal.new_terminal")}
              </Button>
            }
            className="bottom-terminal-empty"
            description={<p className="bottom-terminal-empty-hint">{t("terminal.empty_hint")}</p>}
            icon={<Terminal size={32} className="bottom-terminal-empty-icon" />}
            title={<p className="bottom-terminal-empty-text">{t("terminal.no_terminal")}</p>}
          />
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
                  terminalKind={activeTerminalMeta.kind ?? "shell"}
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
