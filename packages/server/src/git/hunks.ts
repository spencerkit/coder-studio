import { createHash } from "node:crypto";
import type { GitDiffHunk } from "@coder-studio/core";

interface ParseDiffHunksInput {
  diff: string;
  path: string;
  staged: boolean;
}

type BuildSingleHunkPatchInput = Omit<ParseDiffHunksInput, "diff">;

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkId(input: ParseDiffHunksInput, header: string, lines: string[]): string {
  const hash = createHash("sha256")
    .update(input.path)
    .update(input.staged ? "staged" : "unstaged")
    .update(header)
    .update(lines.join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `hunk_${hash}`;
}

function parseCount(value: string | undefined): number {
  return value ? Number.parseInt(value, 10) : 1;
}

function diffFileHeader(diffLines: string[]): string[] {
  const header: string[] = [];
  for (const line of diffLines) {
    if (line.startsWith("@@ ")) {
      break;
    }
    header.push(line);
  }
  return header;
}

export function parseDiffHunks(input: ParseDiffHunksInput): GitDiffHunk[] {
  const lines = input.diff.split("\n");
  const hunks: GitDiffHunk[] = [];
  let current: {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  } | null = null;

  const flush = () => {
    if (!current) {
      return;
    }

    const id = hunkId(input, current.header, current.lines);
    hunks.push({
      id,
      header: current.header,
      oldStart: current.oldStart,
      oldLines: current.oldLines,
      newStart: current.newStart,
      newLines: current.newLines,
      patch: [current.header, ...current.lines].join("\n"),
      lines: current.lines,
    });
  };

  for (const line of lines) {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (match) {
      flush();
      current = {
        header: line,
        oldStart: Number.parseInt(match[1]!, 10),
        oldLines: parseCount(match[2]),
        newStart: Number.parseInt(match[3]!, 10),
        newLines: parseCount(match[4]),
        lines: [],
      };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  flush();
  return hunks;
}

export function buildSingleHunkPatch(
  diff: string,
  requestedHunkId: string,
  input: BuildSingleHunkPatchInput
): string | null {
  const lines = diff.split("\n");
  const header = diffFileHeader(lines);
  const hunk = parseDiffHunks({ ...input, diff }).find(
    (candidate) => candidate.id === requestedHunkId
  );
  if (!hunk) {
    return null;
  }

  return [...header, hunk.patch, ""].join("\n");
}
