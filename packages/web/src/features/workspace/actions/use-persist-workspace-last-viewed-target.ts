import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import type { Store } from "jotai";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback } from "react";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../atoms/connection";

interface PersistWorkspaceLastViewedTargetInput {
  workspaceId: string;
  sessionId?: string;
}

const confirmedTargetByStore = new WeakMap<Store, WorkspaceLastViewedTarget | null>();
const optimisticTargetsByStore = new WeakMap<Store, WeakSet<WorkspaceLastViewedTarget>>();

function getOptimisticTargets(store: Store): WeakSet<WorkspaceLastViewedTarget> {
  const existing = optimisticTargetsByStore.get(store);
  if (existing) {
    return existing;
  }

  const next = new WeakSet<WorkspaceLastViewedTarget>();
  optimisticTargetsByStore.set(store, next);
  return next;
}

function getConfirmedTarget(store: Store): WorkspaceLastViewedTarget | null {
  const currentTarget = store.get(lastViewedTargetAtom);
  const optimisticTargets = getOptimisticTargets(store);

  if (currentTarget && !optimisticTargets.has(currentTarget)) {
    confirmedTargetByStore.set(store, currentTarget);
    return currentTarget;
  }

  return confirmedTargetByStore.get(store) ?? null;
}

export function usePersistWorkspaceLastViewedTarget() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setLastViewedTarget = useSetAtom(lastViewedTargetAtom);
  const store = useStore();

  return useCallback(
    async ({ workspaceId, sessionId }: PersistWorkspaceLastViewedTargetInput) => {
      const lastViewedTarget = store.get(lastViewedTargetAtom);
      const optimisticTargets = getOptimisticTargets(store);
      getConfirmedTarget(store);

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
      optimisticTargets.add(optimisticTarget);
      setLastViewedTarget(optimisticTarget);

      const result = await dispatch<WorkspaceLastViewedTarget>("workspace.lastViewedTarget.set", {
        workspaceId,
        sessionId,
      });

      const latestTarget = store.get(lastViewedTargetAtom);

      if (result.ok && result.data) {
        confirmedTargetByStore.set(store, result.data);

        if (latestTarget === optimisticTarget) {
          optimisticTargets.delete(optimisticTarget);
          setLastViewedTarget(result.data);
          return result.data;
        }

        optimisticTargets.delete(optimisticTarget);
        return latestTarget;
      }

      if (latestTarget === optimisticTarget) {
        const confirmedTarget = getConfirmedTarget(store);
        optimisticTargets.delete(optimisticTarget);
        setLastViewedTarget(confirmedTarget);
        return confirmedTarget;
      }

      optimisticTargets.delete(optimisticTarget);
      return latestTarget;
    },
    [dispatch, setLastViewedTarget, store]
  );
}
