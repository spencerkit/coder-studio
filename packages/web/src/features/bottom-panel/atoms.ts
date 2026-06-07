import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export type BottomPanelTab = "terminal";

export const bottomPanelActiveTabAtomFamily = atomFamily((_workspaceId: string) =>
  atom<BottomPanelTab>("terminal")
);
