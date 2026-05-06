/**
 * Git commit operations.
 */

import { runGit } from "./cli.js";

/**
 * Stages files for commit.
 *
 * @param cwd - Working directory
 * @param paths - File paths to stage
 */
export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  await runGit(cwd, ["add", ...paths]);
}

/**
 * Unstages files.
 *
 * @param cwd - Working directory
 * @param paths - File paths to unstage
 */
export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  await runGit(cwd, ["reset", "HEAD", "--", ...paths]);
}

/**
 * Discards changes to files.
 *
 * @param cwd - Working directory
 * @param paths - File paths to discard
 */
export async function discardChanges(cwd: string, paths: string[]): Promise<void> {
  await runGit(cwd, ["checkout", "--", ...paths]);
}

/**
 * Creates a commit.
 *
 * @param cwd - Working directory
 * @param message - Commit message
 * @returns Commit SHA
 */
export async function createCommit(cwd: string, message: string): Promise<{ sha: string }> {
  await runGit(cwd, ["commit", "-m", message]);

  // Get the commit SHA
  const result = await runGit(cwd, ["rev-parse", "HEAD"]);
  return { sha: result.stdout.trim() };
}
