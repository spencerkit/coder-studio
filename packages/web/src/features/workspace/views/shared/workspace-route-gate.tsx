import type { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import {
  activeWorkspaceAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../../../atoms/workspaces';
import { WorkspaceEmptyState } from './workspace-empty-state';
import { WorkspaceLoadingState } from './workspace-loading-state';

export function WorkspaceRouteGate({ children }: { children: ReactNode }) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const loadState = useAtomValue(workspacesLoadStateAtom);
  const loadError = useAtomValue(workspacesLoadErrorAtom);
  const shouldHoldForResolution = !workspace && (loadState === 'idle' || loadState === 'loading');

  if (!workspace && loadState === 'error') {
    return <WorkspaceEmptyState description={loadError ?? 'Failed to fetch workspace list'} />;
  }

  if (shouldHoldForResolution) {
    return <WorkspaceLoadingState />;
  }

  return <>{children}</>;
}
