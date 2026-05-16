import {
  deleteRestartIntent,
  deleteRuntimeConfig,
  readRuntimeConfig,
  writeRestartIntent,
} from "@coder-studio/core/runtime";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getFileSize, readLogExcerpt } from "./log-excerpt.js";

export const MANAGED_SERVER_NAME = "coder-studio-server";
const PM2_RESTART_DELAY_MS = 2000;
const PM2_MIN_UPTIME = "5s";
const PM2_MAX_RESTARTS = 10;
const PM2_DELETE_WAIT_MS = 5000;
const PM2_DISCONNECT_WAIT_MS = 1000;
const STARTUP_POLL_INTERVAL_MS = 100;
const STARTUP_FAILURE_GUIDANCE =
  "Run `coder-studio logs` for details or `coder-studio serve --foreground` for interactive debugging.";

export interface ManagedServerStatus {
  status: "running" | "starting" | "stopped" | "errored";
  pm2Pid: number | null;
  restartCount: number;
}

export interface StartManagedServerOptions {
  script: string;
  cwd: string;
  waitMs: number;
  args?: string[];
  restart?: boolean;
}

interface Pm2ProcessDescription {
  pid?: number;
  pm2_env?: {
    status?: string;
    restart_time?: number;
  };
}

interface StartupLogOffsets {
  outOffset: number;
  errOffset: number;
}

const isMissingManagedServerError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return /not found|process or namespace/i.test(error.message);
};

/**
 * Detects if PM2 is in a broken state (e.g. pointing to an old worktree).
 */
const isPm2BrokenStateError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("ProcessContainerFork") ||
    (error.message.includes("Cannot find module") && error.message.includes("pm2"))
  );
};

type Pm2Module = {
  connect: (cb: (err: Error | null) => void) => void;
  disconnect: (cb?: (err: Error | null, data?: unknown) => void) => void;
  describe: (name: string, cb: (err: Error | null, result: unknown[]) => void) => void;
  delete: (name: string, cb: (err: Error | null) => void) => void;
  start: (script: string, opts: unknown, cb: (err: Error | null) => void) => void;
  kill: (cb: (err: Error | null) => void) => void;
};

let cachedPm2: Pm2Module | null = null;

async function loadPm2(): Promise<Pm2Module> {
  if (cachedPm2) {
    return cachedPm2;
  }

  let pm2Module: Pm2Module;
  try {
    const pm2 = await import("pm2");
    pm2Module = pm2.default as unknown as Pm2Module;
  } catch {
    throw new Error(
      "pm2 is not installed. Run `npm install -g pm2` to use background server management."
    );
  }

  cachedPm2 = pm2Module;
  return pm2Module;
}

const connectPm2 = async (): Promise<void> => {
  const pm2 = await loadPm2();
  return new Promise((resolve, reject) => {
    pm2.connect((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const disconnectPm2 = async (): Promise<void> => {
  const pm2 = await loadPm2();
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    const timer = setTimeout(finish, PM2_DISCONNECT_WAIT_MS);
    try {
      pm2.disconnect(() => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
};

const describeManagedServer = async (pm2: Pm2Module): Promise<Pm2ProcessDescription[]> =>
  new Promise((resolve, reject) => {
    pm2.describe(MANAGED_SERVER_NAME, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((result ?? []) as Pm2ProcessDescription[]);
    });
  });

const removeManagedServer = async (pm2: Pm2Module): Promise<void> =>
  new Promise((resolve, reject) => {
    pm2.delete(MANAGED_SERVER_NAME, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

/**
 * Kill the PM2 daemon to clear stale paths/caches.
 * Used when the daemon is pointing to a deleted worktree.
 */
const killPm2Daemon = async (): Promise<void> => {
  const pm2 = await loadPm2();
  return new Promise((resolve) => {
    pm2.kill(() => {
      resolve();
    });
  });
};

/**
 * Try to connect to PM2, and if it's in a broken state (stale worktree path),
 * kill the daemon and reconnect fresh.
 */
const connectWithRecovery = async (): Promise<Pm2Module> => {
  try {
    await connectPm2();
    return loadPm2();
  } catch (error) {
    if (isPm2BrokenStateError(error)) {
      console.warn("PM2 daemon is in a stale state. Killing and reconnecting...");
      try {
        await killPm2Daemon();
      } catch {
        // ignore kill errors
      }
      await sleep(1000);
      // Clear cached module so next loadPm2 gets a fresh instance
      cachedPm2 = null;
      await connectPm2();
      return loadPm2();
    } else {
      throw error;
    }
  }
};

const withPm2Connection = async <T>(operation: (pm2: Pm2Module) => Promise<T>): Promise<T> => {
  const pm2 = await connectWithRecovery();

  try {
    return await operation(pm2);
  } finally {
    await disconnectPm2();
  }
};

const waitForRuntimeReady = async (
  pm2: Pm2Module,
  waitMs: number,
  logOffsets: StartupLogOffsets
): Promise<void> => {
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    if (readRuntimeConfig()) {
      return;
    }

    const processes = await describeManagedServer(pm2);
    const process = processes[0];
    if (!process) {
      throw createStartupError(
        "the managed process exited before runtime data was written",
        logOffsets
      );
    }

    const status = process.pm2_env?.status;
    if (status === "errored" || status === "stopped") {
      throw createStartupError(`the managed process entered the ${status} state`, logOffsets);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(STARTUP_POLL_INTERVAL_MS, remainingMs));
  }

  throw createStartupError(`runtime readiness timed out after ${waitMs}ms`, logOffsets);
};

const waitForManagedServerDeletion = async (pm2: Pm2Module, waitMs: number): Promise<void> => {
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    const processes = await describeManagedServer(pm2);
    if (processes.length === 0) {
      return;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(STARTUP_POLL_INTERVAL_MS, remainingMs));
  }

  throw new Error(`Timed out waiting for the managed server to stop after ${waitMs}ms.`);
};

const deleteManagedServerInSession = async (
  pm2: Pm2Module,
  {
    ignoreMissing = false,
  }: {
    ignoreMissing?: boolean;
  } = {}
): Promise<boolean> => {
  const processes = await describeManagedServer(pm2);
  if (processes.length === 0) {
    return false;
  }

  try {
    await removeManagedServer(pm2);
  } catch (error) {
    if (ignoreMissing && isMissingManagedServerError(error)) {
      await waitForManagedServerDeletion(pm2, PM2_DELETE_WAIT_MS);
      return false;
    }

    throw error;
  }

  await waitForManagedServerDeletion(pm2, PM2_DELETE_WAIT_MS);
  return true;
};

const ensureLogDirectory = (): void => {
  mkdirSync(join(homedir(), ".coder-studio", "logs"), { recursive: true });
};

export const getLogPaths = () => ({
  outFile: join(homedir(), ".coder-studio", "logs", "server.out.log"),
  errFile: join(homedir(), ".coder-studio", "logs", "server.err.log"),
});

const captureStartupLogOffsets = (): StartupLogOffsets => {
  const { outFile, errFile } = getLogPaths();
  return {
    outOffset: getFileSize(outFile),
    errOffset: getFileSize(errFile),
  };
};

const getStartupFailureDetails = (offsets: StartupLogOffsets): string | null => {
  const { outFile, errFile } = getLogPaths();
  const sections: string[] = [];
  const errExcerpt = readLogExcerpt(errFile, { startOffset: offsets.errOffset });
  const outExcerpt =
    outFile === errFile ? null : readLogExcerpt(outFile, { startOffset: offsets.outOffset });

  if (errExcerpt) {
    sections.push(`Recent error log excerpt (${errFile}):\n${errExcerpt}`);
  }

  if (outExcerpt) {
    sections.push(`Recent output log excerpt (${outFile}):\n${outExcerpt}`);
  }

  return sections.length === 0 ? null : sections.join("\n\n");
};

const createStartupError = (reason: string, offsets: StartupLogOffsets): Error => {
  const details = getStartupFailureDetails(offsets);
  const message = [
    `Coder Studio failed to start in background: ${reason}.`,
    ...(details ? [details] : []),
    STARTUP_FAILURE_GUIDANCE,
  ].join("\n\n");

  return new Error(message);
};

export const deleteManagedServer = async ({
  ignoreMissing = false,
}: {
  ignoreMissing?: boolean;
} = {}): Promise<boolean> =>
  withPm2Connection((pm2) => deleteManagedServerInSession(pm2, { ignoreMissing }));

export const startManagedServer = async ({
  script,
  cwd,
  waitMs,
  args,
  restart = false,
}: StartManagedServerOptions): Promise<void> =>
  withPm2Connection(async (pm2) => {
    const runtime = readRuntimeConfig();
    const now = Date.now();
    const intent =
      restart && runtime
        ? {
            requestId: `restart-${now}`,
            expectedServerInstanceId: runtime.serverInstanceId,
            createdAt: now,
            expiresAt: now + 30_000,
            mode: "preserve_terminals" as const,
          }
        : null;

    if (intent) {
      writeRestartIntent(intent);
    } else {
      deleteRestartIntent();
    }

    try {
      await deleteManagedServerInSession(pm2, { ignoreMissing: true });

      if (readRuntimeConfig()) {
        deleteRuntimeConfig();
      }

      ensureLogDirectory();
      const { outFile, errFile } = getLogPaths();
      const logOffsets = captureStartupLogOffsets();
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        await new Promise<void>((resolve, reject) => {
          pm2.start(
            script,
            {
              name: MANAGED_SERVER_NAME,
              cwd,
              ...(args !== undefined ? { args } : {}),
              autorestart: true,
              restart_delay: PM2_RESTART_DELAY_MS,
              min_uptime: PM2_MIN_UPTIME,
              max_restarts: PM2_MAX_RESTARTS,
              out_file: outFile,
              error_file: errFile,
            },
            (error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            }
          );
        });
      } finally {
        if (previousNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = previousNodeEnv;
        }
      }

      await waitForRuntimeReady(pm2, waitMs, logOffsets);
    } catch (error) {
      if (intent) {
        deleteRestartIntent();
      }
      throw error;
    }

    if (intent) {
      deleteRestartIntent();
    }
  });

export const getManagedServerStatus = async (): Promise<ManagedServerStatus> =>
  withPm2Connection(async (pm2) => {
    const processes = await describeManagedServer(pm2);
    const process = processes[0];

    if (!process) {
      return {
        status: "stopped",
        pm2Pid: null,
        restartCount: 0,
      };
    }

    const status = process.pm2_env?.status;
    const restartCount = process.pm2_env?.restart_time ?? 0;
    const pm2Pid = process.pid ?? null;

    if (status === "online") {
      return {
        status: "running",
        pm2Pid,
        restartCount,
      };
    }

    if (status === "launching") {
      return {
        status: "starting",
        pm2Pid,
        restartCount,
      };
    }

    if (status === "stopped") {
      return {
        status: "stopped",
        pm2Pid: null,
        restartCount,
      };
    }

    if (pm2Pid === null || pm2Pid === 0) {
      return {
        status: "stopped",
        pm2Pid: null,
        restartCount,
      };
    }

    return {
      status: "errored",
      pm2Pid,
      restartCount,
    };
  });
