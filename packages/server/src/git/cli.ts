/**
 * Git CLI operations - Wrapper around git commands.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { GitStatus, GitFileChange } from '@coder-studio/core';

const execFileAsync = promisify(execFile);

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
    ahead = parseInt(aheadBehindMatch[1], 10);
    behind = parseInt(aheadBehindMatch[2], 10);
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
  await runGit(cwd, ['checkout', '--', ...paths]);
}

/**
 * Create a commit.
 */
export async function commitChanges(cwd: string, message: string): Promise<{ sha: string }> {
  const { stdout } = await runGit(cwd, ['commit', '-m', message]);

  // Extract SHA from output
  const match = stdout.match(/\[.* ([a-f0-9]+)\]/);
  const sha = match ? match[1] : '';

  return { sha };
}
