import type { ExecTarget, WorktreeInfo } from "../../state/workbench.ts";
import type {
  BackendSessionHistoryRecord,
  ClaudeSlashSkillEntry,
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
  WorkspaceViewPatch,
} from "../../types/app.ts";
import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller.ts";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller.ts";
import { mapSessionHistoryRecord } from "../../features/workspace/session-history.ts";
import { fireAndForgetRpc, invokeRpc } from "./client.ts";

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
) => invokeRpc("workspace_controller_heartbeat", {
  workspaceId,
  deviceId,
  clientId,
});

export const requestWorkspaceTakeover = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => invokeRpc("workspace_controller_takeover", {
  workspaceId,
  deviceId,
  clientId,
});

export const rejectWorkspaceTakeover = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
) => invokeRpc("workspace_controller_reject_takeover", {
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

export const listClaudeSlashSkills = (cwd: string) =>
  invokeRpc<ClaudeSlashSkillEntry[]>("claude_slash_skills", { cwd });
