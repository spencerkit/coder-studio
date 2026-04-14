/**
 * Tests for file-io operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rmdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile as readWorkspaceFile, writeFile as writeWorkspaceFile, resolveSafe, ConflictError } from '../../fs/file-io.js';
import type { Workspace } from '@coder-studio/core';

describe('resolveSafe', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);
  });

  afterEach(async () => {
    try {
      await rmdir(testDir);
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
    expect(() => resolveSafe(testDir, '../outside.txt')).toThrow('path_escape');
  });

  it('should reject absolute path escape', () => {
    expect(() => resolveSafe(testDir, '/etc/passwd')).toThrow('path_escape');
  });
});

describe('readFile', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);

    workspace = {
      id: 'test-ws',
      path: testDir,
      targetRuntime: 'native',
      openedAt: Date.now(),
      lastActiveAt: Date.now(),
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    };
  });

  afterEach(async () => {
    try {
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should read file content and hash', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Hello, World!');

    const result = await readWorkspaceFile(workspace, 'test.txt');

    expect(result.content).toBe('Hello, World!');
    expect(result.baseHash).toBeDefined();
    expect(result.encoding).toBe('utf8');
  });

  it('should throw for non-existent file', async () => {
    await expect(readWorkspaceFile(workspace, 'nonexistent.txt')).rejects.toThrow();
  });
});

describe('writeFile', () => {
  let testDir: string;
  let workspace: Workspace;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fileio-test-${Date.now()}`);
    await mkdir(testDir);

    workspace = {
      id: 'test-ws',
      path: testDir,
      targetRuntime: 'native',
      openedAt: Date.now(),
      lastActiveAt: Date.now(),
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    };
  });

  afterEach(async () => {
    try {
      await rmdir(testDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should write new file', async () => {
    const result = await writeWorkspaceFile(workspace, 'test.txt', 'Hello, World!', '');

    expect(result.newHash).toBeDefined();

    const content = await readFile(join(testDir, 'test.txt'), 'utf8');
    expect(content).toBe('Hello, World!');
  });

  it('should write file with correct baseHash', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'Original');

    const read = await readWorkspaceFile(workspace, 'test.txt');
    const result = await writeWorkspaceFile(workspace, 'test.txt', 'Updated', read.baseHash);

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
    await expect(writeWorkspaceFile(workspace, 'test.txt', 'Updated', 'wronghash')).rejects.toThrow(
      ConflictError
    );
  });
});
