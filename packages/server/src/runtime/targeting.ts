import type { RuntimeRouteTarget } from "./contract.js";

export function resolveOptionalRuntimeTarget(input: {
  workspaceId?: string;
  runtimeId?: string;
}): RuntimeRouteTarget {
  if (input.runtimeId) {
    return {
      kind: "runtime",
      runtimeId: input.runtimeId,
    };
  }

  if (input.workspaceId) {
    return {
      kind: "workspace",
      workspaceId: input.workspaceId,
    };
  }

  return {
    kind: "default",
  };
}
