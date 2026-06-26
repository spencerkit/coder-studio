import type { DomainEvent } from "@coder-studio/core";
import type { RuntimeHostBridge } from "./contract.js";

export function emitRuntimeEvent(hostBridge: RuntimeHostBridge, event: DomainEvent): void {
  hostBridge.emitDomainEvent(event);
}

export function broadcastRuntimeTopic(
  hostBridge: RuntimeHostBridge,
  topic: string,
  payload: unknown
): void {
  hostBridge.broadcast(topic, payload);
}
