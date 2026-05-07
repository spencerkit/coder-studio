/**
 * Process utilities for running child processes
 */

import { type ChildProcess, type SpawnOptions, spawn } from "child_process";
import { posix, resolve } from "path";

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

const WINDOWS_CMD_SHIMS = new Set(["pnpm", "npm", "npx"]);

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function normalizeComparablePath(path: string): string {
  let normalized = path.replace(/\\/g, "/");

  if (/^\/[A-Za-z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }

  if (normalized.startsWith("//")) {
    normalized = `//${posix.normalize(normalized.slice(2))}`;
  } else {
    normalized = posix.normalize(normalized);
  }

  if (isWindowsDrivePath(normalized) || normalized.startsWith("//")) {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function normalizeModuleUrlPath(moduleUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(moduleUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "file:") {
    return null;
  }

  const path = `${url.host ? `//${url.host}` : ""}${decodeURIComponent(url.pathname)}`;
  return normalizeComparablePath(path);
}

function normalizeArgvPath(argv1: string): string {
  const isAbsoluteWindowsPath = /^[A-Za-z]:[\\/]/.test(argv1) || /^\\\\/.test(argv1);
  return normalizeComparablePath(isAbsoluteWindowsPath ? argv1 : resolve(argv1));
}

export function isDirectExecution(moduleUrl: string, argv1: string | undefined = process.argv[1]) {
  if (argv1 === undefined) {
    return false;
  }

  const modulePath = normalizeModuleUrlPath(moduleUrl);

  if (modulePath === null) {
    return false;
  }

  return modulePath === normalizeArgvPath(argv1);
}

export function shouldUseShellForCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "win32" && WINDOWS_CMD_SHIMS.has(command.toLowerCase());
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
