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
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    if (options.stdio === "pipe") {
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk) => {
        stdoutChunks.push(chunk);
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk) => {
        stderrChunks.push(chunk);
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stdout = stdoutChunks.join("").trim();
        const stderr = stderrChunks.join("").trim();
        const detail = [stderr, stdout].filter((part) => part.length > 0).join("\n");
        reject(
          new Error(
            detail.length > 0
              ? `Process exited with code ${code}: ${detail}`
              : `Process exited with code ${code}`
          )
        );
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
  const settled = new Set<ChildProcess>();

  await new Promise<void>((resolve, reject) => {
    if (processes.length === 0) {
      resolve();
      return;
    }

    let rejected = false;

    const rejectOnce = (processToSkip: ChildProcess, error: Error) => {
      if (rejected) {
        return;
      }
      rejected = true;
      for (const processToKill of processes) {
        if (processToKill !== processToSkip && !settled.has(processToKill)) {
          processToKill.kill("SIGTERM");
        }
      }
      reject(error);
    };

    for (const child of processes) {
      child.on("close", (code, signal) => {
        settled.add(child);
        if (code !== 0) {
          const suffix =
            typeof code === "number" ? `code ${code}` : `signal ${signal ?? "unknown"}`;
          rejectOnce(child, new Error(`Process exited with ${suffix}`));
          return;
        }

        if (!rejected && settled.size === processes.length) {
          resolve();
        }
      });

      child.on("error", (err) => {
        settled.add(child);
        rejectOnce(child, err);
      });
    }
  });
}
