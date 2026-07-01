import type { ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type RuntimeConfig, readRuntimeConfig } from "../packages/core/src/runtime.js";
import { parseRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { waitForHealthyRuntime } from "../packages/desktop/src/sidecar-manager.js";
import { buildDesktop } from "./build-desktop.js";
import { buildWeb } from "./build-web.js";
import { error, info, log, ROOT_DIR, run, success } from "./shared/index.js";
import { isDirectExecution, runBackground } from "./shared/process.js";

const SMOKE_USER_DATA_RELATIVE_DIR = join(".tmp", "desktop-local-smoke", "user-data");
const DESKTOP_ELECTRON_ENTRY = "dist/electron/main.mjs";
const LOCAL_SEED_SOURCE = "local-desktop-seed";
const SMOKE_CLEANUP_RETRY_DELAY_MS = 50;
const SMOKE_CLEANUP_MAX_ATTEMPTS = 5;
type RemoveDir = (target: string) => Promise<void>;

function isLikelyWindowsLockedDirError(error: unknown): boolean {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    if (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY") {
      return true;
    }

    return /resource busy or locked/i.test(error.message);
  }

  return false;
}

async function removeDirWithRetry(target: string, removeDir: RemoveDir): Promise<boolean> {
  for (let attempt = 1; attempt <= SMOKE_CLEANUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      await removeDir(target);
      return true;
    } catch (error) {
      if (!isLikelyWindowsLockedDirError(error) && attempt === 1) {
        throw error;
      }

      if (attempt < SMOKE_CLEANUP_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, SMOKE_CLEANUP_RETRY_DELAY_MS));
      }
    }
  }

  return false;
}

export type SmokeScriptRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
) => Promise<void>;

type SmokeBackgroundRunner = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe" | "ignore";
  }
) => ChildProcess;

interface HealthyDesktopRuntime {
  browserUrl: string;
  runtime: RuntimeConfig;
}

interface ChildExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export async function prepareDesktopLocalSmokeUserData(input: {
  repoRoot?: string;
  now?: () => number;
}): Promise<{
  userDataDir: string;
  runtimeVersion: string;
}> {
  const repoRoot = input.repoRoot ?? ROOT_DIR;
  const smokeRootDir = join(repoRoot, ".tmp", "desktop-local-smoke");
  await mkdir(smokeRootDir, { recursive: true });
  const userDataDir = await mkdtemp(join(smokeRootDir, "user-data-"));
  const runtimeEmbeddedDir = join(repoRoot, "packages", "desktop", "dist", "runtime", "embedded");
  const runtimeStoreDir = join(userDataDir, "runtime-store");
  const currentPointerPath = join(runtimeStoreDir, "current.json");

  const manifest = parseRuntimeManifest(
    JSON.parse(await readFile(join(runtimeEmbeddedDir, "runtime-manifest.json"), "utf-8"))
  );
  const versionDir = join(runtimeStoreDir, "versions", manifest.version);

  await mkdir(join(runtimeStoreDir, "versions"), { recursive: true });
  await cp(runtimeEmbeddedDir, versionDir, { recursive: true, force: true });
  await writeFile(
    currentPointerPath,
    `${JSON.stringify(
      {
        version: manifest.version,
        installedAt: (input.now ?? Date.now)(),
        path: versionDir,
        entry: manifest.entry,
        webRoot: manifest.webRoot,
        checksumSha256: LOCAL_SEED_SOURCE,
        source: LOCAL_SEED_SOURCE,
      },
      null,
      2
    )}\n`
  );

  return {
    userDataDir,
    runtimeVersion: manifest.version,
  };
}

export async function waitForDesktopHealthy(input: {
  userDataDir: string;
  expectedPid?: number;
}): Promise<HealthyDesktopRuntime> {
  return waitForHealthyRuntime({
    readRuntimeConfig: () => readRuntimeConfig(join(input.userDataDir, "runtime", "runtime.json")),
    checkUrl: async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Runtime health check failed: ${response.status}`);
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs: 15_000,
    startedAt: Date.now(),
    expectedPid: input.expectedPid,
  });
}

export async function launchDesktopSmokeLocal(input: {
  repoRoot?: string;
  userDataDir: string;
  env?: NodeJS.ProcessEnv;
  keepUserData?: boolean;
  runBackground?: SmokeBackgroundRunner;
  waitForDesktopHealthy?: (input: {
    userDataDir: string;
    expectedPid?: number;
  }) => Promise<HealthyDesktopRuntime>;
  removeDir?: RemoveDir;
}): Promise<{
  browserUrl: string;
  runtime: RuntimeConfig;
  child: ChildProcess;
  completed: Promise<void>;
}> {
  const repoRoot = input.repoRoot ?? ROOT_DIR;
  const spawn = input.runBackground ?? runBackground;
  const waitForDesktop = input.waitForDesktopHealthy ?? waitForDesktopHealthy;
  const removeDir =
    input.removeDir ?? ((target: string) => rm(target, { recursive: true, force: true }));
  let cleanedUserData = false;

  const cleanupUserData = async (): Promise<void> => {
    if (input.keepUserData || cleanedUserData) {
      return;
    }

    cleanedUserData = true;
    const removed = await removeDirWithRetry(input.userDataDir, removeDir);
    if (!removed) {
      return;
    }
  };

  const child = spawn(
    "pnpm",
    ["--filter", "@coder-studio/desktop", "exec", "electron", DESKTOP_ELECTRON_ENTRY],
    {
      cwd: repoRoot,
      env: {
        ...(input.env ?? process.env),
        CODER_STUDIO_DESKTOP_USER_DATA_DIR: input.userDataDir,
      },
      stdio: "inherit",
    }
  );
  const closePromise = new Promise<ChildExitInfo>((resolve, reject) => {
    child.once("close", (code, signal) => {
      resolve({
        code,
        signal,
      });
    });
    child.once("error", reject);
  });

  let healthy: HealthyDesktopRuntime;
  try {
    const expectedPid = typeof child.pid === "number" ? child.pid : undefined;
    const startup = await Promise.race([
      waitForDesktop({
        userDataDir: input.userDataDir,
        expectedPid,
      }).then((runtime) => ({ kind: "healthy" as const, runtime })),
      closePromise.then((exit) => ({ kind: "exit" as const, exit })),
    ]);

    if (startup.kind === "exit") {
      const suffix =
        typeof startup.exit.code === "number"
          ? `code ${startup.exit.code}`
          : `signal ${startup.exit.signal ?? "unknown"}`;

      throw new Error(`Desktop smoke Electron exited before becoming healthy (${suffix})`);
    }

    healthy = startup.runtime;
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }

    await closePromise.catch(() => undefined);

    await cleanupUserData();

    throw error;
  }

  const completed = closePromise.then(async (exit) => {
    await cleanupUserData();

    if (exit.code === 0 || (exit.code === null && exit.signal === null)) {
      return;
    }

    const suffix =
      typeof exit.code === "number" ? `code ${exit.code}` : `signal ${exit.signal ?? "unknown"}`;
    throw new Error(`Desktop smoke Electron exited with ${suffix}`);
  });

  return {
    browserUrl: healthy.browserUrl,
    runtime: healthy.runtime,
    child,
    completed,
  };
}

export async function runDesktopSmokeLocal(
  input: {
    repoRoot?: string;
    env?: NodeJS.ProcessEnv;
    keepUserData?: boolean;
    buildWebApp?: () => Promise<void>;
    buildDesktopApp?: () => Promise<void>;
    prepareLocalUserData?: (input: { repoRoot: string }) => Promise<{
      userDataDir: string;
      runtimeVersion: string;
    }>;
    runCommand?: SmokeScriptRunner;
    runBackground?: SmokeBackgroundRunner;
    waitForDesktopHealthy?: (input: {
      userDataDir: string;
      expectedPid?: number;
    }) => Promise<HealthyDesktopRuntime>;
    removeDir?: (target: string) => Promise<void>;
  } = {}
): Promise<void> {
  const repoRoot = input.repoRoot ?? ROOT_DIR;
  const buildWebApp = input.buildWebApp ?? buildWeb;
  const buildDesktopApp = input.buildDesktopApp ?? buildDesktop;
  const prepareLocalUserData = input.prepareLocalUserData ?? prepareDesktopLocalSmokeUserData;
  const runCommand = input.runCommand ?? ((command, args, options) => run(command, args, options));

  info("Building web assets for local smoke test...");
  await buildWebApp();

  info("Building desktop artifacts for local smoke test...");
  await buildDesktopApp();

  info("Preparing isolated desktop userData...");
  const prepared = await prepareLocalUserData({
    repoRoot,
  });

  success(
    `Prepared isolated desktop runtime ${prepared.runtimeVersion} at ${prepared.userDataDir}`
  );
  info("Launching Electron against local desktop assets...");

  if (input.runCommand) {
    await runCommand(
      "pnpm",
      ["--filter", "@coder-studio/desktop", "exec", "electron", DESKTOP_ELECTRON_ENTRY],
      {
        cwd: repoRoot,
        env: {
          ...(input.env ?? process.env),
          CODER_STUDIO_DESKTOP_USER_DATA_DIR: prepared.userDataDir,
        },
      }
    );
    return;
  }

  const launch = await launchDesktopSmokeLocal({
    repoRoot,
    userDataDir: prepared.userDataDir,
    env: input.env,
    keepUserData: input.keepUserData,
    runBackground: input.runBackground,
    waitForDesktopHealthy: input.waitForDesktopHealthy,
    removeDir: input.removeDir,
  });
  success(`Desktop runtime is healthy at ${launch.browserUrl}`);
  await launch.completed;
}

export function parseDesktopSmokeLocalArgs(args: string[]): {
  keepUserData: boolean;
} {
  return {
    keepUserData: args.includes("--keep-user-data"),
  };
}

if (isDirectExecution(import.meta.url)) {
  const cliArgs = parseDesktopSmokeLocalArgs(process.argv.slice(2));

  runDesktopSmokeLocal({
    keepUserData: cliArgs.keepUserData,
  })
    .then(() => {
      log("\n✓ Desktop local smoke run exited cleanly.\n");
      process.exit(0);
    })
    .catch((err) => {
      error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
