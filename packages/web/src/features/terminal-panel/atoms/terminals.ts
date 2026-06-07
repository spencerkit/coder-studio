/**
 * Terminal Output State Management
 *
 * HIGH-FREQUENCY data stream. Must use atomFamily for isolation.
 * Written by: WS event handler for terminal.*.output
 */

import type { TerminalKind } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

/**
 * Output buffer structure
 * - chunks: terminal output bytes
 * - lastSeq: last received sequence number
 */
export interface OutputBuffer {
  chunks: Uint8Array[];
  lastSeq: number;
}

/**
 * Terminal output atom family (per-terminal isolation)
 */
export const terminalOutputAtomFamily = atomFamily((_terminalId: string) =>
  atom<OutputBuffer>({
    chunks: [],
    lastSeq: 0,
  })
);

/**
 * Terminal metadata atom family
 * Written by: WS event handler for terminal.*.exit
 */
export interface TerminalMeta {
  id: string;
  workspaceId: string;
  kind: TerminalKind;
  alive: boolean;
  exitCode?: number;
  title?: string;
}

export const terminalMetaAtomFamily = atomFamily((_terminalId: string) =>
  atom<TerminalMeta | null>(null)
);

export const terminalIdsAtomFamily = atomFamily((_workspaceId: string) => atom<string[]>([]));

export const terminalActiveIdAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string | null>(null)
);

export const terminalCommandSidePanelOpenAtomFamily = atomFamily((_workspaceId: string) =>
  atom<boolean>(false)
);

/**
 * Active terminal IDs in workspace (derived)
 */
export const activeTerminalsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(terminalIdsAtomFamily(workspaceId)))
);
