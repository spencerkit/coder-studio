/**
 * Git diff operations.
 */

import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";
import { GitError, runGit } from "./cli.js";

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

/**
 * Gets diff for a specific file.
 *
 * @param cwd - Working directory
 * @param path - File path (relative to cwd)
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getFileDiff(cwd: string, path: string, staged = false): Promise<string> {
  if (!staged && !(await isTrackedPath(cwd, path))) {
    return getUntrackedFileDiff(cwd, path);
  }

  const args = staged ? ["diff", "--staged", "--", path] : ["diff", "--", path];
  const result = await runGit(cwd, args);
  return result.stdout;
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
