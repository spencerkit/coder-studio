import { WsConnectionManager, type WsConnectionState } from "./connection-manager";
import type { WsClientEnvelope } from "./protocol";

const manager = new WsConnectionManager();

export const subscribeWsEvent = <T = unknown>(event: string, handler: (payload: T) => void) =>
  manager.subscribe(event, handler);

export const subscribeWsConnectionState = (handler: (state: WsConnectionState) => void) =>
  manager.subscribeConnectionState(handler);

export const sendWsMessage = (message: WsClientEnvelope) => manager.send(message);

export type { WsConnectionState };
