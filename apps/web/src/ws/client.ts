import { WsConnectionManager, type WsConnectionState } from "./connection-manager";

const manager = new WsConnectionManager();

export const subscribeWsEvent = <T = unknown>(event: string, handler: (payload: T) => void) =>
  manager.subscribe(event, handler);

export const subscribeWsConnectionState = (handler: (state: WsConnectionState) => void) =>
  manager.subscribeConnectionState(handler);

export type { WsConnectionState };
