import { type ChildProcess, spawn as spawnChild } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  deleteRuntimeConfig,
  type RuntimeConfig,
  readRuntimeConfig,
} from "@coder-studio/core/runtime";
import { type EmbeddedRuntimePathInput, resolveEmbeddedRuntimePaths } from "./runtime-paths.js";

export { resolveEmbeddedRuntimePaths } from "./runtime-paths.js";

export interface SidecarPaths {
  nodeExecutable: string;
  desktopServerEntry: string;
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
}

export interface StartedDesktopSidecar extends EventEmitter {
  child: ChildProcess;
  browserUrl: string;
  runtime: RuntimeConfig;
  getLogExcerpt(): string;
  stop(timeoutMs?: number): Promise<void>;
}

interface SidecarStartupError extends Error {
  logExcerpt?: string;
}

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

  while (now() - input.startedAt <= input.timeoutMs) {
    const runtime = input.readRuntimeConfig();
    if (runtime && (input.expectedPid === undefined || runtime.pid === input.expectedPid)) {
      const browserUrl = toBrowserUrl(runtime);
      await input.checkUrl(browserUrl);
      return { browserUrl, runtime };
    }

    await input.sleep(100);
  }

  throw new Error("Timed out waiting for the desktop sidecar runtime");
}

export async function startDesktopSidecar(
  input: StartDesktopSidecarInput,
  deps: {
    spawn?: typeof spawnChild;
    waitForHealthyRuntime?: typeof waitForHealthyRuntime;
  } = {}
): Promise<StartedDesktopSidecar> {
  mkdirSync(dirname(input.paths.runtimeJsonPath), { recursive: true });
  mkdirSync(input.stateDir, { recursive: true });
  deleteRuntimeConfig(input.paths.runtimeJsonPath);

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

  const spawn = deps.spawn ?? spawnChild;
  const child = spawn(input.paths.nodeExecutable, [input.paths.desktopServerEntry], {
    env: {
      ...process.env,
      CODER_STUDIO_DESKTOP_PORT: String(input.portOverride ?? 0),
      CODER_STUDIO_DESKTOP_STATE_DIR: input.stateDir,
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: input.paths.runtimeJsonPath,
      ...(input.hostOverride ? { CODER_STUDIO_DESKTOP_HOST: input.hostOverride } : {}),
      ...(input.password ? { CODER_STUDIO_DESKTOP_PASSWORD: input.password } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
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
    child.once("exit", (code, signal) => {
      const suffix = typeof code === "number" ? `code ${code}` : `signal ${signal ?? "unknown"}`;
      const error = new Error(
        `Desktop sidecar exited before becoming healthy (${suffix})`
      ) as SidecarStartupError;
      error.logExcerpt = getLogExcerpt();
      reject(error);
    });
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
      error instanceof Error ? (error as SidecarStartupError) : new Error(String(error));
    failure.logExcerpt ??= getLogExcerpt();
    throw failure;
  }

  const handle = new EventEmitter() as StartedDesktopSidecar;
  handle.child = child;
  handle.browserUrl = healthy.browserUrl;
  handle.runtime = healthy.runtime;
  handle.getLogExcerpt = getLogExcerpt;
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

  return handle;
}

export function createSidecarPaths(input: EmbeddedRuntimePathInput): SidecarPaths {
  return resolveEmbeddedRuntimePaths(input);
}
