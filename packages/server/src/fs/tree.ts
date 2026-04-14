/**
 * Lazy file tree builder.
 */

import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import type { FileNode } from '@coder-studio/core';
import type { Workspace } from '@coder-studio/core';

/**
 * Builds a file tree for a workspace directory.
 * This is a lazy implementation that reads files on demand.
 *
 * @param ws - Workspace
 * @param subdir - Optional subdirectory to start from
 * @returns File tree structure
 */
export async function buildFileTree(ws: Workspace, subdir?: string): Promise<FileNode[]> {
  const rootPath = subdir ? join(ws.path, subdir) : ws.path;
  return buildTree(rootPath, ws.path);
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
      nodes.push({
        name: entry.name,
        path: relPath,
        kind: 'dir',
        children: [], // Lazy: children loaded on demand
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

/**
 * Loads children for a specific directory node.
 * This enables lazy loading of the file tree.
 *
 * @param ws - Workspace
 * @param dirPath - Directory path relative to workspace
 * @returns Array of child file nodes
 */
export async function loadDirectoryChildren(ws: Workspace, dirPath: string): Promise<FileNode[]> {
  const fullPath = join(ws.path, dirPath);
  return buildTree(fullPath, ws.path);
}
