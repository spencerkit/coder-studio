/**
 * Git CLI operations - Wrapper around git commands.
 */

import { execFile } from 'child_process';
import type { GitStatus, GitFileChange } from '@coder-studio/core';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Executes a git command in the specified working directory.
 *
 * @param cwd - Working directory
 * @param args - Git command arguments
 * @returns Command output
 */
export async function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new GitError(err.message, stderr));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Error thrown when git command fails.
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Get git status for a workspace.
 */
export async function getGitStatus(cwd: string): Promise<GitStatus> {
  // Get porcelain status
  const { stdout: statusOutput } = await runGit(cwd, ['status', '--porcelain=v2', '--branch']);

  // Get branch name and ahead/behind
  const { stdout: branchOutput } = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchOutput.trim();

  // Parse ahead/behind
  let ahead = 0;
  let behind = 0;
  const aheadBehindMatch = statusOutput.match(/branch\.ab \+(\d+) -(\d+)/);
  if (aheadBehindMatch) {
    ahead = parseInt(aheadBehindMatch[1] ?? '0', 10);
    behind = parseInt(aheadBehindMatch[2] ?? '0', 10);
  }

  // Parse file changes
  const staged: GitFileChange[] = [];
  const modified: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const deleted: GitFileChange[] = [];

  const lines = statusOutput.split('\n');
  for (const line of lines) {
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Ordinary or renamed file
      const parts = line.split(' ');
      const xy = parts[1];
      const path = parts[parts.length - 1];
      if (!xy || !path) {
        continue;
      }

      const x = xy[0]; // Staged status
      const y = xy[1]; // Unstaged status

      if (x === 'A' || x === 'M' || x === 'D' || x === 'R' || x === 'C') {
        staged.push({ path });
      }
      if (y === 'M' || y === 'D') {
        if (y === 'D') {
          deleted.push({ path });
        } else {
          modified.push({ path });
        }
      }
    } else if (line.startsWith('? ')) {
      // Untracked file
      const path = line.substring(2);
      untracked.push({ path });
    }
  }

  return {
    branch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    deleted,
  };
}

/**
 * Get compact git status text for supervisor evaluation prompts.
 */
export async function getGitStatusSummary(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['status', '--short']);
  return stdout.trim();
}

/**
 * Get compact git diff stats for supervisor evaluation prompts.
 */
export async function getGitDiffStatSummary(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['diff', '--stat']);
  return stdout.trim();
}

/**
 * Stage files for commit.
 */
export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(cwd, ['add', ...paths]);
}

/**
 * Unstage files.
 */
export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(cwd, ['reset', 'HEAD', '--', ...paths]);
}

/**
 * Discard changes to files.
 */
export async function discardChanges(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const trackedPaths: string[] = [];
  const untrackedPaths: string[] = [];

  for (const path of paths) {
    try {
      await runGit(cwd, ['ls-files', '--error-unmatch', '--', path]);
      trackedPaths.push(path);
    } catch {
      untrackedPaths.push(path);
    }
  }

  if (trackedPaths.length > 0) {
    await runGit(cwd, ['restore', '--staged', '--worktree', '--', ...trackedPaths]);
  }

  if (untrackedPaths.length > 0) {
    await runGit(cwd, ['clean', '-fd', '--', ...untrackedPaths]);
  }
}

/**
 * Create a commit.
 */
export async function commitChanges(cwd: string, message: string): Promise<{ sha: string }> {
  const { stdout } = await runGit(cwd, ['commit', '-m', message]);

  // Extract SHA from output
  const match = stdout.match(/\[.* ([a-f0-9]+)\]/);
  const sha = match?.[1] ?? '';

  return { sha };
}

/**
 * Push changes to remote.
 */
export async function runGitPush(
  cwd: string,
  options?: {
    remote?: string;
    branch?: string;
    force?: boolean;
  }
): Promise<{ success: boolean; message: string }> {
  const args = ['push'];

  if (options?.force) {
    args.push('--force');
  }

  if (options?.remote && options?.branch) {
    args.push(options.remote, options.branch);
  } else if (options?.branch) {
    args.push('origin', options.branch);
  }

  const { stdout, stderr } = await runGit(cwd, args);

  // Combine output for message
  const message = stdout || stderr || 'Push completed successfully';

  return { success: true, message };
}

/**
 * Pull changes from remote.
 */
export async function runGitPull(
  cwd: string,
  options?: {
    remote?: string;
    branch?: string;
  }
): Promise<{ success: boolean; message: string; updatedFiles?: string[] }> {
  const args = ['pull'];

  if (options?.remote && options?.branch) {
    args.push(options.remote, options.branch);
  } else if (options?.branch) {
    args.push('origin', options.branch);
  }

  const { stdout, stderr } = await runGit(cwd, args);

  // Parse updated files from output
  const updatedFiles: string[] = [];
  const fileMatches = stdout.matchAll(/Updating\s+([a-f0-9]+)\.\.\.([a-f0-9]+)\nFast-forward\n([\s\S]*)/g);
  for (const match of fileMatches) {
    const filesSection = match[3] ?? '';
    const fileLines = filesSection.split('\n').filter(line => line.trim());
    for (const line of fileLines) {
      const fileMatch = line.match(/^\s+\S+\s+(\S+)/);
      if (fileMatch && fileMatch[1]) {
        updatedFiles.push(fileMatch[1]);
      }
    }
  }

  const message = stdout || stderr || 'Pull completed successfully';

  return { success: true, message, updatedFiles };
}

/**
 * Checkout a branch or commit.
 */
export async function runGitCheckout(
  cwd: string,
  ref: string,
  options?: {
    createBranch?: boolean;
  }
): Promise<{ success: boolean; message: string; branch?: string }> {
  const args = ['checkout'];

  if (options?.createBranch) {
    args.push('-b');
  }

  args.push(ref);

  const { stdout, stderr } = await runGit(cwd, args);

  // Extract branch name from output
  const branchMatch = stdout.match(/Switched to (?:a new branch|branch) '([^']+)'/);
  const branch = branchMatch?.[1] ?? ref;

  const message = stdout || stderr || `Checkout to ${ref} completed`;

  return { success: true, message, branch };
}

/**
 * Create a new branch.
 */
export async function runGitCreateBranch(
  cwd: string,
  branchName: string,
  options?: {
    startPoint?: string;
  }
): Promise<{ success: boolean; message: string; branch: string }> {
  const args = ['branch', branchName];

  if (options?.startPoint) {
    args.push(options.startPoint);
  }

  await runGit(cwd, args);

  return { success: true, message: `Branch '${branchName}' created`, branch: branchName };
}

/**
 * List all branches.
 */
export async function runGitListBranches(cwd: string): Promise<{ branches: string[]; current: string }> {
  const { stdout } = await runGit(cwd, ['branch', '--list']);

  const branches: string[] = [];
  let current = '';

  const lines = stdout.split('\n').filter(line => line.trim());
  for (const line of lines) {
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();
    branches.push(name);
    if (isCurrent) {
      current = name;
    }
  }

  return { branches, current };
}
