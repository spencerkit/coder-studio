/**
 * Lazy file tree builder.
 */

import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { FileNode } from '@coder-studio/core';

export interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

/**
 * Builds a file tree for a workspace directory.
 * This is a lazy implementation that reads files on demand.
 *
 * @param rootPath - Workspace root path
 * @param subdir - Optional subdirectory to start from
 * @returns File tree structure
 */
export async function readTree(rootPath: string, subdir?: string): Promise<ReadTreeResult> {
  const targetPath = subdir ? join(rootPath, subdir) : rootPath;
  const children = await buildTree(targetPath, rootPath);
  return {
    path: subdir || '.',
    children,
  };
}

/**
 * Recursive tree builder.
 *
 * @param currentPath - Current directory path
 * @param rootPath - Workspace root path for relative calculation
 * @returns Array of file nodes
 */
async function buildTree(currentPath: string, rootPath: string): Promise<FileNode[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    // Skip hidden files and common ignore patterns
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const fullPath = join(currentPath, entry.name);
    const relPath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, rootPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        kind: 'dir',
        children,
      });
    } else if (entry.isFile()) {
      const stats = await stat(fullPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        kind: 'file',
        size: stats.size,
        mtime: stats.mtimeMs,
      });
    }
  }

  // Sort: directories first, then files, alphabetically within each group
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return nodes;
}
