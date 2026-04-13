import { attachWorkspaceRuntime } from "../../services/http/workspace.service";
import type { WorkspaceRuntimeSnapshot } from "../../types/app";

type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

export const ATTACH_RUNTIME_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000, 5000] as const;
export const ATTACH_RUNTIME_SUCCESS_REUSE_MS = 1_200;
export const READY_TAB_ATTACH_SUCCESS_REUSE_MS = 3_500;
export const WS_RESYNC_ATTACH_SUCCESS_REUSE_MS = 2_000;
export const CONTROLLER_RECOVERY_ATTACH_SUCCESS_REUSE_MS = 2_000;

type RuntimeAttachTask<T> = () => Promise<T | null>;
type RuntimeAttachRunOptions = {
  successReuseMs?: number;
  force?: boolean;
};
type RuntimeAttachDeduperOptions = {
  now?: () => number;
  successReuseMs?: number;
};

export const createWorkspaceRuntimeAttachDeduper = <T>(
  options: RuntimeAttachDeduperOptions = {},
) => {
  const now = options.now ?? (() => Date.now());
  const successReuseMs = options.successReuseMs ?? ATTACH_RUNTIME_SUCCESS_REUSE_MS;
  const inflight = new Map<string, Promise<T | null>>();
  const recentSuccess = new Map<string, { at: number; result: T }>();

  return {
    run(
      key: string,
      attach: RuntimeAttachTask<T>,
      options: RuntimeAttachRunOptions = {},
    ) {
      const active = inflight.get(key);
      if (active) {
        return active;
      }

      const successReuseWindowMs = options.successReuseMs ?? successReuseMs;
      const cached = recentSuccess.get(key);
      if (!options.force && cached && (now() - cached.at) <= successReuseWindowMs) {
        return Promise.resolve(cached.result);
      }

      const task = attach()
        .then((result) => {
          if (result) {
            recentSuccess.set(key, { at: now(), result });
          } else {
            recentSuccess.delete(key);
          }
          return result;
        })
        .finally(() => {
          inflight.delete(key);
        });

      inflight.set(key, task);
      return task;
    },
    clear(key?: string) {
      if (typeof key === "string") {
        inflight.delete(key);
        recentSuccess.delete(key);
        return;
      }
      inflight.clear();
      recentSuccess.clear();
    },
  };
};

export const runAttachWithRetry = async <T>(
  attach: () => Promise<T | null>,
  retryDelaysMs: readonly number[] = ATTACH_RUNTIME_RETRY_DELAYS_MS,
): Promise<T | null> => {
  for (const delayMs of retryDelaysMs) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delayMs);
      });
    }

    const runtimeSnapshot = await attach();
    if (runtimeSnapshot) {
      return runtimeSnapshot;
    }
  }

  return null;
};

export type WorkspaceRuntimeAttachRequestOptions = RuntimeAttachRunOptions & {
  retryDelaysMs?: readonly number[];
};

const workspaceRuntimeAttachDeduper = createWorkspaceRuntimeAttachDeduper<WorkspaceRuntimeSnapshot>();

export const attachWorkspaceRuntimeWithRetry = async (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  withServiceFallback: WithServiceFallback,
  options: WorkspaceRuntimeAttachRequestOptions = {},
): Promise<WorkspaceRuntimeSnapshot | null> => {
  return workspaceRuntimeAttachDeduper.run(
    `${workspaceId}:${deviceId}:${clientId}`,
    () => runAttachWithRetry(() => withServiceFallback(
      () => attachWorkspaceRuntime(workspaceId, deviceId, clientId),
      null,
    ), options.retryDelaysMs),
    options,
  );
};
