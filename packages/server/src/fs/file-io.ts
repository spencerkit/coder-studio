/**
 * File IO operations with conflict detection.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';
import { resolve } from 'path';
import { createHash } from 'crypto';
import type { Workspace } from '@coder-studio/core';

export interface FileRead {
  content: string;
  baseHash: string;
  encoding: 'utf8';
}

export interface FileWrite {
  newHash: string;
}

/**
 * Resolves a relative path safely to prevent path escape attacks.
 * Throws an error if the resolved path escapes the workspace root.
 *
 * @param root - Workspace root directory
 * @param relPath - Relative path within workspace
 * @returns Absolute path safely resolved within workspace
 */
export function resolveSafe(root: string, relPath: string): string {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, relPath);

  // Prevent path escape: resolved path must be under root
  if (!abs.startsWith(absRoot + '/') && abs !== absRoot) {
    throw new Error('path_escape');
  }

  return abs;
}

/**
 * Reads a file from the workspace with baseHash for conflict detection.
 *
 * @param ws - Workspace
 * @param relPath - Relative file path
 * @returns File content and hash
 */
export async function readFile(ws: Workspace, relPath: string): Promise<FileRead> {
  const abs = resolveSafe(ws.path, relPath);
  const content = await fsReadFile(abs, 'utf8');
  const baseHash = createHash('sha256').update(content).digest('hex');

  return {
    content,
    baseHash,
    encoding: 'utf8',
  };
}

/**
 * Writes a file to the workspace with conflict detection.
 * If the file changed externally since reading (baseHash mismatch),
 * throws ConflictError.
 *
 * @param ws - Workspace
 * @param relPath - Relative file path
 * @param content - New content to write
 * @param baseHash - Hash of original content
 * @returns New hash after write
 */
export async function writeFile(
  ws: Workspace,
  relPath: string,
  content: string,
  baseHash: string
): Promise<FileWrite> {
  const abs = resolveSafe(ws.path, relPath);

  // Read current content and check for conflicts
  const current = await fsReadFile(abs, 'utf8').catch(() => '');
  const currentHash = createHash('sha256').update(current).digest('hex');

  if (currentHash !== baseHash) {
    throw new ConflictError('file_changed_externally');
  }

  // Write new content
  await fsWriteFile(abs, content, 'utf8');
  const newHash = createHash('sha256').update(content).digest('hex');

  return { newHash };
}

/**
 * Error thrown when file changed externally during edit.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}