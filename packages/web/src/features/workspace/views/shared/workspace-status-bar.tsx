import type { GitStatus } from "@coder-studio/core";
import { FooterUpdateRail } from "./footer-update-rail";
import { GitPanelStatusStrip } from "./git-panel-status-strip";

interface WorkspaceStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null | undefined;
  onOpenBranchSwitcher?: () => void;
  flush?: boolean;
  align?: "start" | "end";
}

export function WorkspaceStatusBar({
  workspaceId,
  gitState,
  onOpenBranchSwitcher,
  flush = false,
}: WorkspaceStatusBarProps) {
  return (
    <div className={`workspace-status-bar${flush ? " workspace-status-bar--flush" : ""}`}>
      <div className="workspace-status-bar__left">
        <GitPanelStatusStrip
          workspaceId={workspaceId}
          gitState={gitState}
          onOpenBranchSwitcher={onOpenBranchSwitcher}
        />
      </div>
      <div className="workspace-status-bar__right">
        <FooterUpdateRail />
      </div>
    </div>
  );
}
