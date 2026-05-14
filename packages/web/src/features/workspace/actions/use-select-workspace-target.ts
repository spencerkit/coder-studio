import { useSetAtom } from "jotai";
import { useCallback } from "react";
import { activeWorkspaceIdAtom } from "../../../atoms/workspaces";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";

export function useSelectWorkspaceTarget() {
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();

  return useCallback(
    async (workspaceId: string) => {
      if (!workspaceId) {
        return null;
      }

      setActiveWorkspaceId(workspaceId);
      return persistLastViewedTarget({ workspaceId });
    },
    [persistLastViewedTarget, setActiveWorkspaceId]
  );
}
