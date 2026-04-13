import type { AgentLifecycleEvent } from "../types/app";
import { subscribeWsEvent } from "../ws/client";

export const subscribeAgentLifecycleEvents = (handler: (payload: AgentLifecycleEvent) => void) =>
  subscribeWsEvent<AgentLifecycleEvent>("agent://lifecycle", handler);
