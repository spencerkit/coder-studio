import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../atoms/connection";

interface PersistWorkspaceLastViewedTargetInput {
  workspaceId: string;
  sessionId?: string;
}

export function usePersistWorkspaceLastViewedTarget() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setLastViewedTarget = useSetAtom(lastViewedTargetAtom);
  const store = useStore();

  return useCallback(
    async ({ workspaceId, sessionId }: PersistWorkspaceLastViewedTargetInput) => {
      const lastViewedTarget = store.get(lastViewedTargetAtom);

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
      const previousTarget = lastViewedTarget;
      setLastViewedTarget(optimisticTarget);

      const result = await dispatch<WorkspaceLastViewedTarget>("workspace.lastViewedTarget.set", {
        workspaceId,
        sessionId,
      });

      if (store.get(lastViewedTargetAtom) !== optimisticTarget) {
        return store.get(lastViewedTargetAtom);
      }

      if (!result.ok || !result.data) {
        setLastViewedTarget(previousTarget);
        return optimisticTarget;
      }

      setLastViewedTarget(result.data);
      return result.data;
    },
    [dispatch, setLastViewedTarget, store]
  );
}
