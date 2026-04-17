/**
 * Tests for file tree builder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile, mkdir as mkdirAsync } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readTree } from '../../fs/tree.js';

describe('readTree', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `tree-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return empty children array for empty directory', async () => {
    const result = await readTree(testDir);
    expect(result.path).toBe('.');
    expect(result.children).toEqual([]);
  });

  it('should list files and directories', async () => {
    await writeFile(join(testDir, 'file.txt'), 'content');
    await mkdirAsync(join(testDir, 'subdir'));

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(2);

    const dir = result.children.find((n) => n.name === 'subdir');
    expect(dir).toBeDefined();
    expect(dir?.kind).toBe('dir');
    expect(dir?.children).toEqual([]);

    const file = result.children.find((n) => n.name === 'file.txt');
    expect(file).toBeDefined();
    expect(file?.kind).toBe('file');
    expect(file?.size).toBe(7);
    expect(file?.mtime).toBeDefined();
  });

  it('should sort directories before files', async () => {
    await writeFile(join(testDir, 'z-file.txt'), 'content');
    await mkdirAsync(join(testDir, 'a-dir'));

    const result = await readTree(testDir);

    expect(result.children[0].name).toBe('a-dir');
    expect(result.children[0].kind).toBe('dir');
    expect(result.children[1].name).toBe('z-file.txt');
    expect(result.children[1].kind).toBe('file');
  });

  it('should sort items alphabetically within same kind', async () => {
    await mkdirAsync(join(testDir, 'b-dir'));
    await mkdirAsync(join(testDir, 'a-dir'));
    await writeFile(join(testDir, 'b-file.txt'), 'b');
    await writeFile(join(testDir, 'a-file.txt'), 'a');

    const result = await readTree(testDir);

    expect(result.children[0].name).toBe('a-dir');
    expect(result.children[1].name).toBe('b-dir');
    expect(result.children[2].name).toBe('a-file.txt');
    expect(result.children[3].name).toBe('b-file.txt');
  });

  it('should skip hidden files', async () => {
    await writeFile(join(testDir, '.hidden'), 'hidden');
    await writeFile(join(testDir, 'visible.txt'), 'visible');

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('visible.txt');
  });

  it('should skip node_modules and .git', async () => {
    await mkdirAsync(join(testDir, 'node_modules'));
    await mkdirAsync(join(testDir, '.git'));
    await writeFile(join(testDir, 'file.txt'), 'content');

    const result = await readTree(testDir);

    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('file.txt');
  });

  it('should use relative paths', async () => {
    await mkdirAsync(join(testDir, 'subdir'));
    await writeFile(join(testDir, 'subdir', 'file.txt'), 'content');

    const result = await readTree(testDir);

    expect(result.children[0].path).toBe('subdir');
  });

  it('should support subdir parameter', async () => {
    await mkdirAsync(join(testDir, 'subdir'));
    await writeFile(join(testDir, 'subdir', 'file.txt'), 'content');
    await writeFile(join(testDir, 'root.txt'), 'root');

    const result = await readTree(testDir, 'subdir');

    expect(result.path).toBe('subdir');
    expect(result.children).toHaveLength(1);
    expect(result.children[0].name).toBe('file.txt');
    // Path is relative to root, so it includes the subdir prefix
    expect(result.children[0].path).toBe('subdir/file.txt');
  });
});
