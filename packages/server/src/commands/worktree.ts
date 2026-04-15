/**
 * Worktree command handlers (Phase 3)
 */

import { registerCommand } from '../ws/dispatch.js';
import {
  listWorktrees,
  getWorktreeStatus,
  getWorktreeDiff,
  getWorktreeTree,
  createWorktree,
  removeWorktree,
} from '../git/worktree.js';
import type { GitStatus } from '@coder-studio/core';

// Cache for workspace paths
const workspacePaths = new Map<string, string>();

/**
 * Set workspace path for command resolution
 */
export function setWorkspacePath(workspaceId: string, path: string): void {
  workspacePaths.set(workspaceId, path);
}

/**
 * Register worktree command handlers
 */
export function registerWorktreeCommands(): void {
  // worktree.list - List all worktrees for a workspace
  registerCommand('worktree.list', async (args) => {
    const { workspaceId } = args as { workspaceId: string };
    const repoPath = workspacePaths.get(workspaceId);

    if (!repoPath) {
      return { ok: false, error: { code: 'workspace_not_found', message: 'Workspace path not found' } };
    }

    try {
      const worktrees = await listWorktrees(repoPath);
      return { ok: true, data: { worktrees } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'list_failed', message } };
    }
  });

  // worktree.status - Get status for a specific worktree
  registerCommand('worktree.status', async (args) => {
    const { worktreePath } = args as { worktreePath: string };

    try {
      const status = await getWorktreeStatus(worktreePath);
      return { ok: true, data: { status } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'status_failed', message } };
    }
  });

  // worktree.diff - Get diff for a worktree
  registerCommand('worktree.diff', async (args) => {
    const { worktreePath, staged } = args as { worktreePath: string; staged?: boolean };

    try {
      const diff = await getWorktreeDiff(worktreePath, staged);
      return { ok: true, data: { diff } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'diff_failed', message } };
    }
  });

  // worktree.tree - Get file tree for a worktree
  registerCommand('worktree.tree', async (args) => {
    const { worktreePath } = args as { worktreePath: string };

    try {
      const tree = await getWorktreeTree(worktreePath);
      return { ok: true, data: { tree } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'tree_failed', message } };
    }
  });

  // worktree.create - Create a new worktree
  registerCommand('worktree.create', async (args) => {
    const { workspaceId, branch, path } = args as {
      workspaceId: string;
      branch: string;
      path: string;
    };
    const repoPath = workspacePaths.get(workspaceId);

    if (!repoPath) {
      return { ok: false, error: { code: 'workspace_not_found', message: 'Workspace path not found' } };
    }

    try {
      const worktree = await createWorktree(repoPath, branch, path);
      return { ok: true, data: { worktree } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'create_failed', message } };
    }
  });

  // worktree.remove - Remove a worktree
  registerCommand('worktree.remove', async (args) => {
    const { workspaceId, worktreePath, force } = args as {
      workspaceId: string;
      worktreePath: string;
      force?: boolean;
    };
    const repoPath = workspacePaths.get(workspaceId);

    if (!repoPath) {
      return { ok: false, error: { code: 'workspace_not_found', message: 'Workspace path not found' } };
    }

    try {
      await removeWorktree(repoPath, worktreePath, force);
      return { ok: true, data: {} };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { ok: false, error: { code: 'remove_failed', message } };
    }
  });
}
