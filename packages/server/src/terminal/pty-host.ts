/**
 * PTY Host Implementation
 *
 * Concrete implementation of PtyHost using node-pty
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveSpawnArgv } from "@coder-studio/utils";
import type * as NodePty from "node-pty";
import type { PtyHost, PtyProcess, PtySpawnOptions } from "./types.js";

const require = createRequire(import.meta.url);
const NODE_PTY_PKG = "node-pty/package.json";
const WSL_NODE_PTY_SOURCE_PACKAGE_JSON_ENV = "CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON";
const WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON_ENV =
  "CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON";
const WSL_NODE_PTY_STAGING_ROOT_ENV = "CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT";
const WSL_NODE_PTY_STAMP_FILE = ".coder-studio-node-pty-stamp";

export interface EnsureWslLocalNodePtyPackageOptions {
  env?: NodeJS.ProcessEnv;
  nodeAbi?: string;
  arch?: NodeJS.Architecture;
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: BufferEncoding) => string;
  writeFileSync?: (path: string, contents: string) => void;
  mkdirSync?: (path: string, options?: { recursive?: boolean }) => void;
  rmSync?: (path: string, options?: { recursive?: boolean; force?: boolean }) => void;
  cpSync?: (
    src: string,
    dest: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      dereference?: boolean;
      filter?: (src: string) => boolean;
    }
  ) => void;
  spawnSync?: typeof spawnSync;
}

function expandHomePath(input: string, env: NodeJS.ProcessEnv): string {
  if (input === "~") {
    return env.HOME?.trim() || input;
  }

  if (input.startsWith("~/") && env.HOME?.trim()) {
    return path.posix.join(env.HOME.trim(), input.slice(2));
  }

  return input;
}

function getPreparedNodePtyPaths(stagingRoot: string) {
  return {
    stagedNodePtySourceRoot: path.posix.join(stagingRoot, "package-sources", "node-pty"),
    stagedNodeAddonApiSourceRoot: path.posix.join(stagingRoot, "package-sources", "node-addon-api"),
    localPackageJsonPath: path.posix.join(stagingRoot, "node_modules", "node-pty", "package.json"),
    localNativeBinaryPath: path.posix.join(
      stagingRoot,
      "node_modules",
      "node-pty",
      "build",
      "Release",
      "pty.node"
    ),
    stampFilePath: path.posix.join(stagingRoot, WSL_NODE_PTY_STAMP_FILE),
  };
}

function getNodePtyStampKey(version: string, nodeAbi: string, arch: NodeJS.Architecture): string {
  return `${version}|${nodeAbi}|${arch}`;
}

function shouldCopyNodePtySourceFile(sourceRoot: string, sourcePath: string): boolean {
  const normalizedRoot = sourceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = sourcePath.replace(/\\/g, "/");
  const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath === normalizedRoot
      ? ""
      : normalizedPath;

  if (relativePath === "node_modules") {
    return false;
  }

  return !relativePath.includes("node_modules/");
}

function rewriteNodePtySourcePackageJson(packageJson: string): string {
  const sourcePackage = JSON.parse(packageJson) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  const nextScripts = { ...(sourcePackage.scripts ?? {}) };
  delete nextScripts.prepare;
  delete nextScripts.build;
  delete nextScripts.watch;
  delete nextScripts.prepublishOnly;

  return `${JSON.stringify(
    {
      ...sourcePackage,
      dependencies: {
        ...(sourcePackage.dependencies ?? {}),
        "node-addon-api": "file:../node-addon-api",
      },
      scripts: nextScripts,
    },
    null,
    2
  )}\n`;
}

function getInstallFailureMessage(result: ReturnType<typeof spawnSync>): string {
  if (result.error instanceof Error) {
    return result.error.message;
  }

  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return stderr || stdout || `npm install exited with code ${result.status ?? "unknown"}`;
}

function resolveNpmInstallCommand(exists: (path: string) => boolean): {
  file: string;
  args: string[];
} {
  const candidate = path.resolve(
    process.execPath,
    "..",
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  if (exists(candidate)) {
    return {
      file: process.execPath,
      args: [candidate],
    };
  }

  return {
    file: "npm",
    args: [],
  };
}

export function ensureWslLocalNodePtyPackage(
  options: EnsureWslLocalNodePtyPackageOptions = {}
): string | undefined {
  const env = options.env ?? process.env;
  const sourcePackageJsonPath = env[WSL_NODE_PTY_SOURCE_PACKAGE_JSON_ENV]?.trim();
  const addonPackageJsonPath = env[WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON_ENV]?.trim();
  const stagingRootRaw = env[WSL_NODE_PTY_STAGING_ROOT_ENV]?.trim();

  if (!sourcePackageJsonPath || !addonPackageJsonPath || !stagingRootRaw) {
    return undefined;
  }

  const fileExists = options.existsSync ?? existsSync;
  const readFile =
    options.readFileSync ??
    ((file: string, encoding: BufferEncoding) =>
      require("node:fs").readFileSync(file, encoding) as string);
  const writeFile =
    options.writeFileSync ??
    ((file: string, contents: string) => require("node:fs").writeFileSync(file, contents));
  const makeDir =
    options.mkdirSync ??
    ((dir: string, mkdirOptions?: { recursive?: boolean }) =>
      require("node:fs").mkdirSync(dir, mkdirOptions));
  const removeDir =
    options.rmSync ??
    ((dir: string, rmOptions?: { recursive?: boolean; force?: boolean }) =>
      require("node:fs").rmSync(dir, rmOptions));
  const copyDir =
    options.cpSync ??
    ((
      src: string,
      dest: string,
      copyOptions?: {
        recursive?: boolean;
        force?: boolean;
        dereference?: boolean;
        filter?: (src: string) => boolean;
      }
    ) => require("node:fs").cpSync(src, dest, copyOptions));
  const runInstall = options.spawnSync ?? spawnSync;

  if (!fileExists(sourcePackageJsonPath)) {
    throw new Error(`Missing node-pty package source at ${sourcePackageJsonPath}`);
  }
  if (!fileExists(addonPackageJsonPath)) {
    throw new Error(`Missing node-addon-api package source at ${addonPackageJsonPath}`);
  }

  const sourcePackage = JSON.parse(readFile(sourcePackageJsonPath, "utf8")) as { version?: string };
  const sourceVersion = sourcePackage.version?.trim();
  if (!sourceVersion) {
    throw new Error(`Unable to read node-pty version from ${sourcePackageJsonPath}`);
  }

  const nodeAbi = options.nodeAbi ?? process.versions.modules;
  const arch = options.arch ?? process.arch;
  const stagingRoot = expandHomePath(stagingRootRaw, env);
  const {
    stagedNodePtySourceRoot,
    stagedNodeAddonApiSourceRoot,
    localPackageJsonPath,
    localNativeBinaryPath,
    stampFilePath,
  } = getPreparedNodePtyPaths(stagingRoot);
  const stampKey = getNodePtyStampKey(sourceVersion, nodeAbi, arch);

  if (
    fileExists(localPackageJsonPath) &&
    fileExists(localNativeBinaryPath) &&
    fileExists(stampFilePath) &&
    readFile(stampFilePath, "utf8").trim() === stampKey
  ) {
    return localPackageJsonPath;
  }

  removeDir(stagingRoot, { recursive: true, force: true });
  makeDir(stagingRoot, { recursive: true });

  copyDir(path.posix.dirname(sourcePackageJsonPath), stagedNodePtySourceRoot, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (sourcePath: string) =>
      shouldCopyNodePtySourceFile(path.posix.dirname(sourcePackageJsonPath), sourcePath),
  });
  copyDir(path.posix.dirname(addonPackageJsonPath), stagedNodeAddonApiSourceRoot, {
    recursive: true,
    force: true,
    dereference: true,
  });

  writeFile(
    path.posix.join(stagedNodePtySourceRoot, "package.json"),
    rewriteNodePtySourcePackageJson(readFile(sourcePackageJsonPath, "utf8"))
  );

  writeFile(
    path.posix.join(stagingRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "coder-studio-wsl-node-pty",
        private: true,
        dependencies: {
          "node-pty": "file:./package-sources/node-pty",
          "node-addon-api": "file:./package-sources/node-addon-api",
        },
      },
      null,
      2
    )}\n`
  );

  const installEnv = {
    ...Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => !!entry[1])
    ),
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  const installCommand = resolveNpmInstallCommand(fileExists);
  const installResult = runInstall(
    installCommand.file,
    [...installCommand.args, "install", "--build-from-source", "--no-package-lock", "--omit=dev"],
    {
      cwd: stagingRoot,
      env: installEnv,
      encoding: "utf8",
    }
  );

  if (installResult.status !== 0) {
    throw new Error(
      `Unable to prepare WSL-local node-pty package. ${getInstallFailureMessage(installResult)}`
    );
  }

  if (!fileExists(localPackageJsonPath) || !fileExists(localNativeBinaryPath)) {
    throw new Error(
      `WSL-local node-pty install did not produce ${localNativeBinaryPath}. Check npm and build tools inside WSL.`
    );
  }

  writeFile(stampFilePath, stampKey);
  return localPackageJsonPath;
}

/**
 * Options for kill escalation polling
 */
export interface KillEscalationOptions {
  /** Poll interval in milliseconds */
  pollIntervalMs?: number;
  /** Maximum time to wait before escalating to SIGKILL */
  timeoutMs?: number;
}

/** Default polling interval */
const DEFAULT_POLL_INTERVAL_MS = 50;

/** Default timeout before SIGKILL escalation */
const DEFAULT_TIMEOUT_MS = 2000;

export function ensureNodePtySpawnHelperExecutable(
  deps: {
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
    resolve?: (id: string) => string;
    existsSync?: (path: string) => boolean;
    statSync?: (path: string) => { mode: number };
    chmodSync?: (path: string, mode: number) => void;
  } = {}
): void {
  const platform = deps.platform ?? process.platform;
  if (platform !== "darwin") {
    return;
  }
  const arch = deps.arch ?? process.arch;

  const resolve = deps.resolve ?? ((id: string) => require.resolve(id));
  const fileExists = deps.existsSync ?? existsSync;
  const stat = deps.statSync ?? statSync;
  const chmod = deps.chmodSync ?? chmodSync;

  let packageJsonPath: string;
  try {
    packageJsonPath = resolve(NODE_PTY_PKG);
  } catch {
    return;
  }

  const packageDir = path.dirname(packageJsonPath);
  const helperDir = arch === "arm64" ? "darwin-arm64" : arch === "x64" ? "darwin-x64" : null;
  if (!helperDir) {
    return;
  }

  const helperPath = path.join(packageDir, "prebuilds", helperDir, "spawn-helper");

  try {
    if (!fileExists(helperPath)) {
      return;
    }

    const currentMode = stat(helperPath).mode;
    const executableMode = currentMode | 0o111;
    if (executableMode === currentMode) {
      return;
    }

    chmod(helperPath, executableMode);
  } catch {
    // Best-effort repair only. Fall back to node-pty's normal startup path.
  }
}

/**
 * Send signal to process and all its children (process group)
 *
 * @param pid - Process ID (will use -pid for process group)
 * @param signal - Signal to send
 * @returns true if signal was sent successfully, false otherwise
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    // Negative PID means kill the process group
    // This ensures all child processes are terminated as well
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fallback to regular kill if process group doesn't exist
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Check if a process group or process is still alive
 *
 * Mirrors the same group-first, pid-fallback semantics used when sending signals.
 *
 * @param pid - Process ID (will use -pid for process group first)
 * @returns true if the process group or process exists, false otherwise
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Escalate from SIGTERM to SIGKILL with polling
 *
 * This function sends SIGTERM, then polls to check if the process
 * has exited. If it hasn't exited within the timeout window, SIGKILL
 * is sent.
 *
 * @param pid - Process ID
 * @param signal - Initial signal to send
 * @param options - Polling options
 * @returns Promise resolving to true if any signal was sent, false if initial signal failed
 */
export async function escalateKillWithPolling(
  pid: number,
  signal: NodeJS.Signals,
  options?: KillEscalationOptions
): Promise<boolean> {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // For non-SIGTERM signals, just send directly without polling
  if (signal !== "SIGTERM") {
    return killProcessGroup(pid, signal);
  }

  // Send SIGTERM
  const sent = killProcessGroup(pid, "SIGTERM");
  if (!sent) {
    return false;
  }

  // Check immediately if process already exited
  if (!isProcessAlive(pid)) {
    return true;
  }

  // Poll until timeout
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  while (Date.now() < deadline) {
    // Wait for next poll interval
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

    // Check if process group has exited
    if (!isProcessAlive(pid)) {
      return true;
    }
  }

  // Process survived timeout, escalate to SIGKILL
  killProcessGroup(pid, "SIGKILL");
  return true;
}

/**
 * Real PTY host using node-pty
 * Note: node-pty is loaded lazily to avoid native module loading errors during startup
 */
export class NodePtyHost implements PtyHost {
  constructor(
    private readonly deps: {
      ensureWslLocalNodePtyPackage?: (
        options?: EnsureWslLocalNodePtyPackageOptions
      ) => string | undefined;
      createRequire?: typeof createRequire;
      defaultRequire?: NodeRequire;
    } = {}
  ) {}

  spawn(argv: string[], options: PtySpawnOptions): PtyProcess {
    ensureNodePtySpawnHelperExecutable();

    // Lazy load node-pty to avoid native module loading errors
    let pty: typeof NodePty;
    try {
      const localNodePtyPackageJsonPath =
        this.deps.ensureWslLocalNodePtyPackage?.() ?? ensureWslLocalNodePtyPackage();
      if (localNodePtyPackageJsonPath) {
        const localRequire = (this.deps.createRequire ?? createRequire)(
          localNodePtyPackageJsonPath
        );
        pty = localRequire(path.dirname(localNodePtyPackageJsonPath)) as typeof NodePty;
      } else {
        pty = (this.deps.defaultRequire ?? require)("node-pty") as typeof NodePty;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`node-pty native module not available. ${message}`);
    }

    if (argv.length === 0) {
      throw new Error("PTY spawn requires a command");
    }

    // On Windows, node-pty calls Win32 CreateProcess directly and cannot run
    // .cmd/.bat shims. resolveSpawnArgv walks PATH+PATHEXT and unwraps
    // npm-style cmd-shims into a `node <entry.js>` invocation. On non-win32
    // platforms this returns argv unchanged.
    const [command, ...args] = resolveSpawnArgv(argv, {
      pathEnv: options.env.Path ?? options.env.PATH,
      pathExt: options.env.PATHEXT,
    });
    if (command === undefined) {
      throw new Error("PTY spawn requires a command");
    }

    const ptyProcess = pty.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows,
    });

    return {
      pid: ptyProcess.pid,
      onData: (callback) => {
        ptyProcess.onData(callback);
      },
      onExit: (callback) => {
        ptyProcess.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) =>
          callback({ exitCode, signal, reason: "exit" })
        );
      },
      write: (data) => {
        if (Buffer.isBuffer(data)) {
          ptyProcess.write(data.toString("utf-8"));
        } else {
          ptyProcess.write(data);
        }
      },
      resize: (cols, rows) => {
        ptyProcess.resize(cols, rows);
      },
      kill: async (signal: NodeJS.Signals = "SIGTERM") => {
        const pid = ptyProcess.pid;

        if (pid > 0) {
          // First try node-pty's built-in kill
          try {
            ptyProcess.kill(signal);
          } catch {
            // Ignore errors from ptyProcess.kill
          }

          // Also send to process group to ensure child processes are terminated
          // This handles cases where shell spawns child processes
          try {
            await escalateKillWithPolling(pid, signal);
          } catch {
            // Silently ignore errors from escalation polling
          }
        }
      },
    };
  }
}
