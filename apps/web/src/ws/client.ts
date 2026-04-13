import { WsConnectionManager, type WsConnectionState } from "./connection-manager";
import type { WsClientEnvelope } from "./protocol";

const manager = new WsConnectionManager();

export const subscribeWsEvent = <T = unknown>(event: string, handler: (payload: T) => void) =>
  manager.subscribe(event, handler);

export const subscribeWsConnectionState = (handler: (state: WsConnectionState) => void) =>
  manager.subscribeConnectionState(handler);

export const sendWsMessage = (message: WsClientEnvelope) => manager.send(message);

/**
 * Send a message with server-side ACK confirmation.
 * Returns:
 *   true  – ACK received, server confirmed delivery
 *   false – socket was open but ACK timed out (message WAS sent)
 *   null  – socket was not open, message was not sent
 */
export const sendWsMessageWithAck = (
  message: WsClientEnvelope & { request_id?: string },
  timeoutMs = 3000,
): Promise<boolean | null> => manager.sendWithAck(message, timeoutMs);

export type { WsConnectionState };
