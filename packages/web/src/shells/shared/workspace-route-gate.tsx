import type { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  activeWorkspaceAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';

export function WorkspaceRouteGate({ children }: { children: ReactNode }) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const loadState = useAtomValue(workspacesLoadStateAtom);
  const loadError = useAtomValue(workspacesLoadErrorAtom);
  const shouldHoldForResolution = !workspace && (loadState === 'idle' || loadState === 'loading');

  if (!workspace && loadState === 'error') {
    return (
      <div className="workspace-resolving-shell">
        <div className="workspace-resolving-card">
          <div className="workspace-resolving-kicker">Workspace</div>
          <div className="workspace-resolving-title">Failed to load workspaces</div>
          <div className="workspace-resolving-desc">{loadError ?? 'Failed to fetch workspace list'}</div>
        </div>
      </div>
    );
  }

  if (shouldHoldForResolution) {
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

  return <>{children}</>;
}
