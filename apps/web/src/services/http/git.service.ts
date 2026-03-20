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

export const stageGitFile = (path: string, target: ExecTarget, filePath: string) =>
  invokeRpc<void>("git_stage_file", { path, target, filePath });

export const unstageGitFile = (path: string, target: ExecTarget, filePath: string) =>
  invokeRpc<void>("git_unstage_file", { path, target, filePath });

export const discardGitFile = (path: string, target: ExecTarget, filePath: string, section: string) =>
  invokeRpc<void>("git_discard_file", { path, target, filePath, section });

export const stageAllGitChanges = (path: string, target: ExecTarget) =>
  invokeRpc<void>("git_stage_all", { path, target });

export const unstageAllGitChanges = (path: string, target: ExecTarget) =>
  invokeRpc<void>("git_unstage_all", { path, target });

export const discardAllGitChanges = (path: string, target: ExecTarget) =>
  invokeRpc<void>("git_discard_all", { path, target });

export const commitGitChanges = (path: string, target: ExecTarget, message: string) =>
  invokeRpc<string>("git_commit", { path, target, message });
