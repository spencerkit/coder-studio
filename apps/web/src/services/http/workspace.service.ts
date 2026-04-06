import type { ExecTarget, WorktreeInfo } from "../../state/workbench";
import type { AgentProvider } from "../../types/app";
import type {
  BackendSessionHistoryRecord,
  BackendWorkspaceSupervisorBinding,
  BackendWorkspaceSupervisorCycle,
  GitStatus,
  SessionHistoryRecord,
  WorkbenchBootstrap,
  WorkbenchLayout,
  WorkbenchUiState,
  WorktreeDetail,
  WorkspaceLaunchResult,
  WorkspaceRuntimeSnapshot,
  WorkspaceSnapshot,
  WorkspaceTree,
  WorkspaceControllerLease,
  WorkspaceViewPatch,
} from "../../types/app";
import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller";
import { mapSessionHistoryRecord } from "../../features/workspace/session-history";
import { fireAndForgetRpc, invokeRpc } from "./client";
import { sendWsMessage } from "../../ws/client";
import { sendWsMutationWithNullableHttpFallback } from "./ws-rpc-fallback";

export const launchWorkspace = (source: {
  kind: "remote" | "local";
  pathOrUrl: string;
  target: ExecTarget;
}, deviceId?: string, clientId?: string) => invokeRpc<WorkspaceLaunchResult>("launch_workspace", {
  source,
  deviceId,
  clientId,
});

export const getWorkbenchBootstrap = (deviceId?: string, clientId?: string) =>
  invokeRpc<WorkbenchBootstrap>("workbench_bootstrap", { deviceId, clientId });

export const listSessionHistory = async () => (
  (await invokeRpc<BackendSessionHistoryRecord[]>("list_session_history", {})).map(mapSessionHistoryRecord)
) as SessionHistoryRecord[];

export const getWorkspaceSnapshot = (workspaceId: string) =>
  invokeRpc<WorkspaceSnapshot>("workspace_snapshot", { workspaceId });

export const attachWorkspaceRuntime = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => invokeRpc<WorkspaceRuntimeSnapshot>("workspace_runtime_attach", {
  workspaceId,
  deviceId,
  clientId,
});

export const heartbeatWorkspaceController = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => sendWsMutationWithNullableHttpFallback(
  () => sendWsMessage({
    type: "workspace_controller_heartbeat",
    workspace_id: workspaceId,
  }),
  () => invokeRpc<WorkspaceControllerLease>("workspace_controller_heartbeat", {
    workspaceId,
    deviceId,
    clientId,
  }),
);

export const requestWorkspaceTakeover = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => invokeRpc<WorkspaceControllerLease>("workspace_controller_takeover", {
  workspaceId,
  deviceId,
  clientId,
});

export const rejectWorkspaceTakeover = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => invokeRpc<WorkspaceControllerLease>("workspace_controller_reject_takeover", {
  workspaceId,
  deviceId,
  clientId,
});

export const activateWorkspace = (workspaceId: string, deviceId?: string, clientId?: string) =>
  invokeRpc<WorkbenchUiState>("activate_workspace", { workspaceId, deviceId, clientId });

export const closeWorkspace = (
  workspaceId: string,
  controller: WorkspaceControllerState,
) => invokeRpc<WorkbenchUiState>("close_workspace", createWorkspaceControllerRpcPayload(workspaceId, controller));

export const updateWorkbenchLayout = (layout: WorkbenchLayout, deviceId?: string, clientId?: string) =>
  invokeRpc<WorkbenchUiState>("update_workbench_layout", { layout, deviceId, clientId });

export const updateWorkspaceView = (
  workspaceId: string,
  patch: WorkspaceViewPatch,
  controller: WorkspaceControllerState,
) => invokeRpc<void>("workspace_view_update", createWorkspaceControllerRpcPayload(workspaceId, controller, { patch }));

export const enableSupervisorMode = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
  provider: AgentProvider,
  objectiveText: string,
) => invokeRpc<BackendWorkspaceSupervisorBinding>(
  "enable_supervisor_mode",
  createWorkspaceControllerRpcPayload(workspaceId, controller, {
    sessionId,
    provider,
    objectiveText,
  }),
);

export const updateSupervisorObjective = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
  objectiveText: string,
) => invokeRpc<BackendWorkspaceSupervisorBinding>(
  "update_supervisor_objective",
  createWorkspaceControllerRpcPayload(workspaceId, controller, {
    sessionId,
    objectiveText,
  }),
);

export const pauseSupervisorMode = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<BackendWorkspaceSupervisorBinding>(
  "pause_supervisor_mode",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const resumeSupervisorMode = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<BackendWorkspaceSupervisorBinding>(
  "resume_supervisor_mode",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const disableSupervisorMode = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<void>(
  "disable_supervisor_mode",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const retrySupervisorCycle = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  sessionId: string,
) => invokeRpc<BackendWorkspaceSupervisorCycle>(
  "retry_supervisor_cycle",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { sessionId }),
);

export const releaseWorkspaceControllerKeepalive = (
  workspaceId: string,
  controller: WorkspaceControllerState,
) => fireAndForgetRpc("workspace_controller_release", createWorkspaceControllerRpcPayload(workspaceId, controller));

export const getWorkspaceTree = (path: string, target: ExecTarget, depth = 4) =>
  invokeRpc<WorkspaceTree>("workspace_tree", { path, target, depth });

export const getWorktreeList = (path: string, target: ExecTarget) =>
  invokeRpc<WorktreeInfo[]>("worktree_list", { path, target });

export const inspectWorktree = (path: string, target: ExecTarget, depth = 4) =>
  invokeRpc<WorktreeDetail>("worktree_inspect", { path, target, depth });

export const getGitStatus = (path: string, target: ExecTarget) =>
  invokeRpc<GitStatus>("git_status", { path, target });
