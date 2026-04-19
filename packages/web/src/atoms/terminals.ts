/**
 * Terminal Output State Management
 *
 * HIGH-FREQUENCY data stream. Must use atomFamily for isolation.
 * Written by: WS event handler for terminal.*.output
 */

import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';

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
export const terminalOutputAtomFamily = atomFamily((_terminalId: string) =>
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

export const terminalMetaAtomFamily = atomFamily((_terminalId: string) =>
  atom<TerminalMeta | null>(null)
);

/**
 * Active terminal IDs in workspace (derived)
 * 
 * Note: Since jotai's atomFamily doesn't support iteration, the terminal panel
 * maintains a local state registry of terminal IDs. This atom serves as the
 * derived interface for components that need active terminal info.
 * TerminalMeta atoms are populated by WS event handlers in providers.tsx.
 */
export const activeTerminalsAtomFamily = atomFamily((_workspaceId: string) =>
  atom<string[]>((_get) => {
    // Terminal panel tracks IDs via local state on terminal.created events.
    // This derived atom can be enhanced with a registry atom in future.
    return [];
  })
);
