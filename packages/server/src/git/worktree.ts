/**
 * Git Worktree operations (Phase 3)
 *
 * Wrapper around git worktree commands.
 */

import path from "node:path";
import type { FileNode, GitStatus, WorktreeInfo } from "@coder-studio/core";
import { GitError, runGit } from "./cli.js";
import { parseStatus } from "./status-parser.js";

function normalizeWorktreePath(worktreePath: string): string {
  return path.resolve(worktreePath);
}

export async function getGitCommonDirPath(repoPath: string): Promise<string> {
  const { stdout } = await runGit(repoPath, ["rev-parse", "--git-common-dir"]);
  return normalizeWorktreePath(path.resolve(repoPath, stdout.trim()));
}

export async function resolveWorktreePath(repoPath: string, worktreePath: string): Promise<string> {
  const normalizedRequested = normalizeWorktreePath(worktreePath);
  const worktrees = await listWorktrees(repoPath);
  const matched = worktrees.find(
    (worktree) => normalizeWorktreePath(worktree.path) === normalizedRequested
  );

  if (!matched) {
    throw {
      code: "worktree_not_found",
      message: `Worktree not found for repository: ${worktreePath}`,
    };
  }

  return matched.path;
}

/**
 * List all worktrees for a repository.
 *
 * @param repoPath - Path to the main repository
 * @returns Array of worktree information
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await runGit(repoPath, ["worktree", "list", "--porcelain"]);

    const worktrees: WorktreeInfo[] = [];
    const lines = stdout.split("\n");

    let current: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = { path: line.substring(9) };
      } else if (line.startsWith("HEAD ")) {
        current.commit = line.substring(5).substring(0, 7);
      } else if (line.startsWith("branch ")) {
        const branch = line.substring(7);
        current.branch = branch;
        current.name = branch.split("/").pop() || branch;
      } else if (line === "detached") {
        current.branch = "detached HEAD";
      } else if (line === "") {
        // Empty line might indicate end of record
        if (current.path) {
          // Check if dirty by running status
          worktrees.push(current as WorktreeInfo);
          current = {};
        }
      }
    }

    // Don't forget the last one
    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    // Check dirty status for each worktree
    for (const wt of worktrees) {
      try {
        const status = await getWorktreeStatus(wt.path);
        wt.status =
          status.staged.length > 0 ||
          status.modified.length > 0 ||
          status.untracked.length > 0 ||
          status.deleted.length > 0
            ? "dirty"
            : "clean";
      } catch {
        wt.status = "clean";
      }
    }

    return worktrees;
  } catch (error) {
    if (error instanceof GitError) {
      throw new Error(`Failed to list worktrees: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get git status for a specific worktree.
 *
 * @param worktreePath - Path to the worktree
 * @returns Git status information
 */
export async function getWorktreeStatus(worktreePath: string): Promise<GitStatus> {
  const { stdout } = await runGit(worktreePath, [
    "status",
    "--porcelain=v2",
    "-z",
    "--branch",
    "--untracked-files=all",
  ]);
  return parseStatus(stdout);
}

/**
 * Get diff for a worktree.
 *
 * @param worktreePath - Path to the worktree
 * @param staged - Whether to show staged changes
 * @returns Diff output as string
 */
export async function getWorktreeDiff(worktreePath: string, staged = false): Promise<string> {
  const args = ["diff"];
  if (staged) {
    args.push("--staged");
  }
  const { stdout } = await runGit(worktreePath, args);
  return stdout;
}

/**
 * Get file tree for a worktree.
 * This is a simplified version that lists top-level files and directories.
 *
 * @param worktreePath - Path to the worktree
 * @returns File tree structure
 */
export async function getWorktreeTree(worktreePath: string): Promise<FileNode[]> {
  const { stdout } = await runGit(worktreePath, ["ls-tree", "-l", "--name-only", "HEAD"]);

  const nodes: FileNode[] = [];
  const lines = stdout.split("\n").filter(Boolean);

  for (const line of lines) {
    const isDir = line.endsWith("/");
    const name = isDir ? line.slice(0, -1) : line;
    const path = `${worktreePath}/${name}`;

    nodes.push({
      name,
      path,
      kind: isDir ? "dir" : "file",
    });
  }

  return nodes;
}

/**
 * Create a new worktree.
 *
 * @param repoPath - Path to the main repository
 * @param branch - Branch name for the new worktree
 * @param path - Path where the worktree should be created
 * @returns The created worktree info
 */
export async function createWorktree(
  repoPath: string,
  branch: string,
  worktreePath: string
): Promise<WorktreeInfo> {
  let createArgs = ["worktree", "add", worktreePath, branch];
  try {
    await runGit(repoPath, ["rev-parse", "--verify", "--quiet", `${branch}^{commit}`]);
  } catch (error) {
    if (error instanceof GitError) {
      createArgs = ["worktree", "add", "-b", branch, worktreePath];
    } else {
      throw error;
    }
  }

  await runGit(repoPath, createArgs);

  const worktrees = await listWorktrees(repoPath);
  const normalizedRequested = normalizeWorktreePath(worktreePath);
  const created = worktrees.find((wt) => normalizeWorktreePath(wt.path) === normalizedRequested);

  if (!created) {
    throw new Error("Failed to find created worktree");
  }

  return created;
}

/**
 * Remove a worktree.
 *
 * @param repoPath - Path to the main repository
 * @param worktreePath - Path to the worktree to remove
 * @param force - Force removal even if there are uncommitted changes
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (force) {
    args.push("--force");
  }
  await runGit(repoPath, args);
}
