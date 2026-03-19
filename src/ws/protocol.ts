export type WsEventEnvelope = {
  type: "event";
  event: string;
  payload: unknown;
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
