import type { PointerEventHandler, ReactNode, RefObject } from "react";
import type { Translator } from "../../i18n";
import { HeaderAddIcon, HeaderCloseIcon } from "../icons";

type TerminalOption = {
  id: string;
  title: string;
};

type WorkspaceTerminalPanelProps = {
  progressPercent: number;
  progressTone: "live" | "steady" | "idle";
  activeTerminalId?: string;
  terminals: TerminalOption[];
  terminalViewportRef: RefObject<HTMLDivElement | null>;
  terminalContent: ReactNode;
  onResizeStart: PointerEventHandler<HTMLDivElement>;
  onSelect: (terminalId: string) => void;
  onClose: () => void;
  onAdd: () => void;
  hasActiveTerminal: boolean;
  t: Translator;
};

export const WorkspaceTerminalPanel = ({
  progressPercent,
  progressTone,
  activeTerminalId,
  terminals,
  terminalViewportRef,
  terminalContent,
  onResizeStart,
  onSelect,
  onClose,
  onAdd,
  hasActiveTerminal,
  t
}: WorkspaceTerminalPanelProps) => (
  <>
    <div
      className="h-resizer workspace-bottom-splitter"
      data-resize="right-split"
      onPointerDown={onResizeStart}
    />
    <section className="panel workspace-terminal-shell">
      <div className="panel-inner terminal-card workspace-terminal-panel">
        <div className={`surface-progress ${progressTone}`} aria-hidden="true">
          <span className="surface-progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="terminal-toolbar">
          <div className="terminal-toolbar-title">{t("terminalPanel")}</div>
          <div className="terminal-toolbar-actions">
            <select
              className="terminal-select"
              value={activeTerminalId ?? ""}
              onChange={(event) => onSelect(event.target.value)}
            >
              {terminals.map((term) => (
                <option key={term.id} value={term.id}>
                  {term.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="workspace-icon-button"
              onClick={onClose}
              disabled={!hasActiveTerminal}
              title={t("close")}
              aria-label={t("close")}
            >
              <HeaderCloseIcon />
            </button>
            <button
              type="button"
              className="workspace-icon-button"
              onClick={onAdd}
              title={t("new")}
              aria-label={t("new")}
            >
              <HeaderAddIcon />
            </button>
          </div>
        </div>
        <div ref={terminalViewportRef} className="terminal-output">{terminalContent}</div>
      </div>
    </section>
  </>
);

export default WorkspaceTerminalPanel;
