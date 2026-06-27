import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export const sessionActivityDialogOpenAtomFamily = atomFamily((sessionId: string) => atom(false));
export const sessionActivityKindFilterAtomFamily = atomFamily((sessionId: string) =>
  atom<"all" | "plan" | "command" | "edit" | "review">("all")
);
