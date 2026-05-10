import { useStore } from "jotai";
import { ChevronDown, Plus, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  IconButton,
  Popover,
  Select,
  TabList,
  Tabs,
  Tooltip,
} from "../../../../components/ui";
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
  const [desktopSelectorOpen, setDesktopSelectorOpen] = useState(false);
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
  const selectedTerminalId = activeTerminalId ?? terminalIds[0] ?? "";
  const isMobileFullscreen = chrome === "mobile-fullscreen";
  const showSelector = hasTerminals && (!isMobileFullscreen || terminalIds.length > 1);
  const showTabs = terminalIds.length > 1 && !isMobileFullscreen;
  const terminalSelectorOptions = terminalIds.map((id, index) => {
    const terminalMeta = store.get(terminalMetaAtomFamily(id));

    return {
      value: id,
      label: formatTerminalTitle(terminalMeta, index, t("terminal.shell")),
    };
  });

  useEffect(() => {
    if (!showSelector || terminalIds.length <= 1) {
      setDesktopSelectorOpen(false);
      setSelectorSheetOpen(false);
    }
  }, [showSelector, terminalIds.length]);

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
                  {isMobileFullscreen ? (
                    <Select
                      mobile
                      aria-label={t("terminal.selector.switch")}
                      aria-expanded={selectorSheetOpen}
                      className="terminal-selector-btn"
                      includeValueInAriaLabel={false}
                      options={terminalSelectorOptions}
                      value={selectedTerminalId}
                      valueLabel={activeTerminalTitle}
                      onClick={(event) => {
                        if (!selectorSheetOpen) {
                          return;
                        }

                        event.preventDefault();
                        setSelectorSheetOpen(false);
                      }}
                      onOpen={() => setSelectorSheetOpen(true)}
                    />
                  ) : terminalIds.length > 1 ? (
                    <Popover
                      content={
                        <>
                          {terminalIds.map((id, index) => (
                            <TerminalSelectorItem
                              key={id}
                              id={id}
                              index={index}
                              isActive={id === activeTerminalId}
                              onSelect={() => {
                                handleSwitchTerminal(id);
                                setDesktopSelectorOpen(false);
                              }}
                              onClose={() => {
                                setDesktopSelectorOpen(false);
                                void handleCloseTerminal(id);
                              }}
                            />
                          ))}
                        </>
                      }
                      contentClassName="terminal-selector-dropdown"
                      forceMode="desktop"
                      open={desktopSelectorOpen}
                      placement="bottom-end"
                      title={t("terminal.selector.title")}
                      onOpenChange={setDesktopSelectorOpen}
                    >
                      <button
                        type="button"
                        className="terminal-selector-btn"
                        aria-label={activeTerminalTitle}
                      >
                        <span>{activeTerminalTitle}</span>
                        <ChevronDown size={12} />
                      </button>
                    </Popover>
                  ) : (
                    <button
                      type="button"
                      className="terminal-selector-btn"
                      aria-label={activeTerminalTitle}
                    >
                      <span>{activeTerminalTitle}</span>
                      <ChevronDown size={12} />
                    </button>
                  )}

                  {isMobileFullscreen ? (
                    selectorSheetOpen ? (
                      <MobileSelectSheet
                        title={t("terminal.selector.title")}
                        sections={[
                          {
                            kind: "options",
                            id: "terminals",
                            items: terminalSelectorOptions.map((option, index) => {
                              return {
                                id: option.value,
                                label: option.label,
                                meta:
                                  option.value === activeTerminalId
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
                  ) : null}
                </div>
              ) : null}

              <div className="terminal-toolbar-actions">
                <Tooltip content={t("action.close")}>
                  <IconButton
                    className="panel-toolbar-btn"
                    aria-label={t("terminal.close_terminal")}
                    icon={<X size={14} />}
                    onClick={() => {
                      if (!activeTerminalId) {
                        return;
                      }

                      setDesktopSelectorOpen(false);
                      setSelectorSheetOpen(false);
                      void handleCloseTerminal(activeTerminalId);
                    }}
                    size="sm"
                  />
                </Tooltip>
              </div>
            </>
          )}

          <div className="terminal-toolbar-actions">
            <Tooltip content={t("action.open")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("terminal.new_terminal")}
                icon={<Plus size={14} />}
                onClick={handleCreateTerminal}
                size="sm"
              />
            </Tooltip>
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
              <Tabs
                aria-label={t("terminal.selector.title")}
                className="bottom-terminal-tabs-nav"
                onValueChange={handleSwitchTerminal}
                value={selectedTerminalId}
              >
                <TabList className="bottom-terminal-tabs">
                  {terminalIds.map((id, index) => (
                    <TerminalTab
                      key={id}
                      id={id}
                      index={index}
                      isActive={id === selectedTerminalId}
                      onSelect={() => handleSwitchTerminal(id)}
                      onClose={() => handleCloseTerminal(id)}
                    />
                  ))}
                </TabList>
              </Tabs>
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
