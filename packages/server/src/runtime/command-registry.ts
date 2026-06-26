import { z } from "zod";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeExecuteMeta, RuntimeRouteTarget } from "./contract.js";

export type RuntimeCommandVisibility = "public" | "internal";

export interface RuntimeCommandDefinition<S extends z.ZodTypeAny = z.ZodTypeAny, R = unknown> {
  schema: S;
  visibility: RuntimeCommandVisibility;
  resolveTarget: (args: z.output<S>) => RuntimeRouteTarget;
  handler: (args: z.output<S>, ctx: RuntimeCommandContext, meta?: RuntimeExecuteMeta) => Promise<R>;
}

const runtimeCommands = new Map<string, RuntimeCommandDefinition<any, any>>();

export function registerRuntimeCommand<S extends z.ZodTypeAny, R>(
  op: string,
  schema: S,
  definition: Omit<RuntimeCommandDefinition<S, R>, "schema" | "visibility"> & {
    visibility?: RuntimeCommandVisibility;
  }
): void {
  runtimeCommands.set(op, {
    schema,
    visibility: definition.visibility ?? "public",
    ...definition,
  });
}

export function getRuntimeCommandDefinition(
  op: string,
  options?: { includeInternal?: boolean }
): RuntimeCommandDefinition | undefined {
  const definition = runtimeCommands.get(op);
  if (!definition) {
    return undefined;
  }

  if (definition.visibility === "internal" && options?.includeInternal === false) {
    return undefined;
  }

  return definition;
}

export function getRegisteredRuntimeCommands(options?: { includeInternal?: boolean }): string[] {
  const includeInternal = options?.includeInternal ?? false;

  return Array.from(runtimeCommands.entries())
    .filter(([, definition]) => includeInternal || definition.visibility !== "internal")
    .map(([op]) => op);
}

export function clearRuntimeCommandsForTest(): void {
  runtimeCommands.clear();
}
