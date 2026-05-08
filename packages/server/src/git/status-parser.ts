/**
 * Git status parser for porcelain=v2 format.
 */

import type { GitChangeStatus, GitFileChange, GitStatus } from "@coder-studio/core";

/**
 * Parses git status --porcelain=v2 --branch output.
 *
 * Format reference: https://git-scm.com/docs/git-status#_porcelain_format_version_2
 *
 * @param porcelainV2 - Output from git status --porcelain=v2 --branch
 * @returns Structured git status
 */
export function parseStatus(porcelainV2: string): GitStatus {
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let headSha: string | undefined;
  const staged: GitFileChange[] = [];
  const modified: GitFileChange[] = [];
  const untracked: GitFileChange[] = [];
  const deleted: GitFileChange[] = [];
  const records = porcelainV2.includes("\0")
    ? porcelainV2.split("\0").filter((record) => record.length > 0)
    : porcelainV2.split("\n").filter((record) => record.length > 0);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    if (record.startsWith("# branch.oid ")) {
      const oid = record.substring("# branch.oid ".length);
      if (oid && oid !== "(initial)") {
        headSha = oid;
      }
      continue;
    }

    if (record.startsWith("# branch.head ")) {
      branch = record.substring("# branch.head ".length);
      continue;
    }

    if (record.startsWith("# branch.ab ")) {
      const match = record.match(/# branch\.ab \+(\d+) -(\d+)/);
      const nextAhead = match?.[1];
      const nextBehind = match?.[2];
      if (nextAhead && nextBehind) {
        ahead = parseInt(nextAhead, 10);
        behind = parseInt(nextBehind, 10);
      }
      continue;
    }

    if (record.startsWith("1 ")) {
      parseOrdinaryChangedEntry(record, staged, modified, deleted);
      continue;
    }

    if (record.startsWith("2 ")) {
      const oldPath = records[index + 1];
      parseRenamedEntry(record, oldPath, staged, modified, deleted);
      if (oldPath) {
        index += 1;
      }
      continue;
    }

    if (record.startsWith("? ")) {
      untracked.push({ path: record.substring(2), status: "untracked" });
    }
  }

  return {
    branch,
    ahead,
    behind,
    headSha,
    headShortSha: headSha?.slice(0, 7),
    staged,
    modified,
    untracked,
    deleted,
  };
}

/**
 * Parses a regular changed entry line (format 1).
 */
function parseOrdinaryChangedEntry(
  record: string,
  staged: GitFileChange[],
  modified: GitFileChange[],
  deleted: GitFileChange[]
): void {
  const parts = record.split(" ");
  const xy = parts[1]; // XY status codes
  if (!xy) {
    return;
  }

  const path = parts.slice(8).join(" ");
  if (!path) {
    return;
  }

  pushChange({ path }, xy, staged, modified, deleted);
}

/**
 * Parses a renamed entry line (format 2). In NUL-delimited mode the old path
 * is carried in the following record rather than inline.
 */
function parseRenamedEntry(
  record: string,
  oldPathRecord: string | undefined,
  staged: GitFileChange[],
  modified: GitFileChange[],
  deleted: GitFileChange[]
): void {
  const parts = record.split(" ");
  const xy = parts[1];
  if (!xy) {
    return;
  }

  const pathTokens = parts.slice(9);
  const pathAndMaybeOldPath = pathTokens.join(" ");
  const inlinePathParts = pathAndMaybeOldPath.split("\t");
  const fallbackPath =
    !oldPathRecord && inlinePathParts.length === 1 && pathTokens.length > 1
      ? pathTokens.slice(0, -1).join(" ")
      : undefined;
  const path = fallbackPath ?? inlinePathParts[0];
  if (!path) {
    return;
  }

  const oldPath =
    (oldPathRecord && !oldPathRecord.startsWith("#") ? oldPathRecord : undefined) ??
    inlinePathParts[1] ??
    (pathTokens.length > 1 ? pathTokens[pathTokens.length - 1] : undefined);
  pushChange({ path, oldPath }, xy, staged, modified, deleted);
}

function pushChange(
  change: GitFileChange,
  xy: string,
  staged: GitFileChange[],
  modified: GitFileChange[],
  deleted: GitFileChange[]
): void {
  const indexStatus = xy[0];
  const worktreeStatus = xy[1];

  if (indexStatus && indexStatus !== "." && indexStatus !== " ") {
    staged.push({
      ...change,
      status: resolveGitChangeStatus(indexStatus, change.oldPath),
    });
  }

  if (!worktreeStatus || worktreeStatus === "." || worktreeStatus === " ") {
    return;
  }

  if (worktreeStatus === "D") {
    deleted.push({ path: change.path, status: "deleted" });
    return;
  }

  modified.push({
    path: change.path,
    oldPath: change.oldPath,
    status: resolveGitChangeStatus(worktreeStatus, change.oldPath),
  });
}

function resolveGitChangeStatus(code: string, oldPath?: string): GitChangeStatus {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return oldPath ? "renamed" : "added";
    case "U":
      return "modified";
    case "M":
    case "T":
    default:
      return oldPath ? "renamed" : "modified";
  }
}
