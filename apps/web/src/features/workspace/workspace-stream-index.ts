import type { WorkbenchState } from "../../state/workbench";
import {
  AGENT_STREAM_BUFFER_LIMIT,
  TERMINAL_STREAM_BUFFER_LIMIT,
} from "../../shared/app/constants.ts";
import { appendBufferedChunks } from "./workspace-stream-buffer.ts";

export type PendingAgentStream = {
  workspaceId: string;
  sessionId: string;
  transcriptChunks: string[];
  liveChunks: string[];
  unreadDelta: number;
};

export type PendingTerminalStream = {
  workspaceId: string;
  terminalId: string;
  chunks: string[];
};

export type PendingStreamIndex = {
  agent: Map<string, PendingAgentStream>;
  terminal: Map<string, PendingTerminalStream>;
};

type PendingStreamWorkspaceEntry = {
  agent: Map<string, PendingAgentStream>;
  terminal: Map<string, PendingTerminalStream>;
};

export const createPendingStreamIndex = (): PendingStreamIndex => ({
  agent: new Map(),
  terminal: new Map(),
});

export const hasPendingStreamIndex = (index: PendingStreamIndex) =>
  index.agent.size > 0 || index.terminal.size > 0;

export const recordPendingAgentStream = (
  index: PendingStreamIndex,
  entry: {
    workspaceId: string;
    sessionId: string;
    chunk: string;
    liveChunk?: string;
    unreadDelta: number;
  },
) => {
  const liveChunk = entry.liveChunk ?? entry.chunk;
  const key = `${entry.workspaceId}:${entry.sessionId}`;
  const existing = index.agent.get(key);
  if (existing) {
    if (entry.chunk) {
      existing.transcriptChunks.push(entry.chunk);
    }
    if (liveChunk) {
      existing.liveChunks.push(liveChunk);
    }
    existing.unreadDelta += entry.unreadDelta;
    return;
  }

  index.agent.set(key, {
    workspaceId: entry.workspaceId,
    sessionId: entry.sessionId,
    transcriptChunks: entry.chunk ? [entry.chunk] : [],
    liveChunks: liveChunk ? [liveChunk] : [],
    unreadDelta: entry.unreadDelta,
  });
};

export const recordPendingTerminalStream = (
  index: PendingStreamIndex,
  entry: {
    workspaceId: string;
    terminalId: string;
    chunk: string;
  },
) => {
  const key = `${entry.workspaceId}:${entry.terminalId}`;
  const existing = index.terminal.get(key);
  if (existing) {
    if (entry.chunk) {
      existing.chunks.push(entry.chunk);
    }
    return;
  }

  index.terminal.set(key, {
    workspaceId: entry.workspaceId,
    terminalId: entry.terminalId,
    chunks: entry.chunk ? [entry.chunk] : [],
  });
};

export const drainPendingStreamIndex = (index: PendingStreamIndex): PendingStreamIndex => {
  const drained: PendingStreamIndex = {
    agent: new Map(index.agent),
    terminal: new Map(index.terminal),
  };
  index.agent.clear();
  index.terminal.clear();
  return drained;
};

const buildWorkspaceEntryIndex = (index: PendingStreamIndex) => {
  const workspaceEntries = new Map<string, PendingStreamWorkspaceEntry>();

  for (const entry of index.agent.values()) {
    let workspaceEntry = workspaceEntries.get(entry.workspaceId);
    if (!workspaceEntry) {
      workspaceEntry = {
        agent: new Map(),
        terminal: new Map(),
      };
      workspaceEntries.set(entry.workspaceId, workspaceEntry);
    }
    workspaceEntry.agent.set(entry.sessionId, entry);
  }

  for (const entry of index.terminal.values()) {
    let workspaceEntry = workspaceEntries.get(entry.workspaceId);
    if (!workspaceEntry) {
      workspaceEntry = {
        agent: new Map(),
        terminal: new Map(),
      };
      workspaceEntries.set(entry.workspaceId, workspaceEntry);
    }
    workspaceEntry.terminal.set(entry.terminalId, entry);
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

    let sessionsChanged = false;
    let terminalsChanged = false;

    const sessions = workspaceEntry.agent.size === 0
      ? tab.sessions
      : tab.sessions.map((session) => {
          const entry = workspaceEntry.agent.get(session.id);
          if (!entry) {
            return session;
          }
          sessionsChanged = true;
          return {
            ...session,
            unread: tab.activeSessionId === session.id
              ? 0
              : session.unread + entry.unreadDelta,
            stream: appendBufferedChunks(
              session.stream,
              entry.transcriptChunks,
              AGENT_STREAM_BUFFER_LIMIT,
            ),
            liveTerminalStream: appendBufferedChunks(
              session.liveTerminalStream ?? "",
              entry.liveChunks,
              AGENT_STREAM_BUFFER_LIMIT,
            ),
          };
        });

    const terminals = workspaceEntry.terminal.size === 0
      ? tab.terminals
      : tab.terminals.map((terminal) => {
          const entry = workspaceEntry.terminal.get(terminal.id);
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

    if (!sessionsChanged && !terminalsChanged) {
      return tab;
    }

    changed = true;
    return {
      ...tab,
      sessions,
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
