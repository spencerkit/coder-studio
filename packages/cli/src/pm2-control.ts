import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  deleteRuntimeConfig,
  readRuntimeConfig,
} from '../../server/src/hooks/runtime-json.js';

export const MANAGED_SERVER_NAME = 'coder-studio-server';
const PM2_RESTART_DELAY_MS = 2000;
const PM2_MIN_UPTIME = '5s';
const PM2_MAX_RESTARTS = 10;
const STARTUP_POLL_INTERVAL_MS = 100;
const STARTUP_FAILURE_GUIDANCE =
  'Run `coder-studio logs` for details or `coder-studio serve --foreground` for interactive debugging.';

export interface ManagedServerStatus {
  status: 'running' | 'starting' | 'stopped' | 'errored';
  pm2Pid: number | null;
  restartCount: number;
}

export interface StartManagedServerOptions {
  script: string;
  cwd: string;
  waitMs: number;
  args?: string[];
}

interface Pm2ProcessDescription {
  pid?: number;
  pm2_env?: {
    status?: string;
    restart_time?: number;
  };
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
  return error.message.includes('ProcessContainerFork') ||
         (error.message.includes('Cannot find module') && error.message.includes('pm2'));
};

type Pm2Module = {
  connect: (cb: (err: Error | null) => void) => void;
  disconnect: () => void;
  describe: (name: string, cb: (err: Error | null, result: unknown[]) => void) => void;
  delete: (name: string, cb: (err: Error | null) => void) => void;
  start: (opts: unknown, cb: (err: Error | null) => void) => void;
  kill: (cb: (err: Error | null) => void) => void;
};

let cachedPm2: Pm2Module | null = null;

async function loadPm2(): Promise<Pm2Module> {
  if (cachedPm2) {
    return cachedPm2;
  }

  let pm2Module: Pm2Module;
  try {
    const pm2 = await import('pm2');
    pm2Module = pm2.default as Pm2Module;
  } catch (error) {
    throw new Error(
      'pm2 is not installed. Run `npm install -g pm2` to use background server management.'
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

const createStartupError = (reason: string): Error =>
  new Error(
    `Coder Studio failed to start in background: ${reason}. ${STARTUP_FAILURE_GUIDANCE}`
  );

const disconnectPm2 = async (): Promise<void> => {
  const pm2 = await loadPm2();
  pm2.disconnect();
};

const describeManagedServer = async (): Promise<Pm2ProcessDescription[]> => {
  const pm2 = await loadPm2();
  return new Promise((resolve, reject) => {
    pm2.describe(MANAGED_SERVER_NAME, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((result ?? []) as Pm2ProcessDescription[]);
    });
  });
};

const removeManagedServer = async (): Promise<void> => {
  const pm2 = await loadPm2();
  return new Promise((resolve, reject) => {
    pm2.delete(MANAGED_SERVER_NAME, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

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
const connectWithRecovery = async (): Promise<void> => {
  try {
    await connectPm2();
  } catch (error) {
    if (isPm2BrokenStateError(error)) {
      console.warn('PM2 daemon is in a stale state. Killing and reconnecting...');
      try {
        await killPm2Daemon();
      } catch {
        // ignore kill errors
      }
      await sleep(1000);
      // Clear cached module so next loadPm2 gets a fresh instance
      cachedPm2 = null;
      await connectPm2();
    } else {
      throw error;
    }
  }
};

const withPm2Connection = async <T>(operation: () => Promise<T>): Promise<T> => {
  await connectWithRecovery();

  try {
    return await operation();
  } finally {
    await disconnectPm2();
  }
};

const waitForRuntimeReady = async (waitMs: number): Promise<void> => {
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    if (readRuntimeConfig()) {
      return;
    }

    const processes = await describeManagedServer();
    const process = processes[0];
    if (!process) {
      throw createStartupError('the managed process exited before runtime data was written');
    }

    const status = process.pm2_env?.status;
    if (status === 'errored' || status === 'stopped') {
      throw createStartupError(`the managed process entered the ${status} state`);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(STARTUP_POLL_INTERVAL_MS, remainingMs));
  }

  throw createStartupError(`runtime readiness timed out after ${waitMs}ms`);
};

const waitForManagedServerExit = async (): Promise<void> => {
  while (true) {
    const processes = await describeManagedServer();
    if (processes.length === 0) {
      return;
    }

    await sleep(STARTUP_POLL_INTERVAL_MS);
  }
};

const ensureLogDirectory = (): void => {
  mkdirSync(join(homedir(), '.coder-studio', 'logs'), { recursive: true });
};

export const getLogPaths = () => ({
  outFile: join(homedir(), '.coder-studio', 'logs', 'server.out.log'),
  errFile: join(homedir(), '.coder-studio', 'logs', 'server.err.log'),
});

export const deleteManagedServer = async (
  { ignoreMissing = false }: { ignoreMissing?: boolean } = {}
): Promise<boolean> =>
  withPm2Connection(async () => {
    const processes = await describeManagedServer();
    if (processes.length === 0) {
      return false;
    }

    try {
      await removeManagedServer();
      return true;
    } catch (error) {
      if (ignoreMissing && isMissingManagedServerError(error)) {
        return false;
      }

      throw error;
    }
  });

export const startManagedServer = async ({ script, cwd, waitMs, args }: StartManagedServerOptions): Promise<void> => {
  // First try to delete any existing managed server
  await deleteManagedServer({ ignoreMissing: true });
  
  // Wait for the old process to actually exit
  await withPm2Connection(waitForManagedServerExit);
  
  // Clear stale runtime config
  if (readRuntimeConfig()) {
    deleteRuntimeConfig();
  }
  
  ensureLogDirectory();
  const { outFile, errFile } = getLogPaths();
  const pm2 = await loadPm2();

  await withPm2Connection(async () => {
    await new Promise<void>((resolve, reject) => {
      pm2.start(
        {
          name: MANAGED_SERVER_NAME,
          script,
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

    await waitForRuntimeReady(waitMs);
  });
};

export const getManagedServerStatus = async (): Promise<ManagedServerStatus> =>
  withPm2Connection(async () => {
    const processes = await describeManagedServer();
    const process = processes[0];

    if (!process) {
      return {
        status: 'stopped',
        pm2Pid: null,
        restartCount: 0,
      };
    }

    const status = process.pm2_env?.status;
    const restartCount = process.pm2_env?.restart_time ?? 0;
    const pm2Pid = process.pid ?? null;

    if (status === 'online') {
      return {
        status: 'running',
        pm2Pid,
        restartCount,
      };
    }

    if (status === 'launching') {
      return {
        status: 'starting',
        pm2Pid,
        restartCount,
      };
    }

    if (status === 'stopped') {
      return {
        status: 'stopped',
        pm2Pid: null,
        restartCount,
      };
    }

    return {
      status: 'errored',
      pm2Pid,
      restartCount,
    };
  });
