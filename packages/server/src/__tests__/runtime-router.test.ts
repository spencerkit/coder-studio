import { describe, expect, it, vi } from "vitest";
import { RuntimeRegistry } from "../host/runtime-registry.js";
import { RuntimeRouter } from "../host/runtime-router.js";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";

describe("RuntimeRouter", () => {
  it("resolves native default targets and WSL workspace targets independently", async () => {
    const bindings = new WorkspaceRuntimeBindingStore();
    bindings.bindWorkspace("ws-native", "native-default");
    bindings.bindWorkspace("ws-wsl", "wsl:ws-wsl");
    bindings.bindSession({
      id: "sess-wsl",
      workspaceId: "ws-wsl",
      terminalId: "term-wsl",
      providerId: "codex",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    });
    bindings.bindTerminal({
      id: "term-wsl",
      workspaceId: "ws-wsl",
      kind: "agent",
      title: "agent",
      cwd: "/repo",
      argv: [],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1,
    });

    const executeNative = vi.fn(async () => ({ runtime: "native" }));
    const executeWsl = vi.fn(async () => ({ runtime: "wsl" }));
    const registry = new RuntimeRegistry();
    registry.register({
      id: "native-default",
      kind: "native",
      execute: executeNative,
      summary: { scope: "shared", targetRuntime: "native" },
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });
    registry.register({
      id: "wsl:ws-wsl",
      kind: "wsl",
      summary: {
        scope: "workspace",
        workspaceId: "ws-wsl",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      },
      execute: executeWsl,
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });

    const router = new RuntimeRouter({
      runtimeRegistry: registry,
      bindings,
      defaultRuntimeId: "native-default",
    });

    await router.executeOnTarget({ kind: "workspace", workspaceId: "ws-native" }, "file.read", {});
    await router.executeOnTarget({ kind: "workspace", workspaceId: "ws-wsl" }, "file.read", {});
    await router.executeOnTarget({ kind: "session", sessionId: "sess-wsl" }, "session.stop", {});
    await router.executeOnTarget({ kind: "terminal", terminalId: "term-wsl" }, "terminal.read", {});
    await router.executeOnTarget(
      { kind: "runtime", runtimeId: "wsl:ws-wsl" },
      "skills.install.get",
      {}
    );
    await router.executeOnTarget({ kind: "default" }, "skills.library.list", {});

    expect(executeNative).toHaveBeenCalledTimes(2);
    expect(executeWsl).toHaveBeenCalledTimes(4);
  });
});
