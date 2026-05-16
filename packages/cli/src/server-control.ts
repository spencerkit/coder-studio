import {
  deleteRestartIntent,
  deleteRuntimeConfig,
  readRuntimeConfig,
} from "@coder-studio/core/runtime";
import { deleteManagedServer, getLogPaths, getManagedServerStatus } from "./pm2-control.js";

export interface ServerStatus {
  status: "running" | "starting" | "stopped" | "errored";
  pid: number | null;
  host: string | null;
  port: number | null;
  restartCount: number;
  outFile: string;
  errFile: string;
  startedAt: number | null;
}

export interface StopRunningServerOptions {
  preserveRestartIntent?: boolean;
}

export async function stopRunningServer(options: StopRunningServerOptions = {}): Promise<boolean> {
  if (!options.preserveRestartIntent) {
    deleteRestartIntent();
  }

  const stopped = await deleteManagedServer({ ignoreMissing: true });

  if (readRuntimeConfig()) {
    deleteRuntimeConfig();
  }

  return stopped;
}

export async function ensureSingleServer(stop = () => stopRunningServer()): Promise<void> {
  await stop();
}

export async function getServerStatus(): Promise<ServerStatus> {
  const managedStatus = await getManagedServerStatus();
  const runtime = readRuntimeConfig();
  const { outFile, errFile } = getLogPaths();

  if (managedStatus.status === "stopped" || (managedStatus.pm2Pid === null && runtime === null)) {
    if (runtime) {
      deleteRuntimeConfig();
    }

    return {
      status: "stopped",
      pid: null,
      host: null,
      port: null,
      restartCount: 0,
      outFile,
      errFile,
      startedAt: null,
    };
  }

  return {
    status: runtime ? managedStatus.status : "starting",
    pid: runtime?.pid ?? managedStatus.pm2Pid,
    host: runtime?.host ?? null,
    port: runtime?.port ?? null,
    restartCount: managedStatus.restartCount,
    outFile,
    errFile,
    startedAt: runtime?.startedAt ?? null,
  };
}
