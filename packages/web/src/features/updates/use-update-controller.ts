import type { ProductUpdateState, UpdateStateView } from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import { productUpdateStateAtom, updateControllerAtom, updatePreparationAtom } from "./atoms";
import { createUpdateController } from "./controller";
import type { UpdateCommandDispatcher, UpdateController } from "./types";

function contextIdentity(state: UpdateStateView | null): string | null {
  if (!state) return null;
  const context = state.runtimeContext;
  return [
    context.environment,
    context.authority,
    context.supported ? "supported" : "unsupported",
    context.unsupportedReason ?? "",
  ].join(":");
}

export function useUpdateController(
  serverState: UpdateStateView | null,
  dispatch: UpdateCommandDispatcher
): {
  controller: UpdateController | null;
  state: ProductUpdateState | null;
} {
  const controller = useAtomValue(updateControllerAtom);
  const state = useAtomValue(productUpdateStateAtom);
  const setController = useSetAtom(updateControllerAtom);
  const setState = useSetAtom(productUpdateStateAtom);
  const setPreparation = useSetAtom(updatePreparationAtom);
  const store = useStore();
  const generationRef = useRef(0);
  const identity = useMemo(() => contextIdentity(serverState), [serverState]);
  const stateForIdentity = useRef(serverState);
  stateForIdentity.current = serverState;

  useEffect(() => {
    const generation = ++generationRef.current;
    let activeController: UpdateController | null = null;
    let unsubscribe: (() => void) | null = null;

    if (!identity || !stateForIdentity.current) {
      setController(null);
      setState(null);
      setPreparation(null);
      return () => {
        generationRef.current += 1;
      };
    }

    const wireState = stateForIdentity.current;
    void createUpdateController({
      serverState: wireState,
      desktopBridge: typeof window === "undefined" ? undefined : window.coderStudioDesktop,
      dispatch,
    }).then((nextController) => {
      if (generationRef.current !== generation) {
        nextController.dispose();
        return;
      }

      activeController = nextController;
      unsubscribe = nextController.subscribe((nextState) => {
        if (generationRef.current === generation) setState(nextState);
      });
      setController(nextController);
      setPreparation(null);
      setState(nextController.getState());
    });

    return () => {
      generationRef.current += 1;
      unsubscribe?.();
      activeController?.dispose();
      if (activeController && store.get(updateControllerAtom) === activeController) {
        setController(null);
        setState(null);
        setPreparation(null);
      }
    };
  }, [dispatch, identity, setController, setPreparation, setState, store]);

  return { controller, state };
}
