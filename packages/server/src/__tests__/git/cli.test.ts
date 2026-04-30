/**
 * Tests for git CLI executor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile, rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runGit, GitError } from '../../git/cli.js';

const execFileAsync = promisify(execFile);

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

    // Create feature branch
    await execFileAsync('git', ['checkout', '-b', 'feature-1'], { cwd: testDir });

    // Create bare remote repository
    await mkdir(remoteDir);
    await execFileAsync('git', ['init', '--bare'], { cwd: remoteDir });

    // Add remote and push branches to create remote tracking branches
    await execFileAsync('git', ['remote', 'add', 'origin', remoteDir], { cwd: testDir });
    await execFileAsync('git', ['push', '-u', 'origin', 'master'], { cwd: testDir });
    await execFileAsync('git', ['push', '-u', 'origin', 'feature-1'], { cwd: testDir });

    // Go back to master (default branch)
    await execFileAsync('git', ['checkout', 'master'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.current).toBe('master');

    // Check local branches
    expect(result.branches).toContainEqual({
      name: 'master',
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
      name: 'origin/master',
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
    await execFileAsync('git', ['push', '-u', 'origin', 'master'], { cwd: testDir });
    await execFileAsync('git', ['remote', 'set-head', 'origin', '-a'], { cwd: testDir });

    const { runGitListBranches } = await import('../../git/cli.js');
    const result = await runGitListBranches(testDir);

    expect(result.branches).not.toContainEqual(
      expect.objectContaining({
        name: 'origin/HEAD -> origin/master',
      })
    );
    expect(result.branches).toContainEqual({
      name: 'origin/master',
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
    await execFileAsync('git', ['push', '-u', 'origin', 'master'], { cwd: testDir });

    // Create a new branch on remote (simulate remote-only branch)
    await execFileAsync('git', ['checkout', '-b', 'feature-remote'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature content');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: testDir });
    await execFileAsync('git', ['push', 'origin', 'feature-remote'], { cwd: testDir });

    // Go back to master and delete local feature-remote branch
    await execFileAsync('git', ['checkout', 'master'], { cwd: testDir });
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
    await execFileAsync('git', ['push', '-u', 'origin', 'master'], { cwd: testDir });

    await execFileAsync('git', ['checkout', '-b', 'feature/login'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature content');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'feature'], { cwd: testDir });
    await execFileAsync('git', ['push', 'origin', 'feature/login'], { cwd: testDir });

    await execFileAsync('git', ['checkout', 'master'], { cwd: testDir });
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
    await execFileAsync('git', ['checkout', 'master'], { cwd: testDir });

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
