import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export type SessionActivityKindFilter = "all" | "plan" | "command" | "edit" | "review";

export const sessionActivityDialogOpenAtomFamily = atomFamily((sessionId: string) => atom(false));
export const sessionActivityKindFilterAtomFamily = atomFamily((sessionId: string) =>
  atom<SessionActivityKindFilter>("all")
);
