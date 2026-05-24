import type { GitStatus } from "@coder-studio/core";
import type { KeyboardEventHandler, MouseEventHandler } from "react";
import { ThemedIcon, Tooltip } from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { useWorkspaceRefreshActions } from "../../actions/use-workspace-refresh-actions";
import { DesktopBranchQuickPickPopover } from "./branch-quick-pick";
import { GitStatusBar } from "./git-status-bar";

interface GitPanelStatusStripProps {
  workspaceId: string;
  gitState: GitStatus | null | undefined;
  onOpenBranchSwitcher?: () => void;
}

interface BranchTriggerProps {
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
  ariaLabel: string;
  branchName: string;
  branchSummary: string | null;
  disabled: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
}

function BranchTrigger({
  "aria-controls": ariaControls,
  "aria-expanded": ariaExpanded,
  "aria-haspopup": ariaHaspopup,
  ariaLabel,
  branchName,
  branchSummary,
  disabled,
  onClick,
  onKeyDown,
}: BranchTriggerProps) {
  return (
    <Tooltip content={branchName}>
      <button
        type="button"
        className="git-panel-status-strip__branch"
        onClick={onClick}
        onKeyDown={onKeyDown}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-haspopup={ariaHaspopup}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <ThemedIcon semantic="git.footer.branch" size={11} />
        <span className="git-panel-status-strip__branch-text">{branchName}</span>
      </button>
    </Tooltip>
  );
}

export function GitPanelStatusStrip({
  workspaceId,
  gitState,
  onOpenBranchSwitcher,
}: GitPanelStatusStripProps) {
  const t = useTranslation();
  const viewport = useViewport();
  const { refreshWorkspace, status: refreshStatus } = useWorkspaceRefreshActions(workspaceId);
  const branchName = gitState?.branch?.trim() || t("git.no_branch");
  const branchSummary =
    gitState && (gitState.ahead > 0 || gitState.behind > 0)
      ? [
          gitState.ahead > 0 ? `↑${gitState.ahead}` : null,
          gitState.behind > 0 ? `↓${gitState.behind}` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : null;
  const branchAriaLabel = `${t("git.current_branch")}: ${branchName}`;
  const branchTrigger = (
    <BranchTrigger
      ariaLabel={branchAriaLabel}
      branchName={branchName}
      branchSummary={branchSummary}
      disabled={!onOpenBranchSwitcher}
      onClick={viewport === "mobile" ? onOpenBranchSwitcher : undefined}
    />
  );

  return (
    <div className="git-panel-status-strip">
      <div className="git-panel-status-strip__left">
        {viewport === "desktop" && onOpenBranchSwitcher ? (
          <DesktopBranchQuickPickPopover
            workspaceId={workspaceId}
            onOpenBranchSwitcher={onOpenBranchSwitcher}
          >
            {branchTrigger}
          </DesktopBranchQuickPickPopover>
        ) : (
          branchTrigger
        )}
        <div className="git-panel-status-strip__meta">
          <GitStatusBar
            workspaceId={workspaceId}
            gitState={gitState}
            inline
            onRefresh={refreshWorkspace}
            refreshStatus={refreshStatus}
          />
        </div>
      </div>
    </div>
  );
}
