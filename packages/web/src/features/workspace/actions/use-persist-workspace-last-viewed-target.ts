import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../atoms/connection";

interface PersistWorkspaceLastViewedTargetInput {
  workspaceId: string;
  sessionId?: string;
}

export function usePersistWorkspaceLastViewedTarget() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const lastViewedTarget = useAtomValue(lastViewedTargetAtom);
  const setLastViewedTarget = useSetAtom(lastViewedTargetAtom);

  return useCallback(
    async ({ workspaceId, sessionId }: PersistWorkspaceLastViewedTargetInput) => {
      if (!workspaceId) {
        return null;
      }

      if (
        lastViewedTarget?.workspaceId === workspaceId &&
        (lastViewedTarget.sessionId ?? undefined) === sessionId
      ) {
        return lastViewedTarget;
      }

      const optimisticTarget: WorkspaceLastViewedTarget = {
        workspaceId,
        sessionId,
        updatedAt: Date.now(),
      };
      setLastViewedTarget(optimisticTarget);

      const result = await dispatch<WorkspaceLastViewedTarget>("workspace.lastViewedTarget.set", {
        workspaceId,
        sessionId,
      });

      if (!result.ok || !result.data) {
        return optimisticTarget;
      }

      setLastViewedTarget(result.data);
      return result.data;
    },
    [dispatch, lastViewedTarget, setLastViewedTarget]
  );
}
