import type { AgentMessage } from "../../state/workbench-core.ts";

export const appendBufferedText = (
  current: string,
  chunk: string,
  limit: number,
) => `${current}${chunk}`.slice(-limit);

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
