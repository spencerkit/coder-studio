import { TerminalPanel } from "../../../terminal-panel";

interface WorkspaceBottomPanelProps {
  workspaceId: string;
}

export function WorkspaceBottomPanel({ workspaceId: _workspaceId }: WorkspaceBottomPanelProps) {
  return (
    <div className="workspace-bottom-panel-shell">
      <div className="workspace-bottom-panel-body">
        <TerminalPanel />
      </div>
    </div>
  );
}
