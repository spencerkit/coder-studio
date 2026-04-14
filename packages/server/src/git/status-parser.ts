/**
 * Git status parser for porcelain=v2 format.
 */

import type { GitStatus, GitFileChange } from '@coder-studio/core';

/**
 * Parses git status --porcelain=v2 --branch output.
 *
 * Format reference: https://git-scm.com/docs/git-status#_porcelain_format_version_2
 *
 * @param porcelainV2 - Output from git status --porcelain=v2 --branch
 * @returns Structured git status
 */
export function parseStatus(porcelainV2: string): GitStatus {
  const lines = porcelainV2.split('\n');

  let branch = '';
  let ahead = 0;
  let behind = 0;
  const staged: GitFileChange[] = [];
  const modified: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const deleted: GitFileChange[] = [];

  for (const line of lines) {
    if (!line) continue;

    // Branch header: # branch.oid <hash>
    // Branch name: # branch.head <name>
    if (line.startsWith('# branch.head ')) {
      branch = line.substring('# branch.head '.length);
    }

    // Ahead/behind: # branch.ab +<ahead> -<behind>
    if (line.startsWith('# branch.ab ')) {
      const match = line.match(/# branch\.ab \+(\d+) -(\d+)/);
      if (match) {
        ahead = parseInt(match[1], 10);
        behind = parseInt(match[2], 10);
      }
    }

    // Changed entries: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    // Format: https://git-scm.com/docs/git-status#_changed_tracked_entries
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      parseChangedEntry(line, staged, modified, deleted);
    }

    // Untracked entries: ? <path>
    if (line.startsWith('? ')) {
      const path = line.substring(2);
      untracked.push({ path });
    }
  }

  return {
    branch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    deleted,
  };
}

/**
 * Parses a changed entry line (format 1 or 2).
 */
function parseChangedEntry(
  line: string,
  staged: GitFileChange[],
  modified: GitFileChange[],
  deleted: GitFileChange[]
): void {
  const parts = line.split(' ');
  const xy = parts[1]; // XY status codes

  // Extract path (last part for format 1, second-to-last for format 2 renames)
  let path: string;
  let oldPath: string | undefined;

  if (line.startsWith('2 ')) {
    // Rename entry: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X> <path> <oldPath>
    const renameParts = line.split(' ');
    path = renameParts[renameParts.length - 2];
    oldPath = renameParts[renameParts.length - 1];
  } else {
    // Regular entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
    path = parts[parts.length - 1];
  }

  // Parse XY status codes
  // X = index status (staged)
  // Y = worktree status (modified)
  const indexStatus = xy[0];
  const worktreeStatus = xy[1];

  // Staged changes (index status)
  if (indexStatus !== '.' && indexStatus !== ' ') {
    const change: GitFileChange = { path, oldPath };
    if (indexStatus === 'D') {
      deleted.push(change);
    } else {
      staged.push(change);
    }
  }

  // Modified changes (worktree status)
  if (worktreeStatus !== '.' && worktreeStatus !== ' ') {
    const change: GitFileChange = { path };
    if (worktreeStatus === 'D') {
      deleted.push(change);
    } else {
      modified.push(change);
    }
  }
}
