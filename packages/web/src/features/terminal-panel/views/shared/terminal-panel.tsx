import { useAtom, useStore } from "jotai";
import { ChevronDown, Command, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  IconButton,
  Popover,
  Select,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { MobileSelectSheet } from "../../../mobile-select";
import { TaskCommandSidePanel } from "../../../tasks";
import { useTerminalActions } from "../../actions/use-terminal-actions";
import { terminalCommandSidePanelOpenAtomFamily, terminalMetaAtomFamily } from "../../atoms";
import { formatTerminalTitle } from "../../components/title-format";
import { TerminalSelectorItem } from "./terminal-selector-item";
import { XtermHost } from "./xterm-host";

interface TerminalPanelProps {
  chrome?: "default" | "mobile-fullscreen";
  onMobileHeaderActionsChange?: (actions: ReactNode | null) => void;
}

/**
 * Terminal Panel
 *
 * PRD §11.2:
 *   - Bottom panel layout with resizer
 *   - Toolbar: kicker, title, selector, close, add buttons
 *   - Multi-terminal support with selector
 *   - xterm.js rendering area
 *   - Empty state when no terminals
 */
export function TerminalPanel({
  chrome = "default",
  onMobileHeaderActionsChange,
}: TerminalPanelProps) {
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
  const commandSidePanelWorkspaceId = activeWorkspaceId ?? "__terminal_command_panel_empty__";
  const [commandSidePanelOpen, setCommandSidePanelOpen] = useAtom(
    terminalCommandSidePanelOpenAtomFamily(commandSidePanelWorkspaceId)
  );
  const showCommandSidePanel =
    !isMobileFullscreen && commandSidePanelOpen && Boolean(activeWorkspaceId);
  const showSelector = hasTerminals && (!isMobileFullscreen || terminalIds.length > 1);
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

  useEffect(() => {
    if (!onMobileHeaderActionsChange) {
      return;
    }

    return () => {
      onMobileHeaderActionsChange(null);
    };
  }, [onMobileHeaderActionsChange]);

  useEffect(() => {
    if (!onMobileHeaderActionsChange) {
      return;
    }

    onMobileHeaderActionsChange(null);
  }, [onMobileHeaderActionsChange]);

  return (
    <div
      className={`bottom-terminal${isMobileFullscreen ? " bottom-terminal--mobile-fullscreen" : ""}`}
    >
      <div className="terminal-toolbar">
        {isMobileFullscreen ? (
          <div className="terminal-toolbar-mobile-row">
            {hasTerminals ? (
              <div className="terminal-selector">
                {showSelector ? (
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
                ) : (
                  <div
                    className="terminal-selector-btn terminal-selector-btn--static"
                    aria-label={activeTerminalTitle}
                  >
                    <span>{activeTerminalTitle}</span>
                  </div>
                )}

                {showSelector && selectorSheetOpen ? (
                  <MobileSelectSheet
                    className="mobile-select-sheet--command"
                    title={t("terminal.selector.title")}
                    sections={[
                      {
                        kind: "options",
                        id: "terminals",
                        items: terminalSelectorOptions.map((option, index) => ({
                          id: option.value,
                          label: option.label,
                          meta:
                            option.value === activeTerminalId
                              ? t("terminal.selector.current")
                              : t("terminal.selector.indexed", { index: index + 1 }),
                        })),
                      },
                    ]}
                    selectedId={activeTerminalId}
                    onSelect={handleSwitchTerminal}
                    onClose={() => setSelectorSheetOpen(false)}
                  />
                ) : null}
              </div>
            ) : (
              <div className="terminal-toolbar-mobile-placeholder" aria-hidden="true" />
            )}

            {hasTerminals && activeTerminalId ? (
              <div className="terminal-toolbar-actions">
                <Tooltip content={t("action.close")}>
                  <IconButton
                    className="panel-toolbar-btn"
                    aria-label={t("terminal.close_terminal")}
                    icon={<X size={14} />}
                    onClick={() => {
                      setDesktopSelectorOpen(false);
                      setSelectorSheetOpen(false);
                      void handleCloseTerminal(activeTerminalId);
                    }}
                    size="sm"
                  />
                </Tooltip>
              </div>
            ) : null}

            {isMobileFullscreen ? (
              <div className="terminal-toolbar-actions">
                <Tooltip content={t("action.open")}>
                  <IconButton
                    className="panel-toolbar-btn"
                    aria-label={t("terminal.new_terminal")}
                    icon={<ThemedIcon semantic="terminal.action.new" size={14} />}
                    onClick={handleCreateTerminal}
                    size="sm"
                  />
                </Tooltip>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="terminal-toolbar-left">
              <div className="terminal-title-stack">
                <span className="terminal-kicker">{t("terminal.kicker")}</span>
                {activeTerminalMeta ? (
                  <span className="terminal-title">{activeTerminalTitle}</span>
                ) : null}
              </div>
            </div>

            <div className="terminal-toolbar-right">
              {hasTerminals && (
                <>
                  {showSelector ? (
                    <div className="terminal-selector">
                      {terminalIds.length > 1 ? (
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
                    icon={<ThemedIcon semantic="terminal.action.new" size={14} />}
                    onClick={handleCreateTerminal}
                    size="sm"
                  />
                </Tooltip>
                {!isMobileFullscreen ? (
                  <Tooltip
                    content={
                      commandSidePanelOpen
                        ? t("terminal.close_commands")
                        : t("terminal.open_commands")
                    }
                  >
                    <IconButton
                      className={`panel-toolbar-btn${commandSidePanelOpen ? " panel-toolbar-btn--active" : ""}`}
                      aria-label={
                        commandSidePanelOpen
                          ? t("terminal.close_commands")
                          : t("terminal.open_commands")
                      }
                      aria-pressed={commandSidePanelOpen}
                      disabled={!activeWorkspaceId}
                      icon={<Command size={14} />}
                      onClick={() => setCommandSidePanelOpen((open) => !open)}
                      size="sm"
                    />
                  </Tooltip>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bottom-terminal-content">
        <div className="bottom-terminal-main">
          {!hasTerminals ? (
            <EmptyState
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreateTerminal}
                  leadingIcon={<ThemedIcon semantic="terminal.action.new" size={14} />}
                >
                  {t("terminal.new_terminal")}
                </Button>
              }
              className="bottom-terminal-empty"
              description={<p className="bottom-terminal-empty-hint">{t("terminal.empty_hint")}</p>}
              icon={
                <ThemedIcon
                  className="bottom-terminal-empty-icon"
                  semantic="state.emptyTerminal"
                  size={32}
                />
              }
              title={<p className="bottom-terminal-empty-text">{t("terminal.no_terminal")}</p>}
            />
          ) : (
            <>
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
        {showCommandSidePanel && activeWorkspaceId ? (
          <TaskCommandSidePanel
            workspaceId={activeWorkspaceId}
            onClose={() => setCommandSidePanelOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}

export default TerminalPanel;
