/**
 * Process utilities for running child processes
 */

import { type ChildProcess, spawn } from "child_process";

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe" | "ignore";
}

/**
 * Run a command and return a promise
 */
export function run(
  command: string,
  args: string[] = [],
  options: ProcessOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? "inherit",
      shell: true,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Run a command in the background and return the child process
 */
export function runBackground(
  command: string,
  args: string[] = [],
  options: ProcessOptions = {}
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    shell: true,
  });

  return child;
}

/**
 * Wait for all child processes to exit
 */
export async function waitForProcesses(processes: ChildProcess[]): Promise<void> {
  await Promise.all(
    processes.map(
      (p) =>
        new Promise<void>((resolve) => {
          p.on("close", () => resolve());
        })
    )
  );
}
