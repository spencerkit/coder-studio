import { attachWorkspaceRuntime } from "../../services/http/workspace.service.ts";
import type { WorkspaceRuntimeSnapshot } from "../../types/app.ts";

type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

const ATTACH_RUNTIME_RETRY_DELAYS_MS = [0, 250, 750] as const;

export const attachWorkspaceRuntimeWithRetry = async (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  withServiceFallback: WithServiceFallback,
): Promise<WorkspaceRuntimeSnapshot | null> => {
  for (const delayMs of ATTACH_RUNTIME_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
    }

    const runtimeSnapshot = await withServiceFallback(
      () => attachWorkspaceRuntime(workspaceId, deviceId, clientId),
      null,
    );
    if (runtimeSnapshot) {
      return runtimeSnapshot;
    }
  }

  return null;
};
