import { WsConnectionManager, type WsConnectionState } from "./connection-manager.ts";
import type { WsClientEnvelope } from "./protocol.ts";

const manager = new WsConnectionManager();

export const subscribeWsEvent = <T = unknown>(event: string, handler: (payload: T) => void) =>
  manager.subscribe(event, handler);

export const subscribeWsConnectionState = (handler: (state: WsConnectionState) => void) =>
  manager.subscribeConnectionState(handler);

export const sendWsMessage = (message: WsClientEnvelope) => manager.send(message);

export type { WsConnectionState };
