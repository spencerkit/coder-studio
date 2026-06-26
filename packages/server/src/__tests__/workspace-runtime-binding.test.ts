import { describe, expect, it } from "vitest";
import { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";

describe("WorkspaceRuntimeBindingStore", () => {
  it("tracks workspace, session, and terminal bindings together", () => {
    const store = new WorkspaceRuntimeBindingStore();
    store.bindWorkspace("ws-1", "native-default");
    store.bindSession({
      id: "sess-1",
      workspaceId: "ws-1",
      terminalId: "term-1",
      providerId: "codex",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    });
    store.bindTerminal({
      id: "term-1",
      workspaceId: "ws-1",
      kind: "agent",
      title: "Claude",
      cwd: "/repo",
      argv: [],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1,
    });

    expect(store.getRuntimeIdForWorkspace("ws-1")).toBe("native-default");
    expect(store.findWorkspaceIdBySessionId("sess-1")).toBe("ws-1");
    expect(store.findWorkspaceIdByTerminalId("term-1")).toBe("ws-1");
    expect(store.findSessionIdByTerminalId("term-1")).toBe("sess-1");
    expect(store.listSessionsForWorkspace("ws-1")).toHaveLength(1);
    expect(store.listTerminalsForWorkspace("ws-1")).toHaveLength(1);
  });
});
