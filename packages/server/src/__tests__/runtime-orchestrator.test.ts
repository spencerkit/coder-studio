import { describe, expect, it, vi } from "vitest";
import { createRuntimeOrchestrator } from "../host/runtime-orchestrator.js";
import { RuntimeRegistry } from "../host/runtime-registry.js";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";
import type { RuntimeHandle } from "../runtime/contract.js";

function createRuntimeHandle(input: {
  id: string;
  kind: RuntimeHandle["kind"];
  stop?: RuntimeHandle["stop"];
}): RuntimeHandle {
  return {
    id: input.id,
    kind: input.kind,
    execute: vi.fn(async () => ({})),
    disposeWorkspace: vi.fn(async () => {}),
    health: vi.fn(async () => ({ ok: true as const })),
    stop: input.stop,
  };
}

describe("runtime orchestrator", () => {
  it("continues stopping later runtimes and managed WSL bridges after an earlier stop failure", async () => {
    const firstStopError = new Error("failed to stop first runtime");
    const firstStop = vi.fn().mockRejectedValueOnce(firstStopError);
    const secondStop = vi.fn(async () => {});
    const stopManagedWslBridges = vi.fn(async () => {});
    const runtimeRegistry = new RuntimeRegistry();
    runtimeRegistry.register(
      createRuntimeHandle({
        id: "native-default",
        kind: "native",
        stop: firstStop,
      })
    );
    runtimeRegistry.register(
      createRuntimeHandle({
        id: "wsl:Ubuntu-24.04",
        kind: "wsl",
        stop: secondStop,
      })
    );

    const orchestrator = createRuntimeOrchestrator({
      runtimeRegistry,
      bindings: new WorkspaceRuntimeBindingStore(),
      workspaceLookup: {
        get: () => undefined,
      },
      nativeRuntimeId: "native-default",
      createWslRuntime: vi.fn(),
      stopManagedWslBridges,
    });

    await expect(orchestrator.stopAllRuntimes()).rejects.toThrow(firstStopError.message);
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStop).toHaveBeenCalledTimes(1);
    expect(stopManagedWslBridges).toHaveBeenCalledTimes(1);
  });
});
