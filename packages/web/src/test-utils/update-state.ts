import type { UpdateStateView } from "@coder-studio/core";
import type { createStore } from "jotai";
import {
  productUpdateStateAtom,
  updateControllerAtom,
  updateStateAtom,
} from "../features/updates/atoms";
import { mapCliUpdateState } from "../features/updates/controller";
import type { UpdateController } from "../features/updates/types";

export function seedCliUpdateState(
  store: ReturnType<typeof createStore>,
  state: UpdateStateView
): void {
  const productState = mapCliUpdateState(state);
  const controller: UpdateController = {
    kind: "cli",
    getState: () => productState,
    refresh: async () => productState,
    check: async () => productState,
    download: async () => productState,
    retry: async () => productState,
    cancelDownload: async () => productState,
    prepare: async () => ({
      state: productState,
      activity: {
        runningTerminalCount: 0,
        runningSessionCount: 0,
        runningSupervisorCount: 0,
        hasActiveWork: false,
      },
      canProceed: true,
    }),
    start: async () => productState,
    getSettings: async () => null,
    setSettings: async () => null,
    subscribe: () => () => {},
    dispose: () => {},
  };

  store.set(updateStateAtom, state);
  store.set(productUpdateStateAtom, productState);
  store.set(updateControllerAtom, controller);
}
