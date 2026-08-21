import { useAtomValue } from "jotai";
import { type ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  activeWorkspaceAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../../../atoms/workspaces";
import { useTranslation } from "../../../../lib/i18n";
import { logStartupTraceOnce } from "../../../../startup-trace";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspaceLoadingState } from "./workspace-loading-state";

export function WorkspaceRouteGate({ children }: { children: ReactNode }) {
  const t = useTranslation();
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
  useEffect(() => {
    if (!shouldHoldForResolution) {
      return;
    }

    logStartupTraceOnce("workspaceRoute:loading_visible", {
      loadState,
      path: location.pathname,
    });
  }, [loadState, location.pathname, shouldHoldForResolution]);

  if (!workspace && loadState === "error") {
    return (
      <WorkspaceEmptyState description={loadError ?? t("workspace.load_failed_description")} />
    );
  }

  if (shouldHoldForResolution) {
    return <WorkspaceLoadingState />;
  }

  return <>{children}</>;
}
