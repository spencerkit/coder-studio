import { WsConnectionManager } from "./connection-manager";

const manager = new WsConnectionManager();

export const subscribeWsEvent = <T = unknown>(event: string, handler: (payload: T) => void) =>
  manager.subscribe(event, handler);
