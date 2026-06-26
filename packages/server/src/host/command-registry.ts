import { z } from "zod";
import type { HostCommandContext, HostDispatchMeta } from "./context.js";

export interface HostCommandDefinition<S extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
  schema: S;
  handler: (args: z.output<S>, ctx: HostCommandContext, meta?: HostDispatchMeta) => Promise<R>;
}

const hostCommands = new Map<string, HostCommandDefinition<any, any>>();

export function registerHostCommand<S extends z.ZodTypeAny, R>(
  op: string,
  schema: S,
  handler: HostCommandDefinition<S, R>["handler"]
): void {
  hostCommands.set(op, { schema, handler });
}

export function getHostCommandDefinition(op: string): HostCommandDefinition | undefined {
  return hostCommands.get(op);
}

export function getRegisteredHostCommands(): string[] {
  return Array.from(hostCommands.keys());
}

export function clearHostCommandsForTest(): void {
  hostCommands.clear();
}
