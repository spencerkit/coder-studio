/**
 * Tests for git CLI executor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile } from 'fs/promises';
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
