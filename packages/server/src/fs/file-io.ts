/**
 * File IO operations with conflict detection.
 */

import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { createHash } from 'crypto';

export interface FileReadResult {
  content: string;
  baseHash: string;
  encoding: 'utf-8';
}

export interface FileWriteResult {
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
    throw { code: 'path_escape', message: 'Path escapes workspace root' };
  }

  return abs;
}

/**
 * Reads a file from the workspace with baseHash for conflict detection.
 *
 * @param rootPath - Workspace root path
 * @param relPath - Relative file path
 * @returns File content and hash
 */
export async function readFile(rootPath: string, relPath: string): Promise<FileReadResult> {
  const abs = resolveSafe(rootPath, relPath);
  const content = await fsReadFile(abs, 'utf-8');
  const baseHash = createHash('sha256').update(content).digest('hex');

  return {
    content,
    baseHash,
    encoding: 'utf-8',
  };
}

/**
 * Writes a file to the workspace with conflict detection.
 * If the file changed externally since reading (baseHash mismatch),
 * throws conflict error.
 *
 * @param rootPath - Workspace root path
 * @param relPath - Relative file path
 * @param content - New content to write
 * @param baseHash - Hash of original content (optional)
 * @returns New hash after write
 */
export async function writeFile(
  rootPath: string,
  relPath: string,
  content: string,
  baseHash?: string
): Promise<FileWriteResult> {
  const abs = resolveSafe(rootPath, relPath);

  // Conflict check if baseHash provided
  if (baseHash) {
    const current = await fsReadFile(abs, 'utf-8').catch(() => '');
    const currentHash = createHash('sha256').update(current).digest('hex');

    if (currentHash !== baseHash) {
      throw {
        code: 'conflict',
        message: 'File has been modified externally',
        details: {
          expectedHash: baseHash,
          actualHash: currentHash,
        },
      };
    }
  }

  // Ensure parent directory exists
  await mkdir(dirname(abs), { recursive: true });

  // Write new content
  await fsWriteFile(abs, content, 'utf-8');
  const newHash = createHash('sha256').update(content).digest('hex');

  return { newHash };
}
