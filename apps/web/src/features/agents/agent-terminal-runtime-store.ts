import { AGENT_STREAM_BUFFER_LIMIT } from "../../shared/app/constants";

type AgentTerminalRuntimeEntry = {
  snapshot: string;
  transcript: string;
};

const runtimeEntries = new Map<string, AgentTerminalRuntimeEntry>();

const runtimeKey = (workspaceId: string, sessionId: string) => `${workspaceId}:${sessionId}`;

const trimSnapshot = (value: string) => (
  value.length <= AGENT_STREAM_BUFFER_LIMIT
    ? value
    : value.slice(-AGENT_STREAM_BUFFER_LIMIT)
);

const getOrCreateEntry = (
  workspaceId: string,
  sessionId: string,
  seedSnapshot = "",
  seedTranscript = seedSnapshot,
) => {
  const key = runtimeKey(workspaceId, sessionId);
  const existing = runtimeEntries.get(key);
  if (existing) {
    return existing;
  }

  const created = {
    snapshot: trimSnapshot(seedSnapshot),
    transcript: trimSnapshot(seedTranscript),
  };
  runtimeEntries.set(key, created);
  return created;
};

export const readAgentTerminalRuntimeSnapshot = (
  workspaceId: string,
  sessionId: string,
  seedSnapshot = "",
) => getOrCreateEntry(workspaceId, sessionId, seedSnapshot).snapshot;

export const readAgentTerminalRuntimeTranscript = (
  workspaceId: string,
  sessionId: string,
  seedTranscript = "",
) => getOrCreateEntry(workspaceId, sessionId, "", seedTranscript).transcript;

export const replaceAgentTerminalRuntimeSnapshot = (
  workspaceId: string,
  sessionId: string,
  snapshot: string,
  transcript = snapshot,
) => {
  const entry = getOrCreateEntry(workspaceId, sessionId);
  entry.snapshot = trimSnapshot(snapshot);
  entry.transcript = trimSnapshot(transcript);
};

export const appendAgentTerminalRuntimeSnapshot = (
  workspaceId: string,
  sessionId: string,
  chunk: string,
  transcriptChunk = chunk,
) => {
  if (!chunk && !transcriptChunk) return;
  const entry = getOrCreateEntry(workspaceId, sessionId);
  if (chunk) {
    entry.snapshot = trimSnapshot(entry.snapshot + chunk);
  }
  if (transcriptChunk) {
    entry.transcript = trimSnapshot(entry.transcript + transcriptChunk);
  }
};

export const clearAgentTerminalRuntimeSnapshot = (
  workspaceId: string,
  sessionId: string,
) => {
  runtimeEntries.delete(runtimeKey(workspaceId, sessionId));
};
