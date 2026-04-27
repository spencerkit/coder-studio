import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import pm2 from 'pm2';
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

const connectPm2 = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    pm2.connect((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const createStartupError = (reason: string): Error =>
  new Error(
    `Coder Studio failed to start in background: ${reason}. ${STARTUP_FAILURE_GUIDANCE}`
  );

const disconnectPm2 = (): void => {
  pm2.disconnect();
};

const withPm2Connection = async <T>(operation: () => Promise<T>): Promise<T> => {
  await connectPm2();

  try {
    return await operation();
  } finally {
    disconnectPm2();
  }
};

const describeManagedServer = async (): Promise<Pm2ProcessDescription[]> =>
  new Promise((resolve, reject) => {
    pm2.describe(MANAGED_SERVER_NAME, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((result ?? []) as Pm2ProcessDescription[]);
    });
  });

const removeManagedServer = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    pm2.delete(MANAGED_SERVER_NAME, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

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
  await deleteManagedServer({ ignoreMissing: true });
  await withPm2Connection(waitForManagedServerExit);
  if (readRuntimeConfig()) {
    deleteRuntimeConfig();
  }
  ensureLogDirectory();
  const { outFile, errFile } = getLogPaths();

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
