import type { GitStatus } from "@coder-studio/core";
import { GitBranch } from "lucide-react";
import { Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { GitStatusBar } from "./git-status-bar";

interface GitPanelStatusStripProps {
  workspaceId: string;
  gitState: GitStatus | null | undefined;
  onOpenBranchSwitcher?: () => void;
}

export function GitPanelStatusStrip({
  workspaceId,
  gitState,
  onOpenBranchSwitcher,
}: GitPanelStatusStripProps) {
  const t = useTranslation();
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

  return (
    <div className="git-panel-status-strip">
      <Tooltip content={branchName}>
        <button
          type="button"
          className="git-panel-status-strip__branch"
          onClick={onOpenBranchSwitcher}
          aria-label={`${t("git.current_branch")}: ${branchName}`}
          disabled={!onOpenBranchSwitcher}
        >
          <GitBranch size={11} />
          <span className="git-panel-status-strip__branch-text">
            {branchName}
            {branchSummary ? ` · ${branchSummary}` : ""}
          </span>
        </button>
      </Tooltip>
      <div className="git-panel-status-strip__meta">
        <GitStatusBar workspaceId={workspaceId} gitState={gitState} inline />
      </div>
    </div>
  );
}
