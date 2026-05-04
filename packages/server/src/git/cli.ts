/**
 * Git CLI operations - Wrapper around git commands.
 */

import { execFile } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { GitStatus, GitFileChange, GitBranch } from '@coder-studio/core';
import { GIT_COMMON_REMOTES } from '../constants/git.js';

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

interface RunGitOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: string;
  config?: GitConfigOverride[];
}

interface GitRemoteBranchTarget {
  remote: string;
  branch: string;
}

type GitConfigOverride = [key: string, value: string];

export interface GitHttpAuth {
  username: string;
  password: string;
}

export interface GitAuthFailureDetails {
  operation: 'push' | 'pull';
  remote?: string;
  remoteUrl?: string;
  remoteLabel: string;
  host?: string;
  reason: 'missing_credentials' | 'invalid_credentials' | 'authorization_failed';
  authMode: 'username_password' | 'unsupported';
  canPrompt: boolean;
  usernameHint?: string;
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
    const gitArgs = [
      ...(options.config?.flatMap(([key, value]) => ['-c', `${key}=${value}`]) ?? []),
      ...args,
    ];

    const child = execFile(
      'git',
      gitArgs,
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

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(options.stdin);
    }
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

interface GitAuthContext {
  remote?: string;
  remoteUrl?: string;
  operation: 'push' | 'pull';
  attemptedCredentialAuth?: boolean;
}

interface RemoteUrlMetadata {
  protocol?: string;
  host?: string;
  path?: string;
  sanitizedUrl?: string;
  canPrompt: boolean;
}

interface PreparedGitAuthExecution {
  env?: NodeJS.ProcessEnv;
  config?: GitConfigOverride[];
  cleanup: () => Promise<void>;
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
    auth?: GitHttpAuth;
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
  const remoteUrl = remote ? await getRemoteUrl(cwd, remote) : null;
  const remoteMetadata = parseRemoteUrlMetadata(remoteUrl ?? undefined);
  const authExecution = await prepareGitAuthExecution(options?.auth, remoteMetadata);

  try {
    const { stdout, stderr } = await runGit(cwd, args, {
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
      env: authExecution.env,
      config: authExecution.config,
    });

    if (options?.auth) {
      await persistGitHttpCredentials(cwd, options.auth, remoteMetadata);
    }

    // Combine output for message
    const message = stdout || stderr || 'Push completed successfully';

    return { success: true, message };
  } catch (error) {
    throw normalizeGitAuthFailure(error, {
      operation: 'push',
      remote,
      remoteUrl: remoteMetadata.sanitizedUrl ?? remoteUrl ?? undefined,
      attemptedCredentialAuth: Boolean(options?.auth),
    });
  } finally {
    await authExecution.cleanup();
  }
}

/**
 * Pull changes from remote.
 */
export async function runGitPull(
  cwd: string,
  options?: {
    remote?: string;
    branch?: string;
    auth?: GitHttpAuth;
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
  const remoteUrl = remote ? await getRemoteUrl(cwd, remote) : null;
  const remoteMetadata = parseRemoteUrlMetadata(remoteUrl ?? undefined);
  const authExecution = await prepareGitAuthExecution(options?.auth, remoteMetadata);

  try {
    const { stdout, stderr } = await runGit(cwd, args, {
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
      env: authExecution.env,
      config: authExecution.config,
    });

    if (options?.auth) {
      await persistGitHttpCredentials(cwd, options.auth, remoteMetadata);
    }

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
  } catch (error) {
    throw normalizeGitAuthFailure(error, {
      operation: 'pull',
      remote,
      remoteUrl: remoteMetadata.sanitizedUrl ?? remoteUrl ?? undefined,
      attemptedCredentialAuth: Boolean(options?.auth),
    });
  } finally {
    await authExecution.cleanup();
  }
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

async function getRemoteUrl(cwd: string, remote: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(cwd, ['remote', 'get-url', remote]);
    const value = stdout.trim();
    return value || null;
  } catch {
    return null;
  }
}

async function prepareGitAuthExecution(
  auth: GitHttpAuth | undefined,
  remoteMetadata: RemoteUrlMetadata
): Promise<PreparedGitAuthExecution> {
  if (!auth || !remoteMetadata.canPrompt || !remoteMetadata.host) {
    return {
      cleanup: async () => {},
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'coder-studio-git-auth-'));
  const hooksDir = path.join(tempDir, 'hooks');
  const askPassPath = path.join(tempDir, 'askpass.sh');

  await mkdir(hooksDir, { recursive: true, mode: 0o700 });
  await writeFile(
    askPassPath,
    [
      '#!/bin/sh',
      'prompt=$(printf "%s" "$1" | tr "[:upper:]" "[:lower:]")',
      `if printf "%s" "$prompt" | grep -q "username"; then`,
      '  printf "%s" "$CODER_STUDIO_GIT_AUTH_USERNAME"',
      'else',
      '  printf "%s" "$CODER_STUDIO_GIT_AUTH_PASSWORD"',
      'fi',
      '',
    ].join('\n'),
    { mode: 0o700 }
  );

  return {
    env: {
      GIT_ASKPASS: askPassPath,
      SSH_ASKPASS: askPassPath,
      GCM_INTERACTIVE: 'never',
      CODER_STUDIO_GIT_AUTH_USERNAME: auth.username,
      CODER_STUDIO_GIT_AUTH_PASSWORD: auth.password,
    },
    config: [
      ['core.hooksPath', hooksDir],
      ['credential.helper', ''],
      ['credential.username', auth.username],
    ],
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

async function persistGitHttpCredentials(
  cwd: string,
  auth: GitHttpAuth,
  remoteMetadata: RemoteUrlMetadata
): Promise<void> {
  if (!remoteMetadata.canPrompt || !remoteMetadata.host || !remoteMetadata.path) {
    return;
  }

  let helperConfigured = false;
  try {
    if (remoteMetadata.sanitizedUrl) {
      const { stdout } = await runGit(
        cwd,
        ['config', '--get-urlmatch', 'credential.helper', remoteMetadata.sanitizedUrl],
        {
          timeoutMs: 30000,
        }
      );
      helperConfigured = stdout
        .split('\n')
        .map((line) => line.trim())
        .some(Boolean);
    } else {
      const { stdout } = await runGit(cwd, ['config', '--get-regexp', '^credential(\\..+)?\\.helper$'], {
        timeoutMs: 30000,
      });
      helperConfigured = stdout
        .split('\n')
        .map((line) => line.trim())
        .some(Boolean);
    }
  } catch {
    helperConfigured = false;
  }

  if (!helperConfigured) {
    return;
  }

  let useHttpPath = false;
  try {
    const configArgs = remoteMetadata.sanitizedUrl
      ? ['config', '--get-urlmatch', 'credential.useHttpPath', remoteMetadata.sanitizedUrl]
      : ['config', '--get', 'credential.useHttpPath'];
    const { stdout } = await runGit(cwd, configArgs, {
      timeoutMs: 30000,
    });
    useHttpPath = isGitBooleanTrue(stdout);
  } catch {
    useHttpPath = false;
  }

  const credentialInput = [
    `protocol=${remoteMetadata.protocol ?? 'https'}`,
    `host=${remoteMetadata.host}`,
    ...(useHttpPath ? [`path=${remoteMetadata.path}`] : []),
    `username=${auth.username}`,
    `password=${auth.password}`,
    '',
    '',
  ].join('\n');

  try {
    await runGit(cwd, ['credential', 'approve'], {
      stdin: credentialInput,
      timeoutMs: 30000,
    });
  } catch {
    // Persisting credentials is best-effort and should not fail the git operation.
  }
}

function normalizeGitAuthFailure(error: unknown, context: GitAuthContext): unknown {
  if (!(error instanceof GitError)) {
    return error;
  }

  const details = classifyGitAuthFailure(error, context);
  if (!details) {
    return error;
  }

  return {
    code: details.canPrompt ? 'git_auth_required' : 'git_auth_failed',
    message: formatGitAuthFailureMessage(details),
    details,
  };
}

export function classifyGitAuthFailure(
  error: GitError,
  context: GitAuthContext
): GitAuthFailureDetails | null {
  const output = `${error.message}\n${error.stderr}`.toLowerCase();
  const remoteMetadata = describeRemote(context.remote, context.remoteUrl);
  const authPatterns = [
    'terminal prompts disabled',
    'could not read username',
    'could not read password',
    'authentication failed',
    'http basic: access denied',
    'invalid username or password',
    'invalid username or token',
    'support for password authentication was removed',
    'requested url returned error: 401',
    'requested url returned error: 403',
    'write access to repository not granted',
    'access denied',
    'authentication required',
    'permission denied (publickey)',
    'could not read from remote repository',
  ];

  if (!authPatterns.some((pattern) => output.includes(pattern))) {
    return null;
  }

  const attemptedCredentialAuth = context.attemptedCredentialAuth ?? false;
  const reason = output.includes('requested url returned error: 403') ||
    output.includes('write access to repository not granted')
      ? 'authorization_failed'
      : output.includes('terminal prompts disabled') ||
          output.includes('could not read username') ||
          output.includes('could not read password')
        ? 'missing_credentials'
        : attemptedCredentialAuth || output.includes('access denied')
          ? 'invalid_credentials'
          : 'missing_credentials';

  return {
    operation: context.operation,
    remote: context.remote,
    remoteUrl: remoteMetadata.remoteUrl,
    remoteLabel: remoteMetadata.remoteLabel,
    host: remoteMetadata.host,
    reason,
    authMode: remoteMetadata.canPrompt ? 'username_password' : 'unsupported',
    canPrompt: remoteMetadata.canPrompt,
    usernameHint: remoteMetadata.usernameHint,
  };
}

function formatGitAuthFailureMessage(details: GitAuthFailureDetails): string {
  if (!details.canPrompt) {
    return `Authentication failed for ${details.remoteLabel}. Configure SSH keys or a credential helper, then try again.`;
  }

  if (details.reason === 'authorization_failed') {
    return `Credentials for ${details.remoteLabel} were accepted, but this account is not allowed to ${details.operation}.`;
  }

  if (details.reason === 'invalid_credentials') {
    return `Credentials for ${details.remoteLabel} were rejected. Enter a valid username and password or personal access token to continue.`;
  }

  return `Authentication is required to ${details.operation} ${details.remoteLabel}. Enter your Git username and password or personal access token to continue.`;
}

function describeRemote(remote: string | undefined, remoteUrl: string | undefined) {
  const metadata = parseRemoteUrlMetadata(remoteUrl);
  const remoteLabel = metadata.host ? `${remote ?? 'remote'} (${metadata.host})` : remote ?? 'remote';

  return {
    remoteUrl: metadata.sanitizedUrl ?? remoteUrl,
    remoteLabel,
    host: metadata.host,
    canPrompt: metadata.canPrompt,
    usernameHint: undefined,
  };
}

function parseRemoteUrlMetadata(remoteUrl: string | undefined): RemoteUrlMetadata {
  if (!remoteUrl) {
    return {
      canPrompt: false,
    };
  }

  try {
    const parsed = new URL(remoteUrl);
    const pathName = parsed.pathname.replace(/^\/+/, '');
    const sanitized = new URL(remoteUrl);
    sanitized.username = '';
    sanitized.password = '';
    return {
      protocol: parsed.protocol.replace(/:$/, ''),
      host: parsed.host || undefined,
      path: pathName || undefined,
      sanitizedUrl: sanitized.toString(),
      canPrompt: parsed.protocol === 'http:' || parsed.protocol === 'https:',
    };
  } catch {
    const sshMatch = remoteUrl.match(/^(?<user>[^@]+)@(?<host>[^:]+):.+$/);
    if (sshMatch?.groups?.host) {
      return {
        protocol: 'ssh',
        host: sshMatch.groups.host,
        path: remoteUrl.split(':').slice(1).join(':') || undefined,
        sanitizedUrl: remoteUrl,
        canPrompt: false,
      };
    }

    return {
      sanitizedUrl: remoteUrl,
      canPrompt: false,
    };
  }
}

function isGitBooleanTrue(value: string): boolean {
  return ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase());
}
