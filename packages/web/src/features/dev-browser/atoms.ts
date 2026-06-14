import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const pendingDevBrowserUrlAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string | null>(null)
);

export const currentDevBrowserUrlAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string | null>(null)
);
