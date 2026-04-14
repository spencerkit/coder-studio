/**
 * Tests for file-io operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile as readWorkspaceFile, writeFile as writeWorkspaceFile, resolveSafe } from '../../fs/file-io.js';

describe('resolveSafe', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should resolve safe relative path', () => {
    const result = resolveSafe(testDir, 'file.txt');
    expect(result).toBe(join(testDir, 'file.txt'));
  });

  it('should resolve safe nested path', () => {
    const result = resolveSafe(testDir, 'subdir/file.txt');
    expect(result).toBe(join(testDir, 'subdir/file.txt'));
  });

  it('should reject path escape with ..', () => {
    expect(() => resolveSafe(testDir, '../outside.txt')).toThrow();
  });

  it('should reject absolute path escape', () => {
    expect(() => resolveSafe(testDir, '/etc/passwd')).toThrow();
  });
});

describe('readFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should read file content and hash', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Hello, World!');

    const result = await readWorkspaceFile(testDir, 'test.txt');

    expect(result.content).toBe('Hello, World!');
    expect(result.baseHash).toBeDefined();
    expect(result.encoding).toBe('utf-8');
  });

  it('should throw for non-existent file', async () => {
    await expect(readWorkspaceFile(testDir, 'nonexistent.txt')).rejects.toThrow();
  });
});

describe('writeFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should write new file without baseHash', async () => {
    const result = await writeWorkspaceFile(testDir, 'test.txt', 'Hello, World!');

    expect(result.newHash).toBeDefined();

    const content = await readFile(join(testDir, 'test.txt'), 'utf8');
    expect(content).toBe('Hello, World!');
  });

  it('should write file with correct baseHash', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Original');

    const read = await readWorkspaceFile(testDir, 'test.txt');
    const result = await writeWorkspaceFile(testDir, 'test.txt', 'Updated', read.baseHash);

    expect(result.newHash).toBeDefined();

    const content = await readFile(filePath, 'utf8');
    expect(content).toBe('Updated');
  });

  it('should reject write with wrong baseHash', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Original');

    // Someone else changes the file
    await writeFile(filePath, 'Changed');

    // Try to write with outdated baseHash
    await expect(writeWorkspaceFile(testDir, 'test.txt', 'Updated', 'wronghash')).rejects.toThrow();
  });
});
