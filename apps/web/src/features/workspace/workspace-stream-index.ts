import type { WorkbenchState } from "../../state/workbench";
import { TERMINAL_STREAM_BUFFER_LIMIT } from "../../shared/app/constants";
import { appendBufferedChunks } from "./workspace-stream-buffer";

export type PendingTerminalStream = {
  workspaceId: string;
  terminalId: string;
  chunks: string[];
};

export type PendingStreamIndex = {
  terminal: Map<string, PendingTerminalStream>;
};

export const createPendingStreamIndex = (): PendingStreamIndex => ({
  terminal: new Map(),
});

export const hasPendingStreamIndex = (index: PendingStreamIndex) =>
  index.terminal.size > 0;

export const recordPendingTerminalStream = (
  index: PendingStreamIndex,
  entry: {
    workspaceId: string;
    terminalId: string;
    chunk: string;
  },
) => {
  if (!entry.chunk) {
    return false;
  }
  const key = `${entry.workspaceId}:${entry.terminalId}`;
  const existing = index.terminal.get(key);
  if (existing) {
    existing.chunks.push(entry.chunk);
    return true;
  }

  index.terminal.set(key, {
    workspaceId: entry.workspaceId,
    terminalId: entry.terminalId,
    chunks: [entry.chunk],
  });
  return true;
};

export const drainPendingStreamIndex = (index: PendingStreamIndex): PendingStreamIndex => {
  const drained: PendingStreamIndex = {
    terminal: new Map(index.terminal),
  };
  index.terminal.clear();
  return drained;
};

const buildWorkspaceEntryIndex = (index: PendingStreamIndex) => {
  const workspaceEntries = new Map<string, Map<string, PendingTerminalStream>>();

  for (const entry of index.terminal.values()) {
    let workspaceEntry = workspaceEntries.get(entry.workspaceId);
    if (!workspaceEntry) {
      workspaceEntry = new Map();
      workspaceEntries.set(entry.workspaceId, workspaceEntry);
    }
    workspaceEntry.set(entry.terminalId, entry);
  }

  return workspaceEntries;
};

export const applyPendingStreamIndex = (
  current: WorkbenchState,
  index: PendingStreamIndex,
): WorkbenchState => {
  if (!hasPendingStreamIndex(index)) {
    return current;
  }

  const workspaceEntries = buildWorkspaceEntryIndex(index);
  let changed = false;

  const tabs = current.tabs.map((tab) => {
    const workspaceEntry = workspaceEntries.get(tab.id);
    if (!workspaceEntry) {
      return tab;
    }

    let terminalsChanged = false;

    const terminals = workspaceEntry.size === 0
      ? tab.terminals
      : tab.terminals.map((terminal) => {
          const entry = workspaceEntry.get(terminal.id);
          if (!entry) {
            return terminal;
          }
          terminalsChanged = true;
          return {
            ...terminal,
            output: appendBufferedChunks(
              terminal.output,
              entry.chunks,
              TERMINAL_STREAM_BUFFER_LIMIT,
            ),
          };
        });

    if (!terminalsChanged) {
      return tab;
    }

    changed = true;
    return {
      ...tab,
      terminals,
    };
  });

  return changed
    ? {
        ...current,
        tabs,
      }
    : current;
};
