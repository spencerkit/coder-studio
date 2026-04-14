/**
 * Tests for git diff operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getFileDiff, getDiff } from '../../git/diff.js';

const execFileAsync = promisify(execFile);

describe('git diff operations', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `git-diff-test-${Date.now()}`);
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

  describe('getFileDiff', () => {
    it('should get diff for modified file', async () => {
      await writeFile(join(testDir, 'initial.txt'), 'modified');
      const diff = await getFileDiff(testDir, 'initial.txt');
      expect(diff).toContain('modified');
    });

    it('should get empty diff for unchanged file', async () => {
      const diff = await getFileDiff(testDir, 'initial.txt');
      expect(diff).toBe('');
    });

    it('should get staged diff', async () => {
      await writeFile(join(testDir, 'initial.txt'), 'modified');
      await execFileAsync('git', ['add', '.'], { cwd: testDir });
      const diff = await getFileDiff(testDir, 'initial.txt', true);
      expect(diff).toContain('modified');
    });
  });

  describe('getDiff', () => {
    it('should get diff for all changes', async () => {
      await writeFile(join(testDir, 'initial.txt'), 'modified');
      // Note: git diff does not show untracked files, only tracked changes
      const diff = await getDiff(testDir);
      expect(diff).toContain('modified');
    });

    it('should get staged diff for all files', async () => {
      await writeFile(join(testDir, 'initial.txt'), 'modified');
      await execFileAsync('git', ['add', '.'], { cwd: testDir });
      const diff = await getDiff(testDir, true);
      expect(diff).toContain('modified');
    });
  });
});
