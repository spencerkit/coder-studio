export type WsEventEnvelope = {
  type: "event";
  event: string;
  payload: unknown;
};

export type WsTerminalWriteEnvelope = {
  type: "terminal_write";
  workspace_id: string;
  terminal_id: number;
  input: string;
  fencing_token: number;
  request_id?: string;
};

export type WsTerminalResizeEnvelope = {
  type: "terminal_resize";
  workspace_id: string;
  terminal_id: number;
  cols: number;
  rows: number;
  fencing_token: number;
  request_id?: string;
};

export type WsAckEnvelope = {
  type: "ack";
  request_id: string;
};

export type WsSessionUpdateEnvelope = {
  type: "session_update";
  workspace_id: string;
  session_id: string;
  patch: Record<string, unknown>;
  fencing_token: number;
};

export type WsWorkspaceControllerHeartbeatEnvelope = {
  type: "workspace_controller_heartbeat";
  workspace_id: string;
};

export type WsTerminalChannelInputEnvelope = {
  type: "terminal_channel_input";
  workspace_id: string;
  device_id: string;
  client_id: string;
  fencing_token: number;
  runtime_id: string;
  input: string;
};

export type WsPingEnvelope = {
  type: "ping";
  ts: number;
};

export type WsPongEnvelope = {
  type: "pong";
  ts: number;
};

export type WsEnvelope = WsEventEnvelope | WsPingEnvelope | WsPongEnvelope | WsAckEnvelope;
export type WsClientEnvelope =
  | WsPingEnvelope
  | WsPongEnvelope
  | WsSessionUpdateEnvelope
  | WsTerminalWriteEnvelope
  | WsTerminalResizeEnvelope
  | WsWorkspaceControllerHeartbeatEnvelope
  | WsTerminalChannelInputEnvelope;

export const parseWsEnvelope = (message: string): WsEnvelope | null => {
  try {
    const parsed = JSON.parse(message) as Partial<WsEnvelope>;
    if (parsed?.type === "event" && typeof parsed.event === "string") {
      return {
        type: "event",
        event: parsed.event,
        payload: parsed.payload
      };
    }
    if ((parsed?.type === "ping" || parsed?.type === "pong") && typeof parsed.ts === "number") {
      return parsed as WsPingEnvelope | WsPongEnvelope;
    }
    if (parsed?.type === "ack" && typeof parsed.request_id === "string") {
      return parsed as WsAckEnvelope;
    }
    return null;
  } catch {
    return null;
  }
};
