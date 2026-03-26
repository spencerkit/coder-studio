import type { ExecTarget, WorktreeInfo } from "../../state/workbench.ts";
import type {
  ClaudeSlashSkillEntry,
  GitStatus,
  WorkbenchBootstrap,
  WorkbenchLayout,
  WorkbenchUiState,
  WorktreeDetail,
  WorkspaceLaunchResult,
  WorkspaceSnapshot,
  WorkspaceTree,
  WorkspaceViewPatch,
} from "../../types/app.ts";
import { invokeRpc } from "./client.ts";

export const launchWorkspace = (source: {
  kind: "remote" | "local";
  pathOrUrl: string;
  target: ExecTarget;
}) => invokeRpc<WorkspaceLaunchResult>("launch_workspace", { source });

export const getWorkbenchBootstrap = () => invokeRpc<WorkbenchBootstrap>("workbench_bootstrap", {});

export const getWorkspaceSnapshot = (workspaceId: string) =>
  invokeRpc<WorkspaceSnapshot>("workspace_snapshot", { workspaceId });

export const activateWorkspace = (workspaceId: string) =>
  invokeRpc<WorkbenchUiState>("activate_workspace", { workspaceId });

export const closeWorkspace = (workspaceId: string) =>
  invokeRpc<WorkbenchUiState>("close_workspace", { workspaceId });

export const updateWorkbenchLayout = (layout: WorkbenchLayout) =>
  invokeRpc<WorkbenchUiState>("update_workbench_layout", { layout });

export const updateWorkspaceView = (workspaceId: string, patch: WorkspaceViewPatch) =>
  invokeRpc<void>("workspace_view_update", { workspaceId, patch });

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
