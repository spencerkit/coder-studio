import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { atom } from "jotai";

export const updateStateAtom = atom<UpdateStateView | null>(null);
export const updatePrepareInstallAtom = atom<UpdatePrepareInstallResponse | null>(null);
