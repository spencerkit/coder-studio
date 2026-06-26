import { describe, expect, it, vi } from "vitest";
import { RuntimeRegistry } from "../host/runtime-registry.js";
import { RuntimeRouter } from "../host/runtime-router.js";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";

describe("RuntimeRouter", () => {
  it("resolves workspace, session, terminal, and default targets", async () => {
    const bindings = new WorkspaceRuntimeBindingStore();
    bindings.bindWorkspace("ws-1", "native-default");
    bindings.bindSession({
      id: "sess-1",
      workspaceId: "ws-1",
      terminalId: "term-1",
      providerId: "codex",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    });
    bindings.bindTerminal({
      id: "term-1",
      workspaceId: "ws-1",
      kind: "agent",
      title: "agent",
      cwd: "/repo",
      argv: [],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1,
    });

    const execute = vi.fn(async () => ({ ok: true }));
    const registry = new RuntimeRegistry();
    registry.register({
      id: "native-default",
      kind: "native",
      execute,
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });

    const router = new RuntimeRouter({
      runtimeRegistry: registry,
      bindings,
      defaultRuntimeId: "native-default",
    });

    await router.executeOnTarget({ kind: "workspace", workspaceId: "ws-1" }, "file.read", {});
    await router.executeOnTarget({ kind: "session", sessionId: "sess-1" }, "session.stop", {});
    await router.executeOnTarget({ kind: "terminal", terminalId: "term-1" }, "terminal.read", {});
    await router.executeOnTarget({ kind: "default" }, "skills.library.list", {});

    expect(execute).toHaveBeenCalledTimes(4);
  });
});
