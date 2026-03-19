import type { TerminalEvent } from "../types/app";
import { subscribeWsEvent } from "../ws/client";

export const subscribeTerminalEvents = (handler: (payload: TerminalEvent) => void) =>
  subscribeWsEvent<TerminalEvent>("terminal://event", handler);
