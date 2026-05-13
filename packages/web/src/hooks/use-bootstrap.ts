import type { Workspace } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authEnabledAtom, connectionStatusAtom, dispatchCommandAtom } from "../atoms";
import { activationStatusAtom } from "../atoms/activation";
import { authenticatedAtom } from "../atoms/app-ui";
import {
  orderedWorkspacesAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";

export function useBootstrap() {
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const activationStatus = useAtomValue(activationStatusAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

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

    if (activationStatus !== "active") {
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

      dispatch<Workspace[]>("workspace.list", {})
        .then((result) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }

          if (!result.ok) {
            setWorkspacesLoadState("error");
            setWorkspacesLoadError(result.error?.message ?? "Failed to fetch workspace list");
            return;
          }

          const nextWorkspaces = Array.isArray(result.data) ? result.data : [];
          const wsMap: Record<string, Workspace> = {};
          for (const workspace of nextWorkspaces) {
            wsMap[workspace.id] = workspace;
          }

          setWorkspaces(wsMap);
          setWorkspaceOrder(nextWorkspaces.map((workspace) => workspace.id));
          setWorkspacesLoadState("ready");
          setWorkspacesLoadError(null);
        })
        .catch((error) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspacesLoadState("error");
          setWorkspacesLoadError(
            error instanceof Error ? error.message : "Failed to fetch workspace list"
          );
        });
      return;
    }

    if (workspacesLoadState !== "ready") {
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
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    workspaces.length,
    workspacesLoadState,
  ]);
}
