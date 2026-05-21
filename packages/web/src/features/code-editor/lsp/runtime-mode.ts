import type { LspRuntimeMode } from "@coder-studio/core";
import { atom } from "jotai";

export const lspRuntimeModeAtom = atom<LspRuntimeMode>("auto");
