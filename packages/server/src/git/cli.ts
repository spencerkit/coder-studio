/**
 * Git CLI executor - Wrapper around git commands using child_process.execFile.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Executes a git command in the specified working directory.
 *
 * @param cwd - Working directory
 * @param args - Git command arguments
 * @returns Command output
 */
export async function runGit(cwd: string, args: string[]): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new GitError(err.message, stderr));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Error thrown when git command fails.
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string
  ) {
    super(message);
    this.name = 'GitError';
  }
}
