/**
 * Tests for git CLI executor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, rmdir, writeFile, rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  classifyGitAuthFailure,
  getGitStatus,
  runGit,
  GitError,
  runGitPull,
  runGitPush,
} from '../../git/cli.js';

const execFileAsync = promisify(execFile);

async function getCurrentBranch(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd });
  return stdout.trim();
}

describe('runGit', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-test-${Date.now()}`);
    await mkdir(testDir);

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should execute git command successfully', async () => {
    const result = await runGit(testDir, ['status']);
    expect(result.stdout).toBeDefined();
    expect(result.stderr).toBeDefined();
  });

  it('should throw GitError for invalid command', async () => {
    await expect(runGit(testDir, ['invalid-command'])).rejects.toThrow(GitError);
  });

  it('should return stdout for successful command', async () => {
    const result = await runGit(testDir, ['rev-parse', '--git-dir']);
    expect(result.stdout.trim()).toBe('.git');
  });
});

describe('GitError', () => {
  it('should create error with message and stderr', () => {
    const error = new GitError('Command failed', 'error output');
    expect(error.name).toBe('GitError');
    expect(error.message).toBe('Command failed');
    expect(error.stderr).toBe('error output');
  });

  it('classifies missing HTTP credentials for push', () => {
    const error = new GitError(
      'Command failed: git push',
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://alice@github.com/openai/demo.git',
      })
    ).toEqual({
      operation: 'push',
      remote: 'origin',
      remoteUrl: 'https://github.com/openai/demo.git',
      remoteLabel: 'origin (github.com)',
      host: 'github.com',
      reason: 'missing_credentials',
      authMode: 'username_password',
      canPrompt: true,
      usernameHint: undefined,
    });
  });

  it('classifies invalid HTTP credentials after a prompted retry', () => {
    const error = new GitError(
      'Command failed: git push',
      'remote: Invalid username or token. fatal: Authentication failed'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://github.com/openai/demo.git',
        attemptedCredentialAuth: true,
      })
    ).toEqual({
      operation: 'push',
      remote: 'origin',
      remoteUrl: 'https://github.com/openai/demo.git',
      remoteLabel: 'origin (github.com)',
      host: 'github.com',
      reason: 'invalid_credentials',
      authMode: 'username_password',
      canPrompt: true,
      usernameHint: undefined,
    });
  });

  it('classifies HTTP 403 failures as authorization failures', () => {
    const error = new GitError(
      'Command failed: git push',
      'remote: Write access to repository not granted.\nfatal: unable to access \'https://github.com/openai/demo.git/\': The requested URL returned error: 403'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://github.com/openai/demo.git',
      })
    ).toEqual({
      operation: 'push',
      remote: 'origin',
      remoteUrl: 'https://github.com/openai/demo.git',
      remoteLabel: 'origin (github.com)',
      host: 'github.com',
      reason: 'authorization_failed',
      authMode: 'username_password',
      canPrompt: true,
      usernameHint: undefined,
    });
  });

  it('does not classify HTTPS repository-not-found as an auth failure', () => {
    const error = new GitError(
      'Command failed: git push',
      'fatal: repository \'https://github.com/openai/missing.git/\' not found'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://github.com/openai/missing.git',
      })
    ).toBeNull();
  });

  it('does not classify HTTPS repository-not-found after retry as an auth failure', () => {
    const error = new GitError(
      'Command failed: git push',
      'fatal: repository \'https://github.com/openai/missing.git/\' not found'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://github.com/openai/missing.git',
        attemptedCredentialAuth: true,
      })
    ).toBeNull();
  });

  it('does not classify SSH repository-not-found as an in-app auth failure', () => {
    const error = new GitError(
      'Command failed: git push',
      'fatal: repository \'git@github.com:openai/missing.git\' not found'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'git@github.com:openai/missing.git',
      })
    ).toBeNull();
  });

  it('classifies SSH publickey failures as unsupported auth', () => {
    const error = new GitError(
      'Command failed: git push',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
    );

    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'git@github.com:openai/demo.git',
      })
    ).toEqual({
      operation: 'push',
      remote: 'origin',
      remoteUrl: 'git@github.com:openai/demo.git',
      remoteLabel: 'origin (github.com)',
      host: 'github.com',
      reason: 'missing_credentials',
      authMode: 'unsupported',
      canPrompt: false,
      usernameHint: undefined,
    });
  });

  it('returns null for non-auth git failures', () => {
    const error = new GitError('Command failed: git push', 'fatal: not a git repository');
    expect(
      classifyGitAuthFailure(error, {
        operation: 'push',
        remote: 'origin',
        remoteUrl: 'https://github.com/openai/demo.git',
      })
    ).toBeNull();
  });
});

describe('runGitListBranches', () => {
  let testDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-test-${Date.now()}`);
    remoteDir = join(tmpdir(), `git-remote-${Date.now()}`);
    await mkdir(testDir);

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    try {
      await rmdir(remoteDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns structured branch data with remote branches', async () => {
    // Setup: Create a repo with local and remote branches
    // Create initial commit to establish default branch
    await writeFile(join(testDir, 'README.md'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    const defaultBranch = await getCurrentBranch(testDir);

    // Create feature branch
    await execFileAsync('git', ['checkout', '-b', 'feature-1'], { cwd: testDir });

    // Create bare remote repository
    await mkdir(remoteDir);
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });

    // Add remote and push branches to create remote tracking branches
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    await execFileAsync('git', ['push', '-u', 'origin', defaultBranch], { cwd: testDir });
    await execFileAsync('git', ['push', '-u', 'origin', 'feature-1'], { cwd: testDir });

    // Go back to default branch
    await execFileAsync('git', ['checkout', defaultBranch], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.current).toBe(defaultBranch);

    // Check local branches
    expect(result.branches).toContainEqual({
      name: defaultBranch,
      isRemote: false,
      isCurrent: true,
    });
    expect(result.branches).toContainEqual({
      name: 'feature-1',
      isRemote: false,
      isCurrent: false,
    });

    // Check remote branches
    expect(result.branches).toContainEqual({
      name: `origin/${defaultBranch}`,
      isRemote: true,
      isCurrent: false,
      remote: 'origin',
    });
    expect(result.branches).toContainEqual({
      name: 'origin/feature-1',
      isRemote: true,
      isCurrent: false,
      remote: 'origin',
    });
    expect(result.branches).not.toContainEqual(
      expect.objectContaining({
        name: expect.stringContaining('HEAD ->'),
      })
    );
  });

  it('filters out symbolic remote HEAD refs', async () => {
    await writeFile(join(testDir, 'README.md'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });

    await mkdir(remoteDir);
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    const defaultBranch = await getCurrentBranch(testDir);
    await execFileAsync('git', ['push', '-u', 'origin', defaultBranch], { cwd: testDir });
    await execFileAsync('git', ['remote', 'set-head', 'origin', '-a'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.branches).not.toContainEqual(
      expect.objectContaining({
        name: 'origin/HEAD -> origin/master',
      })
    );
    expect(result.branches).toContainEqual({
      name: `origin/${defaultBranch}`,
      isRemote: true,
      isCurrent: false,
      remote: 'origin',
    });
  });

  it('handles empty repository with no commits', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-test-'));
    await execFileAsync('git', ['init'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.branches).toEqual([]);
    expect(result.current).toBe('');

    await rm(testDir, { recursive: true });
  });

  it('handles detached HEAD state', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-test-'));
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    await writeFile(join(testDir, 'file.txt'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['checkout', '--detach', 'HEAD'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.current).toBe('');
    expect(result.branches).not.toContainEqual(
      expect.objectContaining({ name: expect.stringContaining('HEAD detached') })
    );

    await rm(testDir, { recursive: true });
  });

  it('handles branches with slashes in names', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-test-'));
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    await writeFile(join(testDir, 'file.txt'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['checkout', '-b', 'feature/login'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.branches).toContainEqual({
      name: 'feature/login',
      isRemote: false,
      isCurrent: true,
    });
    expect(result.current).toBe('feature/login');

    await rm(testDir, { recursive: true });
  });
});

describe('getGitStatus', () => {
  it('returns HEAD commit metadata for a normal branch', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-status-meta-'));
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    await writeFile(join(testDir, 'file.txt'), 'hello\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial subject'], { cwd: testDir });

    const status = await getGitStatus(testDir);
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: testDir });

    expect(status.branch).not.toBe('');
    expect(status.headSha).toBe(stdout.trim());
    expect(status.headShortSha).toBe(stdout.trim().slice(0, 7));
    expect(status.headSubject).toBe('initial subject');

    await rm(testDir, { recursive: true, force: true });
  });

  it('does not invent HEAD metadata before the first commit', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-status-empty-'));
    await execFileAsync('git', ['init'], { cwd: testDir });

    const status = await getGitStatus(testDir);

    expect(status.branch).not.toBe('');
    expect(status.headSha).toBeUndefined();
    expect(status.headShortSha).toBeUndefined();
    expect(status.headSubject).toBeUndefined();

    await rm(testDir, { recursive: true, force: true });
  });

  it('keeps commit metadata in detached HEAD state', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'git-status-detached-'));
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    await writeFile(join(testDir, 'file.txt'), 'hello\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'detached subject'], { cwd: testDir });
    await execFileAsync('git', ['checkout', '--detach', 'HEAD'], { cwd: testDir });

    const status = await getGitStatus(testDir);
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: testDir });

    expect(status.branch).toBe('(detached)');
    expect(status.headSha).toBe(stdout.trim());
    expect(status.headShortSha).toBe(stdout.trim().slice(0, 7));
    expect(status.headSubject).toBe('detached subject');

    await rm(testDir, { recursive: true, force: true });
  });
});

describe('runGitCheckout', () => {
  let testDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-test-${Date.now()}`);
    remoteDir = join(tmpdir(), `git-remote-${Date.now()}`);
    await mkdir(testDir);

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    try {
      await rmdir(remoteDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('creates tracking branch for remote branch', async () => {
    // Setup: Create initial commit
    await writeFile(join(testDir, 'README.md'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });

    // Create bare remote repository
    await mkdir(remoteDir);
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });

    // Add remote and push master to create remote tracking branch
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    const defaultBranch = await getCurrentBranch(testDir);
    await execFileAsync('git', ['push', '-u', 'origin', defaultBranch], { cwd: testDir });

    // Create a new branch on remote (simulate remote-only branch)
    await execFileAsync('git', ['checkout', '-b', 'feature-remote'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature content');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: testDir });
    await execFileAsync('git', ['push', 'origin', 'feature-remote'], { cwd: testDir });

    // Go back to master and delete local feature-remote branch
    await execFileAsync('git', ['checkout', defaultBranch], { cwd: testDir });
    await execFileAsync('git', ['branch', '-D', 'feature-remote'], { cwd: testDir });

    // Now feature-remote exists only on remote
    const { runGitCheckout } = await import('../../git/cli.js');
    const result = await runGitCheckout(testDir, 'origin/feature-remote');

    expect(result.success).toBe(true);
    expect(result.branch).toBe('feature-remote'); // Local branch created

    // Verify the branch was created and is tracking
    const { stdout } = await execFileAsync('git', ['branch', '-vv'], { cwd: testDir });
    expect(stdout).toContain('feature-remote');
    expect(stdout).toContain('[origin/feature-remote]');
  });

  it('preserves nested branch names when checking out remote branches', async () => {
    await writeFile(join(testDir, 'README.md'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });

    await mkdir(remoteDir);
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    const defaultBranch = await getCurrentBranch(testDir);
    await execFileAsync('git', ['push', '-u', 'origin', defaultBranch], { cwd: testDir });

    await execFileAsync('git', ['checkout', '-b', 'feature/login'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature content');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: testDir });
    await execFileAsync('git', ['push', 'origin', 'feature/login'], { cwd: testDir });

    await execFileAsync('git', ['checkout', defaultBranch], { cwd: testDir });
    await execFileAsync('git', ['branch', '-D', 'feature/login'], { cwd: testDir });

    const { runGitCheckout } = await import('../../git/cli.js');
    const result = await runGitCheckout(testDir, 'origin/feature/login');

    expect(result.success).toBe(true);
    expect(result.branch).toBe('feature/login');

    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: testDir });
    expect(stdout.trim()).toBe('feature/login');
  });

  it('handles local branches with slashes correctly', async () => {
    // Setup: Create initial commit and a local branch with slashes
    await writeFile(join(testDir, 'README.md'), 'test');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });

    // Create local branch with slashes in name
    await execFileAsync('git', ['checkout', '-b', 'feature/login-page'], { cwd: testDir });
    await writeFile(join(testDir, 'login.txt'), 'login feature');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'login feature'], { cwd: testDir });

    // Go back to master
    const defaultBranch = await getCurrentBranch(testDir);
    await execFileAsync('git', ['checkout', defaultBranch], { cwd: testDir });

    // Now checkout the local branch with slashes (should NOT treat as remote)
    const { runGitCheckout } = await import('../../git/cli.js');
    const result = await runGitCheckout(testDir, 'feature/login-page');

    expect(result.success).toBe(true);
    expect(result.branch).toBe('feature/login-page');

    // Verify we're on the correct branch
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], { cwd: testDir });
    expect(stdout.trim()).toBe('feature/login-page');
  });
});

describe('runGitPush', () => {
  let testDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-test-${Date.now()}`);
    remoteDir = join(tmpdir(), `git-remote-${Date.now()}`);
    await mkdir(testDir);
    await mkdir(remoteDir);

    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it('sets upstream automatically when pushing a new local branch', async () => {
    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    await execFileAsync('git', ['checkout', '-b', 'feature/push-test'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: testDir });

    const result = await runGitPush(testDir);

    expect(result.success).toBe(true);

    const { stdout: upstreamOutput } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
      { cwd: testDir }
    );
    expect(upstreamOutput.trim()).toBe('origin/feature/push-test');

    const { stdout: remoteOutput } = await execFileAsync(
      'git',
      ['branch', '--list', 'feature/push-test'],
      { cwd: remoteDir }
    );
    expect(remoteOutput).toContain('feature/push-test');
  });

  it('persists successful HTTP credentials through the configured credential helper', async () => {
    const helperLog = join(testDir, 'credential-helper.log');
    const helperScript = join(testDir, 'credential-helper.sh');
    const wrapperDir = join(testDir, 'bin');
    const wrapperScript = join(wrapperDir, 'git');
    await writeFile(
      helperScript,
      [
        '#!/bin/sh',
        `cat > ${JSON.stringify(helperLog)}`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o700 }
    );
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      wrapperScript,
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "push" ]; then',
        '    exit 0',
        '  fi',
        'done',
        `exec ${JSON.stringify((await execFileAsync('sh', ['-lc', 'command -v git'])).stdout.trim())} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 }
    );

    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/openai/demo.git'], { cwd: testDir });
    await execFileAsync('git', ['config', 'credential.helper', helperScript], { cwd: testDir });
    const originalPath = process.env.PATH ?? '';
    vi.stubEnv('PATH', `${wrapperDir}:${originalPath}`);

    await runGitPush(testDir, {
      remote: 'origin',
      branch: 'main',
      auth: {
        username: 'alice',
        password: 'secret-token',
      },
    });

    vi.unstubAllEnvs();

    const helperLogContent = await readFile(helperLog, 'utf8');
    expect(helperLogContent).toContain('protocol=https');
    expect(helperLogContent).toContain('host=example.com');
    expect(helperLogContent).not.toContain('path=openai/demo.git');
    expect(helperLogContent).toContain('username=alice');
    expect(helperLogContent).toContain('password=secret-token');
  });

  it('forces the entered username for the authenticated retry', async () => {
    const argLog = join(testDir, 'push-args.log');
    const wrapperDir = join(testDir, 'bin-username');
    const wrapperScript = join(wrapperDir, 'git');
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      wrapperScript,
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "push" ]; then',
        `    printf "%s\\n" "$@" > ${JSON.stringify(argLog)}`,
        '    exit 0',
        '  fi',
        'done',
        `exec ${JSON.stringify((await execFileAsync('sh', ['-lc', 'command -v git'])).stdout.trim())} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 }
    );

    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://configured@example.com/openai/demo.git'], { cwd: testDir });
    const originalPath = process.env.PATH ?? '';
    vi.stubEnv('PATH', `${wrapperDir}:${originalPath}`);

    await runGitPush(testDir, {
      remote: 'origin',
      branch: 'main',
      auth: {
        username: 'alice',
        password: 'secret-token',
      },
    });

    vi.unstubAllEnvs();

    const argLogContent = await readFile(argLog, 'utf8');
    expect(argLogContent).toContain('credential.username=alice');
  });

  it('includes the HTTP path when credential.useHttpPath is enabled', async () => {
    const helperLog = join(testDir, 'credential-helper-http-path.log');
    const helperScript = join(testDir, 'credential-helper-http-path.sh');
    const wrapperDir = join(testDir, 'bin-http-path');
    const wrapperScript = join(wrapperDir, 'git');
    await writeFile(
      helperScript,
      [
        '#!/bin/sh',
        `cat > ${JSON.stringify(helperLog)}`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o700 }
    );
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      wrapperScript,
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "push" ]; then',
        '    exit 0',
        '  fi',
        'done',
        `exec ${JSON.stringify((await execFileAsync('sh', ['-lc', 'command -v git'])).stdout.trim())} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 }
    );

    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/openai/demo.git'], { cwd: testDir });
    await execFileAsync('git', ['config', 'credential.helper', helperScript], { cwd: testDir });
    await execFileAsync('git', ['config', 'credential.useHttpPath', 'yes'], { cwd: testDir });
    const originalPath = process.env.PATH ?? '';
    vi.stubEnv('PATH', `${wrapperDir}:${originalPath}`);

    await runGitPush(testDir, {
      remote: 'origin',
      branch: 'main',
      auth: {
        username: 'alice',
        password: 'secret-token',
      },
    });

    vi.unstubAllEnvs();

    const helperLogContent = await readFile(helperLog, 'utf8');
    expect(helperLogContent).toContain('path=openai/demo.git');
  });

  it('persists credentials when a URL-scoped credential helper is configured', async () => {
    const helperLog = join(testDir, 'credential-helper-url-scoped.log');
    const helperScript = join(testDir, 'credential-helper-url-scoped.sh');
    const wrapperDir = join(testDir, 'bin-url-helper');
    const wrapperScript = join(wrapperDir, 'git');
    await writeFile(
      helperScript,
      [
        '#!/bin/sh',
        `cat > ${JSON.stringify(helperLog)}`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o700 }
    );
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      wrapperScript,
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "push" ]; then',
        '    exit 0',
        '  fi',
        'done',
        `exec ${JSON.stringify((await execFileAsync('sh', ['-lc', 'command -v git'])).stdout.trim())} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 }
    );

    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/openai/demo.git'], { cwd: testDir });
    await execFileAsync(
      'git',
      ['config', 'credential.https://example.com.helper', helperScript],
      { cwd: testDir }
    );
    const originalPath = process.env.PATH ?? '';
    vi.stubEnv('PATH', `${wrapperDir}:${originalPath}`);

    await runGitPush(testDir, {
      remote: 'origin',
      branch: 'main',
      auth: {
        username: 'alice',
        password: 'secret-token',
      },
    });

    vi.unstubAllEnvs();

    const helperLogContent = await readFile(helperLog, 'utf8');
    expect(helperLogContent).toContain('username=alice');
    expect(helperLogContent).toContain('password=secret-token');
  });

  it('includes the HTTP path when URL-scoped credential.useHttpPath is enabled', async () => {
    const helperLog = join(testDir, 'credential-helper-url-http-path.log');
    const helperScript = join(testDir, 'credential-helper-url-http-path.sh');
    const wrapperDir = join(testDir, 'bin-url-http-path');
    const wrapperScript = join(wrapperDir, 'git');
    await writeFile(
      helperScript,
      [
        '#!/bin/sh',
        `cat > ${JSON.stringify(helperLog)}`,
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o700 }
    );
    await mkdir(wrapperDir, { recursive: true });
    await writeFile(
      wrapperScript,
      [
        '#!/bin/sh',
        'for arg in "$@"; do',
        '  if [ "$arg" = "push" ]; then',
        '    exit 0',
        '  fi',
        'done',
        `exec ${JSON.stringify((await execFileAsync('sh', ['-lc', 'command -v git'])).stdout.trim())} "$@"`,
        '',
      ].join('\n'),
      { mode: 0o700 }
    );

    await writeFile(join(testDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://example.com/openai/demo.git'], { cwd: testDir });
    await execFileAsync(
      'git',
      ['config', 'credential.https://example.com/openai/demo.git.helper', helperScript],
      { cwd: testDir }
    );
    await execFileAsync(
      'git',
      ['config', 'credential.https://example.com/openai/demo.git.useHttpPath', 'true'],
      { cwd: testDir }
    );
    const originalPath = process.env.PATH ?? '';
    vi.stubEnv('PATH', `${wrapperDir}:${originalPath}`);

    await runGitPush(testDir, {
      remote: 'origin',
      branch: 'main',
      auth: {
        username: 'alice',
        password: 'secret-token',
      },
    });

    vi.unstubAllEnvs();

    const helperLogContent = await readFile(helperLog, 'utf8');
    expect(helperLogContent).toContain('path=openai/demo.git');
  });
});

describe('runGitPull', () => {
  let primaryDir: string;
  let contributorDir: string;
  let remoteDir: string;

  beforeEach(async () => {
    primaryDir = join(tmpdir(), `git-primary-${Date.now()}`);
    contributorDir = join(tmpdir(), `git-contributor-${Date.now()}`);
    remoteDir = join(tmpdir(), `git-remote-${Date.now()}`);
    await mkdir(primaryDir);
    await mkdir(remoteDir);

    await execFileAsync('git', ['init'], { cwd: primaryDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: primaryDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: primaryDir });
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });

    await writeFile(join(primaryDir, 'README.md'), 'init\n');
    await execFileAsync('git', ['add', '.'], { cwd: primaryDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: primaryDir });
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: primaryDir });
    const defaultBranch = await getCurrentBranch(primaryDir);
    await execFileAsync('git', ['push', '-u', 'origin', defaultBranch], { cwd: primaryDir });

    await execFileAsync('git', ['clone', remoteDir, contributorDir]);
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: contributorDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: contributorDir });
  });

  afterEach(async () => {
    await rm(primaryDir, { recursive: true, force: true });
    await rm(contributorDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  it('pulls from the tracked upstream when no remote args are provided', async () => {
    await writeFile(join(contributorDir, 'README.md'), 'remote change\n');
    await execFileAsync('git', ['add', '.'], { cwd: contributorDir });
    await execFileAsync('git', ['commit', '-m', 'remote change'], { cwd: contributorDir });
    const contributorBranch = await getCurrentBranch(contributorDir);
    await execFileAsync('git', ['push', 'origin', contributorBranch], { cwd: contributorDir });

    const result = await runGitPull(primaryDir);

    expect(result.success).toBe(true);

    const { stdout } = await execFileAsync('git', ['rev-parse', '@{upstream}'], { cwd: primaryDir });
    const { stdout: headStdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: primaryDir });
    expect(headStdout.trim()).toBe(stdout.trim());
  });
});
