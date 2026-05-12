import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  activeWorkspaceAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../../../atoms/workspaces";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspaceLoadingState } from "./workspace-loading-state";

export function WorkspaceRouteGate({ children }: { children: ReactNode }) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const loadState = useAtomValue(workspacesLoadStateAtom);
  const loadError = useAtomValue(workspacesLoadErrorAtom);
  const location = useLocation();
  const isWorkspaceRoute = location.pathname === "/workspace";
  const shouldHoldForResolution =
    !workspace &&
    (loadState === "idle" ||
      loadState === "loading" ||
      (isWorkspaceRoute && loadState === "ready"));

  if (!workspace && loadState === "error") {
    return <WorkspaceEmptyState description={loadError ?? "Failed to fetch workspace list"} />;
  }

  if (shouldHoldForResolution) {
    return <WorkspaceLoadingState />;
  }

  return <>{children}</>;
}
