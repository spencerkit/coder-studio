/**
 * Git CLI operations - Wrapper around git commands.
 */

import { execFile } from 'child_process';
import type { GitStatus, GitFileChange, GitBranch } from '@coder-studio/core';
import { GIT_COMMON_REMOTES } from '../constants/git.js';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

interface RunGitOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

interface GitRemoteBranchTarget {
  remote: string;
  branch: string;
}

const GIT_NETWORK_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Executes a git command in the specified working directory.
 *
 * @param cwd - Working directory
 * @param args - Git command arguments
 * @returns Command output
 */
export async function runGit(
  cwd: string,
  args: string[],
  options: RunGitOptions = {}
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...options.env,
        },
        maxBuffer: 10 * 1024 * 1024,
        timeout: options.timeoutMs,
      },
      (err, stdout, stderr) => {
      if (err) {
        reject(new GitError(err.message, stderr));
      } else {
        resolve({ stdout, stderr });
      }
      }
    );
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
  let remote = options?.remote;
  let branch = options?.branch;

  if (options?.force) {
    args.push('--force');
  }

  if (!remote || !branch) {
    const pushTarget = await resolveRemoteBranchTarget(cwd, 'push');
    remote = remote ?? pushTarget?.remote;
    branch = branch ?? pushTarget?.branch;
  }

  if (!remote || !branch) {
    const upstreamTarget = await resolveRemoteBranchTarget(cwd, 'upstream');
    remote = remote ?? upstreamTarget?.remote;
    branch = branch ?? upstreamTarget?.branch;
  }

  if (!remote && branch) {
    remote = (await getPreferredRemote(cwd)) ?? 'origin';
  }

  if (!remote) {
    remote = (await getPreferredRemote(cwd)) ?? undefined;
  }

  if (remote && branch) {
    args.push(remote, `HEAD:${branch}`);
  } else if (remote) {
    args.push('--set-upstream', remote, 'HEAD');
  }

  const { stdout, stderr } = await runGit(cwd, args, {
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });

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
  let remote = options?.remote;
  let branch = options?.branch;

  if (!remote || !branch) {
    const upstreamTarget = await resolveRemoteBranchTarget(cwd, 'upstream');
    remote = remote ?? upstreamTarget?.remote;
    branch = branch ?? upstreamTarget?.branch;
  }

  if (!remote && branch) {
    remote = (await getPreferredRemote(cwd)) ?? 'origin';
  }

  if (remote && branch) {
    args.push(remote, branch);
  }

  const { stdout, stderr } = await runGit(cwd, args, {
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });

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

  // Detect remote branch refs by querying actual configured remotes
  let isRemoteRef = false;
  try {
    const { stdout: remoteList } = await runGit(cwd, ['remote']);
    const remotes = remoteList.trim().split('\n').filter(Boolean);
    // Check if ref starts with any configured remote (e.g., 'origin/main')
    isRemoteRef = remotes.some(remote => ref.startsWith(`${remote}/`));
  } catch {
    // Fall back to common remotes if git remote fails
    isRemoteRef = GIT_COMMON_REMOTES.some(remote => ref.startsWith(remote));
  }

  // If remote branch ref, auto-create tracking branch
  if (isRemoteRef && !options?.createBranch) {
    const remoteSeparatorIndex = ref.indexOf('/');
    const branchName = remoteSeparatorIndex >= 0 ? ref.slice(remoteSeparatorIndex + 1) : ref;
    args.push('-b', branchName, ref);

    try {
      const { stdout, stderr } = await runGit(cwd, args);
      const message = stdout || stderr || `Checkout to ${ref} completed`;

      // For remote branch checkout, we know the branch name from the ref
      return { success: true, message, branch: branchName };
    } catch (error) {
      return {
        success: false,
        message: `Failed to checkout remote branch '${ref}'`
      };
    }
  } else {
    // Original logic for local branches and createBranch flag
    if (options?.createBranch) {
      args.push('-b');
    }
    args.push(ref);

    try {
      const { stdout, stderr } = await runGit(cwd, args);

      // Extract branch name from output
      const branchMatch = stdout.match(/Switched to (?:a new branch|branch) '([^']+)'/);
      const branch = branchMatch?.[1] ?? ref;

      const message = stdout || stderr || `Checkout to ${ref} completed`;

      return { success: true, message, branch };
    } catch (error) {
      return {
        success: false,
        message: `Failed to checkout '${ref}'`
      };
    }
  }
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
 * List all branches (local and remote) with metadata.
 *
 * @param cwd - Working directory of the git repository
 * @returns Object with branches array and current branch name
 *            - branches: Array of GitBranch objects with metadata
 *            - current: Current branch name (empty string if detached HEAD or no commits)
 * @throws {GitError} If git commands fail (e.g., not a git repository)
 */
export async function runGitListBranches(cwd: string): Promise<{
  branches: GitBranch[];
  current: string;
}> {
  // Get local branches
  const { stdout: localOutput } = await runGit(cwd, ['branch', '--list']);

  // Get remote branches
  const { stdout: remoteOutput } = await runGit(cwd, ['branch', '-r']);

  const branches: GitBranch[] = [];
  let current = '';

  // Parse local branches
  const localLines = localOutput.split('\n').filter(line => line.trim());
  for (const line of localLines) {
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();

    // Skip detached HEAD indicator
    if (name.startsWith('(HEAD detached')) {
      if (isCurrent) {
        current = '';  // Empty string indicates detached state
      }
      continue;  // Don't add to branches array
    }

    branches.push({
      name,
      isRemote: false,
      isCurrent,
    });
    if (isCurrent) {
      current = name;
    }
  }

  // Parse remote branches
  const remoteLines = remoteOutput.split('\n').filter(line => line.trim());
  for (const line of remoteLines) {
    const fullName = line.trim();
    if (fullName.includes(' -> ')) {
      continue;
    }

    const [remote] = fullName.split('/');
    branches.push({
      name: fullName,  // Show full name "origin/main"
      isRemote: true,
      isCurrent: false,
      remote,
    });
  }

  return { branches, current };
}

async function resolveRemoteBranchTarget(
  cwd: string,
  mode: 'push' | 'upstream'
): Promise<GitRemoteBranchTarget | null> {
  const symbolicRef = mode === 'push' ? '@{push}' : '@{upstream}';

  try {
    const { stdout } = await runGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', symbolicRef]);
    const fullRef = stdout.trim();
    if (!fullRef) {
      return null;
    }

    const remoteSeparatorIndex = fullRef.indexOf('/');
    if (remoteSeparatorIndex <= 0 || remoteSeparatorIndex === fullRef.length - 1) {
      return null;
    }

    return {
      remote: fullRef.slice(0, remoteSeparatorIndex),
      branch: fullRef.slice(remoteSeparatorIndex + 1),
    };
  } catch {
    return null;
  }
}

async function getPreferredRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(cwd, ['remote']);
    const remotes = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (remotes.length === 0) {
      return null;
    }

    return remotes.includes('origin') ? 'origin' : (remotes[0] ?? null);
  } catch {
    return null;
  }
}
