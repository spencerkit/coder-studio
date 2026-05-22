import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { atom } from "jotai";

export const updateStateAtom = atom<UpdateStateView | null>(null);
export const updatePrepareInstallAtom = atom<UpdatePrepareInstallResponse | null>(null);

export const updateAvailableAtom = atom((get) => {
  const state = get(updateStateAtom);
  return state?.availability === "update_available";
});

export const updateMarkerVisibleAtom = atom((get) => {
  const state = get(updateStateAtom);
  return Boolean(
    state &&
      (state.availability === "update_available" ||
        state.updateStatus === "installing" ||
        state.updateStatus === "restarting" ||
        state.updateStatus === "manual_required")
  );
});
