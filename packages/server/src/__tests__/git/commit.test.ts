/**
 * Tests for git commit operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { stageFiles, unstageFiles, discardChanges, createCommit } from '../../git/commit.js';

const execFileAsync = promisify(execFile);

describe('git commit operations', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-commit-test-${Date.now()}`);
    await mkdir(testDir);

    // Initialize git repo
    await execFileAsync('git', ['init'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });

    // Create initial commit
    await writeFile(join(testDir, 'initial.txt'), 'initial');
    await execFileAsync('git', ['add', '.'], { cwd: testDir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('stageFiles', () => {
    it('should stage files', async () => {
      await writeFile(join(testDir, 'test.txt'), 'test');
      await stageFiles(testDir, ['test.txt']);

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: testDir });
      expect(stdout).toContain('A  test.txt');
    });
  });

  describe('unstageFiles', () => {
    it('should unstage files', async () => {
      await writeFile(join(testDir, 'test.txt'), 'test');
      await execFileAsync('git', ['add', '.'], { cwd: testDir });
      await unstageFiles(testDir, ['test.txt']);

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: testDir });
      expect(stdout).toContain('?? test.txt');
    });
  });

  describe('discardChanges', () => {
    it('should discard changes to files', async () => {
      await writeFile(join(testDir, 'initial.txt'), 'modified');
      await discardChanges(testDir, ['initial.txt']);

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: testDir });
      expect(stdout.trim()).toBe('');
    });
  });

  describe('createCommit', () => {
    it('should create commit and return SHA', async () => {
      await writeFile(join(testDir, 'test.txt'), 'test');
      await execFileAsync('git', ['add', '.'], { cwd: testDir });

      const result = await createCommit(testDir, 'Test commit');
      expect(result.sha).toBeDefined();
      expect(result.sha).toMatch(/^[a-f0-9]{40}$/);

      const { stdout } = await execFileAsync('git', ['log', '-1', '--oneline'], { cwd: testDir });
      expect(stdout).toContain('Test commit');
    });
  });
});
