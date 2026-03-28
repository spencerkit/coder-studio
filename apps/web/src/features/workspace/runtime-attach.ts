import { attachWorkspaceRuntime } from "../../services/http/workspace.service.ts";
import type { WorkspaceRuntimeSnapshot } from "../../types/app.ts";

type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

export const ATTACH_RUNTIME_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000, 5000] as const;

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

export const attachWorkspaceRuntimeWithRetry = async (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  withServiceFallback: WithServiceFallback,
): Promise<WorkspaceRuntimeSnapshot | null> => {
  return runAttachWithRetry(() => withServiceFallback(
      () => attachWorkspaceRuntime(workspaceId, deviceId, clientId),
      null,
    ),
  );
};
