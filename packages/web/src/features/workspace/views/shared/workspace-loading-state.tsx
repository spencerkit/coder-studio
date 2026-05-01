export function WorkspaceLoadingState() {
  return (
    <div className="workspace-resolving-shell" data-testid="workspace-resolving-shell">
      <div className="workspace-resolving-card">
        <div className="workspace-resolving-kicker">Workspace</div>
        <div className="workspace-resolving-title">Loading workspaces</div>
        <div className="workspace-resolving-desc">
          Preparing your workspace list and restoring the last active session.
        </div>
      </div>
    </div>
  );
}
