import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clearRuntimeCommandsForTest,
  getRegisteredRuntimeCommands,
  getRuntimeCommandDefinition,
  registerRuntimeCommand,
} from "../runtime/command-registry.js";

describe("runtime command registry", () => {
  it("keeps route resolution metadata next to the runtime handler", () => {
    clearRuntimeCommandsForTest();
    registerRuntimeCommand("runtime.test", z.object({ workspaceId: z.string() }), {
      resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
      handler: async () => ({ ok: true }),
    });

    const definition = getRuntimeCommandDefinition("runtime.test");
    expect(definition?.resolveTarget({ workspaceId: "ws-1" })).toEqual({
      kind: "workspace",
      workspaceId: "ws-1",
    });
  });

  it("keeps internal runtime commands registered while hiding them from public listings", () => {
    clearRuntimeCommandsForTest();
    registerRuntimeCommand("runtime.internal", z.object({ workspaceId: z.string() }), {
      visibility: "internal",
      resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
      handler: async () => ({ ok: true }),
    });

    expect(getRuntimeCommandDefinition("runtime.internal")).toBeDefined();
    expect(
      getRuntimeCommandDefinition("runtime.internal", { includeInternal: false })
    ).toBeUndefined();
    expect(getRegisteredRuntimeCommands()).not.toContain("runtime.internal");
  });
});
