interface WorkspaceEmptyStateProps {
  title?: string;
  description?: string;
}

export function WorkspaceEmptyState({
  title = 'Failed to load workspaces',
  description = 'Failed to fetch workspace list',
}: WorkspaceEmptyStateProps) {
  return (
    <div className="workspace-resolving-shell">
      <div className="workspace-resolving-card">
        <div className="workspace-resolving-kicker">Workspace</div>
        <div className="workspace-resolving-title">{title}</div>
        <div className="workspace-resolving-desc">{description}</div>
      </div>
    </div>
  );
}
