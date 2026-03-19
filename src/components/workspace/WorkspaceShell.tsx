import type { ReactNode } from "react";
import type { Locale, Translator } from "../../i18n";
import {
  WorkspaceBranchIcon,
  WorkspaceChangesIcon,
  WorkspaceCodeIcon,
  WorkspaceFolderIcon,
  WorkspaceTerminalIcon
} from "../icons";

type WorkspaceShellProps = {
  locale: Locale;
  isFocusMode: boolean;
  isCodeExpanded: boolean;
  showAgentPanel: boolean;
  showCodePanel: boolean;
  showTerminalPanel: boolean;
  rightSplit: number;
  workspaceFolderName: string;
  branchName: string;
  changeCount: number;
  agentPanel: ReactNode;
  codePanel: ReactNode;
  terminalPanel: ReactNode;
  onToggleRightPane: (pane: "code" | "terminal") => void;
  t: Translator;
};

export const WorkspaceShell = ({
  locale,
  isFocusMode,
  isCodeExpanded,
  showAgentPanel,
  showCodePanel,
  showTerminalPanel,
  rightSplit,
  workspaceFolderName,
  branchName,
  changeCount,
  agentPanel,
  codePanel,
  terminalPanel,
  onToggleRightPane,
  t
}: WorkspaceShellProps) => (
  <main className="workspace-shell">
    <div className="workspace-main-header workspace-shell-header">
      <div className="workspace-main-header-copy">
        <div className="workspace-main-meta">
          <span className="workspace-main-chip">
            <WorkspaceFolderIcon />
            <span>{workspaceFolderName}</span>
          </span>
          <span className="workspace-main-chip">
            <WorkspaceBranchIcon />
            <span>{branchName || "—"}</span>
          </span>
          <span className="workspace-main-chip">
            <WorkspaceChangesIcon />
            <span>{t("changesCount", { count: changeCount })}</span>
          </span>
        </div>
      </div>
      <div className="workspace-main-actions">
        <button
          type="button"
          className={`workspace-panel-toggle ${showCodePanel ? "active" : ""}`}
          onClick={() => onToggleRightPane("code")}
          title={t("codePanel")}
          aria-pressed={showCodePanel}
        >
          <WorkspaceCodeIcon />
          <span>{t("codePanel")}</span>
        </button>
        <button
          type="button"
          className={`workspace-panel-toggle ${showTerminalPanel ? "active" : ""}`}
          onClick={() => onToggleRightPane("terminal")}
          title={t("terminalPanel")}
          aria-pressed={showTerminalPanel}
        >
          <WorkspaceTerminalIcon />
          <span>{t("terminalPanel")}</span>
        </button>
        <span className="workspace-shortcut-hint">
          {locale === "zh" ? "⌘/Ctrl+K 快速操作" : "⌘/Ctrl+K actions"}
        </span>
      </div>
    </div>

    <div className={`workspace-stack ${isFocusMode ? "focus-mode" : ""} ${isCodeExpanded ? "code-expanded" : ""}`}>
      <div
        className="workspace-top-shell"
        style={!isCodeExpanded && showTerminalPanel ? { flex: `0 0 ${rightSplit}%` } : undefined}
      >
        {showAgentPanel && agentPanel}
        {showCodePanel && codePanel}
      </div>

      {!isCodeExpanded && showTerminalPanel && terminalPanel}
    </div>
  </main>
);

export default WorkspaceShell;
