import {
  execFile as execFileChild,
  type Serializable,
  spawn as spawnChild,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  deleteRuntimeConfig,
  type RuntimeConfig,
  readRuntimeConfig,
} from "@coder-studio/core/runtime";
import { type EmbeddedRuntimePathInput, resolveEmbeddedRuntimePaths } from "./runtime-paths.js";

export { resolveEmbeddedRuntimePaths } from "./runtime-paths.js";

export interface SidecarPaths {
  runtimeDir: string;
  nodeExecutable: string;
  runtimeEntry: string;
  runtimeVersion?: string;
  webRoot: string;
  runtimeJsonPath: string;
}

export interface HealthyRuntime {
  browserUrl: string;
  runtime: RuntimeConfig;
}

export interface StartDesktopSidecarInput {
  paths: SidecarPaths;
  stateDir: string;
  hostOverride?: string;
  portOverride?: number;
  password?: string;
  appVersion?: string;
}

export interface StartedDesktopSidecar extends EventEmitter {
  child: ChildProcessLike;
  browserUrl: string;
  runtime: RuntimeConfig;
  getLogExcerpt(): string;
  send(message: unknown): void;
  stop(timeoutMs?: number): Promise<void>;
}

interface SidecarStartupError extends Error {
  logExcerpt?: string;
}

interface ChildProcessLike extends EventEmitter {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout?: EventEmitter | null;
  stderr?: EventEmitter | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  send?(message: Serializable): boolean;
}

type SpawnSidecarProcess = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "pipe", "ipc"];
    windowsHide: boolean;
  }
) => ChildProcessLike;

function toBrowserUrl(runtime: RuntimeConfig): string {
  const host =
    runtime.host === "localhost" || runtime.host === "0.0.0.0" ? "127.0.0.1" : runtime.host;
  return `http://${host}:${runtime.port}`;
}

export async function waitForHealthyRuntime(input: {
  readRuntimeConfig: () => RuntimeConfig | null;
  checkUrl: (url: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  startedAt: number;
  expectedPid?: number;
  now?: () => number;
}): Promise<HealthyRuntime> {
  const now = input.now ?? (() => Date.now());
  let lastHealthCheckError: Error | null = null;

  while (now() - input.startedAt <= input.timeoutMs) {
    const runtime = input.readRuntimeConfig();
    if (runtime && (input.expectedPid === undefined || runtime.pid === input.expectedPid)) {
      const browserUrl = toBrowserUrl(runtime);
      try {
        await input.checkUrl(browserUrl);
        return { browserUrl, runtime };
      } catch (error) {
        lastHealthCheckError = error instanceof Error ? error : new Error(String(error));
      }
    }

    await input.sleep(100);
  }

  if (lastHealthCheckError) {
    throw new Error(
      `Timed out waiting for the desktop sidecar runtime: ${lastHealthCheckError.message}`
    );
  }

  throw new Error("Timed out waiting for the desktop sidecar runtime");
}

const RUNTIME_NATIVE_EXTERNALS = ["node-pty"] as const;

const execFileAsync = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: string }
): Promise<void> =>
  new Promise((resolve, reject) => {
    execFileChild(command, args, options, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

export async function installRuntimeDependencies(input: {
  runtimeDir: string;
  nodeExecutable: string;
}): Promise<void> {
  const packages = RUNTIME_NATIVE_EXTERNALS;
  const nodeModulesDir = join(input.runtimeDir, "node_modules");
  const allInstalled = packages.every((pkg) => existsSync(join(nodeModulesDir, pkg)));
  if (allInstalled) {
    return;
  }

  const nodeBin = dirname(input.nodeExecutable);
  const npmBin = join(nodeBin, process.platform === "win32" ? "npm.cmd" : "npm");
  await execFileAsync(npmBin, ["install", ...packages], {
    cwd: input.runtimeDir,
    stdio: "inherit",
  });
}

export async function startDesktopSidecar(
  input: StartDesktopSidecarInput,
  deps: {
    spawn?: SpawnSidecarProcess;
    waitForHealthyRuntime?: typeof waitForHealthyRuntime;
    installRuntimeDependencies?: typeof installRuntimeDependencies;
  } = {}
): Promise<StartedDesktopSidecar> {
  mkdirSync(dirname(input.paths.runtimeJsonPath), { recursive: true });
  mkdirSync(input.stateDir, { recursive: true });
  deleteRuntimeConfig(input.paths.runtimeJsonPath);

  const install = deps.installRuntimeDependencies ?? installRuntimeDependencies;
  await install({
    runtimeDir: input.paths.runtimeDir,
    nodeExecutable: input.paths.nodeExecutable,
  });

  const logChunks: string[] = [];
  const appendLogChunk = (source: "stdout" | "stderr", chunk: Buffer | string): void => {
    const text = `${source}: ${chunk.toString().trim()}`.trim();
    if (!text) {
      return;
    }

    logChunks.push(text);
    if (logChunks.length > 40) {
      logChunks.splice(0, logChunks.length - 40);
    }
  };
  const getLogExcerpt = (): string => logChunks.join("\n");

  const spawn = deps.spawn ?? (spawnChild as unknown as SpawnSidecarProcess);
  const child = spawn(input.paths.nodeExecutable, [input.paths.runtimeEntry], {
    env: {
      ...process.env,
      CODER_STUDIO_DESKTOP_PORT: String(input.portOverride ?? 0),
      CODER_STUDIO_DESKTOP_STATE_DIR: input.stateDir,
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: input.paths.runtimeJsonPath,
      CODER_STUDIO_DESKTOP_WEB_ROOT: input.paths.webRoot,
      ...(input.hostOverride ? { CODER_STUDIO_DESKTOP_HOST: input.hostOverride } : {}),
      ...(input.password ? { CODER_STUDIO_DESKTOP_PASSWORD: input.password } : {}),
      ...(input.appVersion ? { CODER_STUDIO_DESKTOP_APP_VERSION: input.appVersion } : {}),
      ...(input.paths.runtimeVersion
        ? { CODER_STUDIO_DESKTOP_RUNTIME_VERSION: input.paths.runtimeVersion }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });

  const childPid = child.pid;
  if (typeof childPid !== "number") {
    throw new Error("Failed to spawn the desktop sidecar process");
  }

  child.stdout?.on("data", (chunk) => appendLogChunk("stdout", chunk));
  child.stderr?.on("data", (chunk) => appendLogChunk("stderr", chunk));

  const wait = deps.waitForHealthyRuntime ?? waitForHealthyRuntime;
  const earlyExit = new Promise<never>((_, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const suffix = typeof code === "number" ? `code ${code}` : `signal ${signal ?? "unknown"}`;
      const error = new Error(
        `Desktop sidecar exited before becoming healthy (${suffix})`
      ) as SidecarStartupError;
      error.logExcerpt = getLogExcerpt();
      reject(error);
    };

    if (child.exitCode !== null || child.signalCode !== null) {
      const code = child.exitCode;
      const signal = child.signalCode;
      queueMicrotask(() => {
        onExit(code, signal);
      });
    } else {
      child.once("exit", onExit);
    }
  });

  let healthy: HealthyRuntime;
  try {
    healthy = await Promise.race([
      wait({
        readRuntimeConfig: () => readRuntimeConfig(input.paths.runtimeJsonPath),
        checkUrl: async (url) => {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`Runtime health check failed: ${response.status}`);
          }
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        timeoutMs: 15_000,
        startedAt: Date.now(),
        expectedPid: childPid,
      }),
      earlyExit,
    ]);
  } catch (error) {
    const failure =
      error instanceof Error
        ? (error as SidecarStartupError)
        : (new Error(String(error)) as SidecarStartupError);
    if (!failure.logExcerpt) {
      failure.logExcerpt = getLogExcerpt();
    }
    throw failure;
  }

  const handle = new EventEmitter() as StartedDesktopSidecar;
  handle.child = child;
  handle.browserUrl = healthy.browserUrl;
  handle.runtime = healthy.runtime;
  handle.getLogExcerpt = getLogExcerpt;
  handle.send = (message: unknown) => {
    child.send?.(message as Serializable);
  };
  handle.stop = async (timeoutMs = 10_000) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    child.kill("SIGTERM");

    await Promise.race([
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          child.kill("SIGKILL");
          child.once("exit", () => resolve());
        }, timeoutMs).unref();
      }),
    ]);
  };

  child.once("exit", (code, signal) => {
    handle.emit("exit", { code, signal });
  });
  child.on("message", (message) => {
    handle.emit("message", message);
  });

  return handle;
}

export function createSidecarPaths(input: EmbeddedRuntimePathInput): SidecarPaths {
  return resolveEmbeddedRuntimePaths(input);
}
