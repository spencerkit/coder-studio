import type { Workspace, WorkspaceLastViewedTarget } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authEnabledAtom, connectionStatusAtom, dispatchCommandAtom } from "../atoms";
import { activationStatusAtom } from "../atoms/activation";
import { authenticatedAtom, lastViewedTargetAtom } from "../atoms/app-ui";
import {
  activeWorkspaceIdAtom,
  orderedWorkspacesAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import {
  normalizePaneLayout,
  paneLayoutAtomFamily,
} from "../features/agent-panes/atoms/pane-layout";
import {
  hydrateWorkspaceEditorState,
  normalizeWorkspaceEditorUiState,
} from "../features/workspace/actions/open-editor-state";
import { useTranslation } from "../lib/i18n";

interface BootstrapWorkspaceState {
  savedTarget: WorkspaceLastViewedTarget | null;
  workspaces: Record<string, Workspace>;
  workspaceOrder: string[];
}

export function useBootstrap() {
  const t = useTranslation();
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const activationStatus = useAtomValue(activationStatusAtom);
  const activationStatusRef = useRef(activationStatus);
  const prefetchedWorkspaceStateRef = useRef<BootstrapWorkspaceState | null>(null);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setLastViewedTarget = useSetAtom(lastViewedTargetAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);
  const store = useStore();

  useEffect(() => {
    activationStatusRef.current = activationStatus;
  }, [activationStatus]);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    // Auth guard: redirect to login if auth required but not authenticated
    const authRequired = authEnabled === true;
    if (authRequired && !authenticated) {
      // Allow /login path, redirect all other paths to login
      if (location.pathname !== "/login") {
        navigate("/login", { replace: true });
        return;
      }
      return;
    }

    // Redirect from login if already authenticated or auth not required
    if (location.pathname === "/login" && (!authRequired || authenticated)) {
      navigate("/", { replace: true });
      return;
    }

    if (location.pathname === "/session-gate") {
      return;
    }

    if (activationStatus === "gated") {
      navigate("/session-gate", { replace: true });
      return;
    }

    // Only bootstrap workspaces on "/" and "/workspace" paths
    if (location.pathname !== "/" && location.pathname !== "/workspace") {
      return;
    }

    const commitBootstrapState = (nextState: BootstrapWorkspaceState) => {
      prefetchedWorkspaceStateRef.current = null;
      setWorkspaces(nextState.workspaces);
      setWorkspaceOrder(nextState.workspaceOrder);
      setLastViewedTarget(nextState.savedTarget);
      if (nextState.savedTarget?.workspaceId) {
        setActiveWorkspaceId(nextState.savedTarget.workspaceId);
      }
      setWorkspacesLoadState("ready");
      setWorkspacesLoadError(null);
    };

    const buildBootstrapState = (
      listResult: { ok: boolean; data?: Workspace[]; error?: { message: string } },
      targetResult: {
        ok: boolean;
        data?: WorkspaceLastViewedTarget | null;
      }
    ): BootstrapWorkspaceState => {
      const nextWorkspaces = (Array.isArray(listResult.data) ? listResult.data : []).map(
        (workspace) => ({
          ...workspace,
          uiState: normalizeWorkspaceEditorUiState(workspace.uiState),
        })
      );
      const wsMap: Record<string, Workspace> = {};
      for (const workspace of nextWorkspaces) {
        wsMap[workspace.id] = workspace;
        hydrateWorkspaceEditorState(store, workspace.id, workspace.uiState);
        const paneLayout = normalizePaneLayout(workspace.uiState?.paneLayout);
        if (paneLayout) {
          store.set(paneLayoutAtomFamily(workspace.id), paneLayout);
        }
      }

      const savedTarget =
        targetResult.ok && targetResult.data && wsMap[targetResult.data.workspaceId]
          ? targetResult.data
          : null;

      return {
        savedTarget,
        workspaces: wsMap,
        workspaceOrder: nextWorkspaces.map((workspace) => workspace.id),
      };
    };

    if (workspacesLoadState === "loading") {
      if (activationStatus === "active" && prefetchedWorkspaceStateRef.current) {
        commitBootstrapState(prefetchedWorkspaceStateRef.current);
      }
      return;
    }

    // Workspace bootstrap logic
    if (workspacesLoadState === "idle") {
      if (connectionStatus !== "connected") {
        return;
      }

      const requestId = bootstrapRequestIdRef.current + 1;
      bootstrapRequestIdRef.current = requestId;

      setWorkspacesLoadState("loading");
      setWorkspacesLoadError(null);

      Promise.all([
        dispatch<Workspace[]>("workspace.list", {}),
        dispatch<WorkspaceLastViewedTarget | null>("workspace.lastViewedTarget.get", {}),
      ])
        .then((result) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }

          const [listResult, targetResult] = result;

          if (!listResult.ok) {
            prefetchedWorkspaceStateRef.current = null;
            setWorkspacesLoadState("error");
            setWorkspacesLoadError(
              listResult.error?.message ?? t("workspace.load_failed_description")
            );
            return;
          }

          const nextState = buildBootstrapState(listResult, targetResult);
          prefetchedWorkspaceStateRef.current = nextState;
          if (activationStatusRef.current === "active") {
            commitBootstrapState(nextState);
          }
        })
        .catch((error) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }
          prefetchedWorkspaceStateRef.current = null;
          setWorkspacesLoadState("error");
          setWorkspacesLoadError(
            error instanceof Error ? error.message : t("workspace.load_failed_description")
          );
        });
      return;
    }

    if (workspacesLoadState !== "ready") {
      return;
    }

    if (activationStatus !== "active") {
      return;
    }

    // Route based on workspace state
    if (location.pathname === "/" && workspaces.length > 0) {
      navigate("/workspace", { replace: true });
      return;
    }

    if (location.pathname === "/workspace" && workspaces.length === 0) {
      navigate("/", { replace: true });
    }
  }, [
    activationStatus,
    authEnabled,
    authenticated,
    connectionStatus,
    dispatch,
    location.pathname,
    navigate,
    setWorkspaceOrder,
    setWorkspaces,
    setActiveWorkspaceId,
    setLastViewedTarget,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    store,
    t,
    workspaces.length,
    workspacesLoadState,
  ]);
}
