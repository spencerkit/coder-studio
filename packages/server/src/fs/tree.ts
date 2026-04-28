/**
 * Lazy file tree builder.
 * Returns only direct children of a directory (no recursion).
 */

import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { FileNode } from '@coder-studio/core';
import { createGitignoreFilter } from './gitignore.js';

export interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

/**
 * Builds a file tree for a workspace directory.
 * Only returns direct children of the requested directory (lazy loading).
 * Directories have `children: undefined` to signal "not loaded yet".
 *
 * @param rootPath - Workspace root path
 * @param subdir - Optional subdirectory to read from
 * @returns File tree structure with only direct children
 */
export async function readTree(rootPath: string, subdir?: string): Promise<ReadTreeResult> {
  const targetPath = subdir ? join(rootPath, subdir) : rootPath;
  const filter = createGitignoreFilter(rootPath, targetPath);

  const entries = await readdir(targetPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    if (!filter(entry.name)) {
      continue;
    }

    const fullPath = join(targetPath, entry.name);
    const relPath = relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        kind: 'dir',
        children: undefined, // Not loaded yet - client will request on expand
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

  return {
    path: subdir || '.',
    children: nodes,
  };
}
