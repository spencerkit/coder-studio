export type WsEventEnvelope = {
  type: "event";
  event: string;
  payload: unknown;
};

export type WsAgentSendEnvelope = {
  type: "agent_send";
  workspace_id: string;
  session_id: string;
  input: string;
  append_newline?: boolean;
  fencing_token: number;
};

export type WsTerminalWriteEnvelope = {
  type: "terminal_write";
  workspace_id: string;
  terminal_id: number;
  input: string;
  fencing_token: number;
};

export type WsTerminalResizeEnvelope = {
  type: "terminal_resize";
  workspace_id: string;
  terminal_id: number;
  cols: number;
  rows: number;
  fencing_token: number;
};

export type WsAgentResizeEnvelope = {
  type: "agent_resize";
  workspace_id: string;
  session_id: string;
  cols: number;
  rows: number;
  fencing_token: number;
};

export type WsSessionUpdateEnvelope = {
  type: "session_update";
  workspace_id: string;
  session_id: number;
  patch: Record<string, unknown>;
  fencing_token: number;
};

export type WsWorkspaceControllerHeartbeatEnvelope = {
  type: "workspace_controller_heartbeat";
  workspace_id: string;
};

export type WsPingEnvelope = {
  type: "ping";
  ts: number;
};

export type WsPongEnvelope = {
  type: "pong";
  ts: number;
};

export type WsEnvelope = WsEventEnvelope | WsPingEnvelope | WsPongEnvelope;
export type WsClientEnvelope =
  | WsPingEnvelope
  | WsPongEnvelope
  | WsAgentSendEnvelope
  | WsAgentResizeEnvelope
  | WsSessionUpdateEnvelope
  | WsTerminalWriteEnvelope
  | WsTerminalResizeEnvelope
  | WsWorkspaceControllerHeartbeatEnvelope;

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
    return null;
  } catch {
    return null;
  }
};
