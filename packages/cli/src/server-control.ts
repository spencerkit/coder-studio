import {
  deleteRuntimeConfig,
  readRuntimeConfig,
} from '../../server/src/hooks/runtime-json.js';
import {
  deleteManagedServer,
  getLogPaths,
  getManagedServerStatus,
} from './pm2-control.js';

export interface ServerStatus {
  status: 'running' | 'starting' | 'stopped' | 'errored';
  pid: number | null;
  port: number | null;
  restartCount: number;
  outFile: string;
  errFile: string;
  startedAt: number | null;
}

export async function stopRunningServer(): Promise<boolean> {
  const stopped = await deleteManagedServer({ ignoreMissing: true });

  if (readRuntimeConfig()) {
    deleteRuntimeConfig();
  }

  return stopped;
}

export async function ensureSingleServer(
  stop = () => stopRunningServer()
): Promise<void> {
  await stop();
}

export async function getServerStatus(): Promise<ServerStatus> {
  const managedStatus = await getManagedServerStatus();
  const runtime = readRuntimeConfig();
  const { outFile, errFile } = getLogPaths();

  if (managedStatus.status === 'stopped') {
    if (runtime) {
      deleteRuntimeConfig();
    }

    return {
      status: 'stopped',
      pid: null,
      port: null,
      restartCount: 0,
      outFile,
      errFile,
      startedAt: null,
    };
  }

  return {
    status: runtime ? managedStatus.status : 'starting',
    pid: runtime?.pid ?? managedStatus.pm2Pid,
    port: runtime?.port ?? null,
    restartCount: managedStatus.restartCount,
    outFile,
    errFile,
    startedAt: runtime?.startedAt ?? null,
  };
}
