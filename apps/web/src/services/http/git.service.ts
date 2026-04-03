import type { WorkspaceControllerState } from "../../features/workspace/workspace-controller";
import { createWorkspaceControllerRpcPayload } from "../../features/workspace/workspace-controller";
import type { ExecTarget } from "../../state/workbench";
import type { GitChangeEntry, GitFileDiffPayload } from "../../types/app";
import { invokeRpc } from "./client";

export const getGitChanges = (path: string, target: ExecTarget) =>
  invokeRpc<GitChangeEntry[]>("git_changes", { path, target });

export const getGitDiff = (path: string, target: ExecTarget) =>
  invokeRpc<string>("git_diff", { path, target });

export const getGitDiffFile = (path: string, target: ExecTarget, filePath: string, staged: boolean) =>
  invokeRpc<string>("git_diff_file", { path, target, filePath, staged });

export const getGitFileDiffPayload = (path: string, target: ExecTarget, filePath: string, section: string) =>
  invokeRpc<GitFileDiffPayload>("git_file_diff_payload", { path, target, filePath, section });

export const stageGitFile = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
  filePath: string,
) => invokeRpc<void>(
  "git_stage_file",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target, filePath }),
);

export const unstageGitFile = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
  filePath: string,
) => invokeRpc<void>(
  "git_unstage_file",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target, filePath }),
);

export const discardGitFile = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
  filePath: string,
  section: string,
) => invokeRpc<void>(
  "git_discard_file",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target, filePath, section }),
);

export const stageAllGitChanges = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
) => invokeRpc<void>(
  "git_stage_all",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target }),
);

export const unstageAllGitChanges = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
) => invokeRpc<void>(
  "git_unstage_all",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target }),
);

export const discardAllGitChanges = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
) => invokeRpc<void>(
  "git_discard_all",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target }),
);

export const commitGitChanges = (
  workspaceId: string,
  controller: WorkspaceControllerState,
  path: string,
  target: ExecTarget,
  message: string,
) => invokeRpc<string>(
  "git_commit",
  createWorkspaceControllerRpcPayload(workspaceId, controller, { path, target, message }),
);
