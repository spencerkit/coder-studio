import type { GitStatus } from "@coder-studio/core";
import { GitPanelStatusStrip } from "./git-panel-status-strip";

interface WorkspaceStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null | undefined;
  onOpenBranchSwitcher?: () => void;
  flush?: boolean;
}

export function WorkspaceStatusBar({
  workspaceId,
  gitState,
  onOpenBranchSwitcher,
  flush = false,
}: WorkspaceStatusBarProps) {
  return (
    <div className={`workspace-status-bar${flush ? " workspace-status-bar--flush" : ""}`}>
      <GitPanelStatusStrip
        align={flush ? "end" : "start"}
        workspaceId={workspaceId}
        gitState={gitState}
        onOpenBranchSwitcher={onOpenBranchSwitcher}
      />
    </div>
  );
}
