import type { ReactNode } from "react";
import type { Translator } from "../../i18n";
import type { WorkspaceShellSummaryItem } from "../../features/workspace/workspace-shell-summary";
import {
  MaximizeIcon,
  MinimizeIcon,
  WorkspaceCodeIcon,
  WorkspaceTerminalIcon,
} from "../icons";

type WorkspaceShellProps = {
  isFocusMode: boolean;
  isCodeExpanded: boolean;
  showAgentPanel: boolean;
  showCodePanel: boolean;
  showTerminalPanel: boolean;
  rightSplit: number;
  statusItems: WorkspaceShellSummaryItem[];
  runtimeHint: string;
  statusBanner?: ReactNode;
  agentPanel: ReactNode;
  codePanel: ReactNode;
  terminalPanel: ReactNode;
  onToggleRightPane: (pane: "code" | "terminal") => void;
  onToggleCodeExpanded: () => void;
  t: Translator;
};

export const WorkspaceShell = ({
  isFocusMode,
  isCodeExpanded,
  showAgentPanel,
  showCodePanel,
  showTerminalPanel,
  rightSplit,
  statusItems,
  runtimeHint,
  statusBanner,
  agentPanel,
  codePanel,
  terminalPanel,
  onToggleRightPane,
  onToggleCodeExpanded,
  t
}: WorkspaceShellProps) => (
  <main className="workspace-shell">
    <div className="workspace-status-strip" data-testid="workspace-status-strip">
      <div className="workspace-status-strip-items">
        {statusItems.map((item) => (
          <div key={item.key} className={`workspace-status-item tone-${item.tone ?? "neutral"}`}>
            <span className="workspace-status-label">{item.label}</span>
            <strong className="workspace-status-value">{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="workspace-status-strip-actions">
        <button
          type="button"
          className={`workspace-panel-toggle icon-only ${showCodePanel ? "active" : ""}`}
          onClick={() => onToggleRightPane("code")}
          title={t("codePanel")}
          aria-pressed={showCodePanel}
          aria-label={t("codePanel")}
        >
          <WorkspaceCodeIcon />
        </button>
        <button
          type="button"
          className={`workspace-panel-toggle icon-only ${showTerminalPanel ? "active" : ""}`}
          onClick={() => onToggleRightPane("terminal")}
          title={t("terminalPanel")}
          aria-pressed={showTerminalPanel}
          aria-label={t("terminalPanel")}
        >
          <WorkspaceTerminalIcon />
        </button>
        {showCodePanel ? (
          <button
            type="button"
            className={`workspace-panel-toggle icon-only ${isCodeExpanded ? "active" : ""}`}
            onClick={onToggleCodeExpanded}
            title={isCodeExpanded ? t("collapseCodePanel") : t("expandCodePanel")}
            aria-pressed={isCodeExpanded}
            aria-label={isCodeExpanded ? t("collapseCodePanel") : t("expandCodePanel")}
          >
            {isCodeExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
        ) : null}
        <span className="workspace-shortcut-hint">{runtimeHint}</span>
      </div>
    </div>

    {statusBanner}

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
