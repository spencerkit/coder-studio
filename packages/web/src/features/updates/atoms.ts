import type {
  ProductUpdatePreparation,
  ProductUpdateState,
  UpdateStateView,
} from "@coder-studio/core";
import { atom } from "jotai";
import type { UpdateController } from "./types";

export const serverUpdateStateAtom = atom<UpdateStateView | null>(null);
export const productUpdateStateAtom = atom<ProductUpdateState | null>(null);
export const updateControllerAtom = atom<UpdateController | null>(null);
export const updatePreparationAtom = atom<ProductUpdatePreparation | null>(null);

// Temporary source-level aliases until all update views consume the product model.
export const updateStateAtom = serverUpdateStateAtom;
export const updatePrepareInstallAtom = updatePreparationAtom;
