import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { dispatchCommandAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
} from "../../../atoms/workspaces";

export function useWorkspaceCloseAction() {
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaceOrder = useAtomValue(workspaceOrderAtom);
  const setActiveWorkspace = useSetAtom(activeWorkspaceIdAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);

  return useCallback(
    async (workspaceId: string, options?: { navigateHomeWhenEmpty?: boolean }) => {
      const result = await dispatch<void>("workspace.close", {
        id: workspaceId,
      });

      if (!result.ok) {
        console.error("Failed to close workspace:", result.error?.message);
        return false;
      }

      const remainingIds = workspaceOrder.filter((id) => id !== workspaceId);

      setWorkspaces((prev) => {
        const next = { ...prev };
        delete next[workspaceId];
        return next;
      });
      setWorkspaceOrder(remainingIds);
      setActiveWorkspace((current) => {
        if (current !== workspaceId) {
          return current;
        }

        return remainingIds[0] ?? null;
      });

      if (remainingIds.length === 0 && options?.navigateHomeWhenEmpty) {
        navigate("/", { replace: true });
      }

      return true;
    },
    [dispatch, navigate, setActiveWorkspace, setWorkspaceOrder, setWorkspaces, workspaceOrder]
  );
}

export default useWorkspaceCloseAction;
