/**
 * Git diff operations.
 */

import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { resolveSafe } from "../fs/file-io.js";
import { getImageTypeInfo } from "../fs/image.js";
import { GitError, runGit } from "./cli.js";

export interface FileDiffResult {
  diff: string;
  renderAs: "text" | "image";
  status: "modified" | "added" | "deleted";
  originalContent?: string;
  modifiedContent?: string;
  originalRevision?: "HEAD" | "INDEX";
  modifiedRevision?: "INDEX" | "WORKTREE";
}

async function isTrackedPath(cwd: string, filePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ["ls-files", "--error-unmatch", "--", filePath]);
    return true;
  } catch {
    return false;
  }
}

async function getUntrackedFileDiff(cwd: string, filePath: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coder-studio-git-diff-"));
  const tempIndex = path.join(tempDir, "index");

  try {
    try {
      await runGit(cwd, ["read-tree", "HEAD"], {
        env: { GIT_INDEX_FILE: tempIndex },
      });
    } catch (error) {
      if (!(error instanceof GitError)) {
        throw error;
      }

      // Fresh repositories may not have HEAD yet; an empty temporary index is
      // sufficient for intent-to-add diffs in that case.
      await runGit(cwd, ["read-tree", "--empty"], {
        env: { GIT_INDEX_FILE: tempIndex },
      });
    }

    await runGit(cwd, ["add", "-N", "--", filePath], {
      env: { GIT_INDEX_FILE: tempIndex },
    });

    const result = await runGit(cwd, ["diff", "--", filePath], {
      env: { GIT_INDEX_FILE: tempIndex },
    });
    return result.stdout;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function pathExists(cwd: string, filePath: string): Promise<boolean> {
  try {
    await readFile(resolveSafe(cwd, filePath));
    return true;
  } catch {
    return false;
  }
}

async function readTextAtRevision(
  cwd: string,
  revision: "HEAD" | "INDEX" | "WORKTREE",
  filePath: string
) {
  if (revision === "WORKTREE") {
    return readFile(resolveSafe(cwd, filePath), "utf-8");
  }

  try {
    const gitSpec = revision === "INDEX" ? `:${filePath}` : `${revision}:${filePath}`;
    const result = await runGit(cwd, ["show", gitSpec]);
    return result.stdout;
  } catch {
    return "";
  }
}

async function deriveFileDiffStatus(
  cwd: string,
  filePath: string,
  staged: boolean
): Promise<"modified" | "added" | "deleted"> {
  const tracked = await isTrackedPath(cwd, filePath);
  const existsOnDisk = await pathExists(cwd, filePath);

  if (!staged && !tracked) {
    return "added";
  }

  if (staged) {
    try {
      await runGit(cwd, ["cat-file", "-e", `HEAD:${filePath}`]);
      return existsOnDisk ? "modified" : "deleted";
    } catch {
      return "added";
    }
  }

  return existsOnDisk ? "modified" : "deleted";
}

async function buildTextDiffResult(
  cwd: string,
  filePath: string,
  staged: boolean,
  diff: string
): Promise<FileDiffResult> {
  const status = await deriveFileDiffStatus(cwd, filePath, staged);

  if (status === "added") {
    return {
      diff,
      renderAs: "text",
      status,
      originalContent: "",
      modifiedContent: await readTextAtRevision(cwd, staged ? "INDEX" : "WORKTREE", filePath),
    };
  }

  if (status === "deleted") {
    return {
      diff,
      renderAs: "text",
      status,
      originalContent: await readTextAtRevision(cwd, staged ? "HEAD" : "INDEX", filePath),
      modifiedContent: "",
    };
  }

  return {
    diff,
    renderAs: "text",
    status,
    originalContent: await readTextAtRevision(cwd, staged ? "HEAD" : "INDEX", filePath),
    modifiedContent: await readTextAtRevision(cwd, staged ? "INDEX" : "WORKTREE", filePath),
  };
}

/**
 * Gets diff for a specific file.
 *
 * @param cwd - Working directory
 * @param path - File path (relative to cwd)
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getFileDiff(
  cwd: string,
  path: string,
  staged = false
): Promise<FileDiffResult> {
  const imageType = getImageTypeInfo(path);

  if (!staged && !(await isTrackedPath(cwd, path))) {
    const diff = await getUntrackedFileDiff(cwd, path);
    if (imageType) {
      return {
        diff,
        renderAs: "image",
        status: "added",
        originalRevision: "HEAD",
        modifiedRevision: "WORKTREE",
      };
    }

    return buildTextDiffResult(cwd, path, staged, diff);
  }

  const args = staged ? ["diff", "--staged", "--", path] : ["diff", "--", path];
  const result = await runGit(cwd, args);
  if (imageType && /Binary files .* differ/.test(result.stdout)) {
    return {
      diff: result.stdout,
      renderAs: "image",
      status: await deriveFileDiffStatus(cwd, path, staged),
      originalRevision: staged ? "HEAD" : "INDEX",
      modifiedRevision: staged ? "INDEX" : "WORKTREE",
    };
  }

  return buildTextDiffResult(cwd, path, staged, result.stdout);
}

/**
 * Gets full diff for the working directory.
 *
 * @param cwd - Working directory
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getDiff(cwd: string, staged = false): Promise<string> {
  const args = staged ? ["diff", "--staged"] : ["diff"];
  const result = await runGit(cwd, args);
  return result.stdout;
}
