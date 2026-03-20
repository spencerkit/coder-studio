import type { AgentEvent, AgentLifecycleEvent } from "../types/app";
import { subscribeWsEvent } from "../ws/client";

export const subscribeAgentEvents = (handler: (payload: AgentEvent) => void) =>
  subscribeWsEvent<AgentEvent>("agent://event", handler);

export const subscribeAgentLifecycleEvents = (handler: (payload: AgentLifecycleEvent) => void) =>
  subscribeWsEvent<AgentLifecycleEvent>("agent://lifecycle", handler);
