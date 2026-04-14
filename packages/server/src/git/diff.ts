/**
 * Git diff operations.
 */

import { runGit } from './cli.js';

/**
 * Gets diff for a specific file.
 *
 * @param cwd - Working directory
 * @param path - File path (relative to cwd)
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getFileDiff(cwd: string, path: string, staged = false): Promise<string> {
  const args = staged ? ['diff', '--staged', '--', path] : ['diff', '--', path];
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
  const args = staged ? ['diff', '--staged'] : ['diff'];
  const result = await runGit(cwd, args);
  return result.stdout;
}
