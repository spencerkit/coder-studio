import type { AgentMessage } from "../../state/workbench-core";

const trimBufferedText = (value: string, limit: number) => {
  if (limit <= 0) {
    return "";
  }
  if (value.length <= limit) {
    return value;
  }
  return value.slice(-limit);
};

export const appendBufferedText = (
  current: string,
  chunk: string,
  limit: number,
) => {
  const nextChunk = trimBufferedText(chunk, limit);
  if (!nextChunk) {
    return trimBufferedText(current, limit);
  }

  const remaining = limit - nextChunk.length;
  if (remaining <= 0) {
    return nextChunk;
  }

  const nextCurrent = current.length <= remaining
    ? current
    : current.slice(-remaining);
  return `${nextCurrent}${nextChunk}`;
};

export const appendBufferedChunks = (
  current: string,
  chunks: string[],
  limit: number,
) => {
  if (chunks.length === 0) {
    return trimBufferedText(current, limit);
  }

  return chunks.reduce(
    (snapshot, chunk) => appendBufferedText(snapshot, chunk, limit),
    trimBufferedText(current, limit),
  );
};

export const appendBoundedMessage = (
  messages: AgentMessage[],
  message: AgentMessage | null,
  limit: number,
) => {
  if (!message) {
    return messages;
  }
  return [...messages, message].slice(-limit);
};
