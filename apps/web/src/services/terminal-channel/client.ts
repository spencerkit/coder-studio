import type { TerminalChannelOutputEvent } from "../../types/app.ts";

const TERMINAL_CHANNEL_RESPONSE_PATTERNS = [
  /^\u001b\[I$/,
  /^\u001b\[O$/,
  /^\u001b\[\d+;\d+R$/,
  /^\u001b\[(?:\?|>)(?=[0-9;]*\d)[0-9;]+c$/,
  /^\u001b\](?:10|11);[^\u0007\u001b]*(?:\u0007|\u001b\\)$/,
] as const;

const TERMINAL_CHANNEL_RESPONSE_REPLACERS = [
  /\u001b\[I/g,
  /\u001b\[O/g,
  /\u001b\[\d+;\d+R/g,
  /\u001b\[(?:\?|>)(?=[0-9;]*\d)[0-9;]+c/g,
  /\u001b\](?:10|11);[^\u0007\u001b]*(?:\u0007|\u001b\\)/g,
] as const;

const ESCAPE = "\u001b";
const BELL = "\u0007";

const isTerminalChannelResponse = (value: string) => TERMINAL_CHANNEL_RESPONSE_PATTERNS.some((pattern) => pattern.test(value));

const isCsiFinalByte = (value: string) => {
  const code = value.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
};

const findOscTerminator = (value: string, start: number) => {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === BELL) return index + 1;
    if (value[index] === ESCAPE && value[index + 1] === "\\") return index + 2;
  }
  return -1;
};

export const sanitizeTerminalChannelInput = (input: string) => {
  let sanitized = input;
  for (const pattern of TERMINAL_CHANNEL_RESPONSE_REPLACERS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized.length > 0 ? sanitized : null;
};

export const consumeTerminalChannelInputFragment = (pendingInput: string, input: string) => {
  const combined = `${pendingInput}${input}`;
  let forwarded = "";
  let index = 0;

  while (index < combined.length) {
    const char = combined[index];
    if (char !== ESCAPE) {
      forwarded += char;
      index += 1;
      continue;
    }
    if (index + 1 >= combined.length) {
      return { forwarded: forwarded.length > 0 ? forwarded : null, pending: combined.slice(index) };
    }

    const marker = combined[index + 1];
    if (marker === "[") {
      let finalIndex = -1;
      for (let cursor = index + 2; cursor < combined.length; cursor += 1) {
        if (isCsiFinalByte(combined[cursor])) {
          finalIndex = cursor;
          break;
        }
      }
      if (finalIndex === -1) {
        return { forwarded: forwarded.length > 0 ? forwarded : null, pending: combined.slice(index) };
      }
      const sequence = combined.slice(index, finalIndex + 1);
      if (!isTerminalChannelResponse(sequence)) {
        forwarded += sequence;
      }
      index = finalIndex + 1;
      continue;
    }

    if (marker === "]") {
      const terminatorIndex = findOscTerminator(combined, index + 2);
      if (terminatorIndex === -1) {
        return { forwarded: forwarded.length > 0 ? forwarded : null, pending: combined.slice(index) };
      }
      const sequence = combined.slice(index, terminatorIndex);
      if (!isTerminalChannelResponse(sequence)) {
        forwarded += sequence;
      }
      index = terminatorIndex;
      continue;
    }

    forwarded += char;
    index += 1;
  }

  return { forwarded: forwarded.length > 0 ? forwarded : null, pending: "" };
};

export const shouldIgnoreTerminalChannelInput = (input: string) => sanitizeTerminalChannelInput(input) === null;

export const buildTerminalChannelInput = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  fencingToken: number,
  runtimeId: string,
  input: string,
) => ({
  type: "terminal_channel_input" as const,
  workspace_id: workspaceId,
  device_id: deviceId,
  client_id: clientId,
  fencing_token: fencingToken,
  runtime_id: runtimeId,
  input,
});

export const sendTerminalChannelInput = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  fencingToken: number,
  runtimeId: string,
  input: string,
) => {
  const sanitizedInput = sanitizeTerminalChannelInput(input);
  if (!sanitizedInput) return;
  void import("../../ws/client.ts").then(({ sendWsMessage }) => {
    sendWsMessage(buildTerminalChannelInput(
      workspaceId,
      deviceId,
      clientId,
      fencingToken,
      runtimeId,
      sanitizedInput,
    ));
  });
};

export const subscribeTerminalChannelOutput = (
  handler: (payload: TerminalChannelOutputEvent) => void,
) => {
  let unsubscribe = () => {};
  void import("../../ws/client.ts").then(({ subscribeWsEvent }) => {
    unsubscribe = subscribeWsEvent<TerminalChannelOutputEvent>("terminal://channel_output", handler);
  });
  return () => unsubscribe();
};
