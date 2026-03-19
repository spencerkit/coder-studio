import type { ExecTarget, WorktreeInfo } from "../../state/workbench";
import type { ClaudeSlashSkillEntry, GitStatus, TabSnapshot, WorktreeDetail, WorkspaceInfo, WorkspaceTree } from "../../types/app";
import { invokeRpc } from "./client";

export const initWorkspace = (source: {
  tabId: string;
  kind: "remote" | "local";
  pathOrUrl: string;
  target: ExecTarget;
}) => invokeRpc<WorkspaceInfo>("init_workspace", { source });

export const getTabSnapshot = (tabId: string) => invokeRpc<TabSnapshot>("tab_snapshot", { tabId });

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
