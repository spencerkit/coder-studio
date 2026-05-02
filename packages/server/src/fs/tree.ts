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

export interface SearchFilesResult {
  files: FileNode[];
}

export async function searchFiles(
  rootPath: string,
  query: string,
  limit = 10
): Promise<SearchFilesResult> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { files: [] };
  }

  const matches: Array<{ path: string; name: string; fullPath: string; rank: number }> = [];

  async function walk(dirPath: string): Promise<void> {
    const filter = createGitignoreFilter(rootPath, dirPath);
    const entries = await readdir(dirPath, { withFileTypes: true });

    const filteredEntries = entries.filter((entry) => filter(entry.name));
    filteredEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filteredEntries) {
      const fullPath = join(dirPath, entry.name);
      const relPath = relative(rootPath, fullPath);

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (entry.isFile()) {
        const rank = scoreFilenameMatch(entry.name, normalizedQuery);
        if (rank === null) {
          continue;
        }

        matches.push({
          path: relPath,
          name: entry.name,
          fullPath,
          rank,
        });
      }
    }
  }

  await walk(rootPath);

  const files: FileNode[] = [];
  for (const match of matches
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }

      const nameCompare = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (nameCompare !== 0) {
        return nameCompare;
      }

      const depthCompare = a.path.split('/').length - b.path.split('/').length;
      if (depthCompare !== 0) {
        return depthCompare;
      }

      return a.path.toLowerCase().localeCompare(b.path.toLowerCase());
    })
    .slice(0, limit)) {
    const stats = await stat(match.fullPath);
    files.push({
      name: match.name,
      path: match.path,
      kind: 'file',
      size: stats.size,
      mtime: stats.mtimeMs,
    });
  }

  return { files };
}

function scoreFilenameMatch(name: string, query: string): number | null {
  const normalizedName = name.toLowerCase();
  const baseName = normalizedName.replace(/\.[^.]+$/, '');

  if (normalizedName === query) {
    return 0;
  }

  if (baseName === query) {
    return 1;
  }

  if (normalizedName.startsWith(query)) {
    return 2;
  }

  if (baseName.startsWith(query)) {
    return 3;
  }

  if (normalizedName.includes(query)) {
    return 4;
  }

  if (baseName.includes(query)) {
    return 5;
  }

  if (isSubsequence(query, normalizedName)) {
    return 6;
  }

  return null;
}

function isSubsequence(query: string, candidate: string): boolean {
  let index = 0;

  for (const char of candidate) {
    if (char === query[index]) {
      index += 1;
      if (index === query.length) {
        return true;
      }
    }
  }

  return query.length === 0;
}
