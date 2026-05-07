/**
 * Process utilities for running child processes
 */

import { isDirectExecution, shouldUseShellForCommand } from "@coder-studio/utils";
import { type ChildProcess, type SpawnOptions, spawn } from "child_process";

export { isDirectExecution, shouldUseShellForCommand };

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe" | "ignore";
}

interface SpawnConfig {
  command: string;
  options: ProcessOptions;
  platform?: NodeJS.Platform;
}

function createSpawnOptions({
  command,
  options,
  platform = process.platform,
}: SpawnConfig): SpawnOptions {
  return {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
    shell: shouldUseShellForCommand(command, platform),
    windowsHide: true,
  };
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
    const child = spawn(command, args, createSpawnOptions({ command, options }));

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
  const child = spawn(command, args, createSpawnOptions({ command, options }));

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
