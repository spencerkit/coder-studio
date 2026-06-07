import type { ProviderListItem, ProviderRuntimeStatusResponse } from "@coder-studio/core";
import { atom } from "jotai";

export const providerListAtom = atom<ProviderListItem[]>([]);

export const providerRuntimeStatusAtom = atom<
  ProviderRuntimeStatusResponse["providers"] | undefined
>(undefined);
