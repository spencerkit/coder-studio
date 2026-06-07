import { useAtomValue } from "jotai";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  type CommandResult,
  type DispatchCommandOptions,
  dispatchCommandAtom,
} from "../../../atoms/connection";

export function useSessionGateDispatch() {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const navigate = useNavigate();

  return useCallback(
    async function dispatchWithSessionGate<T = unknown>(
      op: string,
      args: unknown,
      options?: DispatchCommandOptions
    ): Promise<CommandResult<T> | null> {
      const result = await dispatch<T>(op, args, options);
      if (!result.ok && result.error?.code === "activation_required") {
        navigate("/session-gate", { replace: true });
        return null;
      }

      return result;
    },
    [dispatch, navigate]
  );
}
