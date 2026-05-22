/**
 * Git State Management
 *
 * Server-state projection atoms. Written only by WS event handlers.
 */

import type { GitBranch, GitStatus, WorktreeInfo } from "@coder-studio/core";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";

/**
 * Git branch list state per workspace
 */
export interface GitBranchList {
  current: string;
  branches: GitBranch[];
  loading: boolean;
  error?: string;
}

/**
 * Quick Pick UI state for branch switching
 */
export interface BranchQuickPickState {
  visible: boolean;
  workspaceId?: string;
  inputValue: string;
  selectedBranch?: string;
}

/**
 * Git state by workspace (server state projection)
 * Written by: WS event handler for workspace.*.git.state
 */
export const gitStateAtomFamily = atomFamily((_workspaceId: string) =>
  atom<GitStatus | null>(null)
);

export interface GitDiffPreview {
  path: string;
  diff: string;
  renderAs?: "text" | "image";
  status?: "modified" | "added" | "deleted";
  originalContent?: string;
  modifiedContent?: string;
  originalRevision?: "HEAD" | "INDEX";
  modifiedRevision?: "INDEX" | "WORKTREE";
  staged?: boolean;
  source?: "file" | "commit";
  title?: string;
}

export const gitDiffPreviewAtomFamily = atomFamily((_workspaceId: string) =>
  atom<GitDiffPreview | null>(null)
);

export const gitDiffPreviewDismissedAtomFamily = atomFamily((_workspaceId: string) => atom(false));

/**
 * Has changes (derived)
 */
export const hasGitChangesAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const status = get(gitStateAtomFamily(workspaceId));
    if (!status) return false;
    return (
      status.staged.length > 0 ||
      status.modified.length > 0 ||
      status.untracked.length > 0 ||
      status.deleted.length > 0
    );
  })
);

/**
 * Change count summary (derived)
 */
export const gitChangeCountAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    const status = get(gitStateAtomFamily(workspaceId));
    if (!status) return { staged: 0, unstaged: 0, untracked: 0, total: 0 };
    return {
      staged: status.staged.length,
      unstaged: status.modified.length + status.deleted.length,
      untracked: status.untracked.length,
      total:
        status.staged.length +
        status.modified.length +
        status.untracked.length +
        status.deleted.length,
    };
  })
);

/**
 * Git branch list per workspace.
 * Loaded on demand by branch-related UI commands.
 */
export const gitBranchListAtomFamily = atomFamily((_workspaceId: string) =>
  atom<GitBranchList>({
    current: "",
    branches: [],
    loading: false,
  })
);

/**
 * Quick Pick UI state for branch switching (global)
 */
export const branchQuickPickAtom = atom<BranchQuickPickState>({
  visible: false,
  inputValue: "",
});

/**
 * Persisted commit message draft per workspace.
 * Survives panel remount and full page reload via localStorage.
 */
export const commitMessageDraftAtomFamily = atomFamily((workspaceId: string) =>
  atomWithStorage<string>(`coder-studio:git-commit-draft:${workspaceId}`, "")
);

/**
 * Worktree list state per workspace.
 * Server projection — written by event-driven refresh in providers, read by UI.
 */
export interface WorktreeListState {
  items: WorktreeInfo[];
  loading: boolean;
  error?: string;
  lastLoadedAt?: number;
}

export const worktreeListAtomFamily = atomFamily((_workspaceId: string) =>
  atom<WorktreeListState>({ items: [], loading: false })
);

/**
 * Manual fetch state per workspace.
 * Tracks button busy state and last successful fetch timestamp for tooltip display.
 */
export interface GitFetchState {
  status: "idle" | "fetching" | "error";
  lastFetchAt?: number;
  error?: string;
}

export const gitFetchAtomFamily = atomFamily((_workspaceId: string) =>
  atom<GitFetchState>({ status: "idle" })
);
