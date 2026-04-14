/**
 * Terminal Output State Management
 *
 * HIGH-FREQUENCY data stream. Must use atomFamily for isolation.
 * Written by: WS event handler for terminal.*.output
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * Output buffer structure
 * - chunks: base64-encoded output chunks
 * - lastSeq: last received sequence number
 * - lastWritten: tracks how many chunks have been written to xterm (to prevent atom bloat)
 */
export interface OutputBuffer {
  chunks: string[];
  lastSeq: number;
  lastWritten: number;
}

/**
 * Terminal output atom family (per-terminal isolation)
 *
 * IMPORTANT: This atom does NOT store full history.
 * useEffect in XtermHost writes chunks to xterm and immediately truncates.
 * Historical output is retained in xterm scrollback (frontend-side).
 */
export const terminalOutputAtomFamily = atomFamily((terminalId: string) =>
  atom<OutputBuffer>({
    chunks: [],
    lastSeq: 0,
    lastWritten: 0,
  })
);

/**
 * Terminal metadata atom family
 * Written by: WS event handler for terminal.*.exit
 */
export interface TerminalMeta {
  id: string;
  workspaceId: string;
  kind: 'agent' | 'shell';
  alive: boolean;
  exitCode?: number;
  title?: string;
}

export const terminalMetaAtomFamily = atomFamily((terminalId: string) =>
  atom<TerminalMeta | null>(null)
);

/**
 * Active terminal IDs in workspace (derived)
 */
export const activeTerminalsAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => {
    // This requires a registry atom - placeholder for now
    // Will be populated when terminal meta events arrive
    return [] as string[];
  })
);