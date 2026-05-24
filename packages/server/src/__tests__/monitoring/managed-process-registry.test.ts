import { describe, expect, it } from "vitest";
import { ManagedProcessRegistry } from "../../monitoring/managed-process-registry.js";

describe("ManagedProcessRegistry", () => {
  it("registerServerProcess only keeps one entry for the same pid", () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });

    registry.registerServerProcess(9001);
    registry.registerServerProcess(9001);

    expect(registry.listRoots()).toEqual([
      {
        ownerId: "server:9001",
        rootPid: 9001,
        kind: "server",
        label: "Coder Studio server",
        startedAt: 10,
      },
    ]);
  });

  it("creates a terminal root before session binding and patches it in place after bind", () => {
    let now = 20;
    const registry = new ManagedProcessRegistry({ now: () => now });

    registry.upsertTerminalRoot({
      terminalId: "term-1",
      workspaceId: "ws-1",
      pid: 3100,
      kind: "agent",
      title: "Build agent",
    });

    expect(registry.listRoots()).toEqual([
      {
        ownerId: "terminal:term-1",
        rootPid: 3100,
        kind: "terminal",
        label: "Build agent",
        workspaceId: "ws-1",
        terminalId: "term-1",
        startedAt: 20,
      },
    ]);

    now = 40;
    registry.bindSessionToTerminal("term-1", {
      sessionId: "session-1",
      providerId: "openai",
      label: "Claude Code session",
    });

    expect(registry.listRoots()).toEqual([
      {
        ownerId: "terminal:term-1",
        rootPid: 3100,
        kind: "terminal",
        label: "Claude Code session",
        workspaceId: "ws-1",
        terminalId: "term-1",
        sessionId: "session-1",
        providerId: "openai",
        startedAt: 20,
      },
    ]);
  });

  it("unregisterByOwner removes roots cleanly without disturbing other owners", () => {
    let now = 5;
    const registry = new ManagedProcessRegistry({ now: () => now });

    registry.registerServerProcess(9001);

    now = 15;
    registry.upsertTerminalRoot({
      terminalId: "term-1",
      workspaceId: "ws-1",
      pid: 3100,
      kind: "shell",
      title: "Project shell",
    });
    registry.bindSessionToTerminal("term-1", {
      sessionId: "session-1",
      providerId: "openai",
      label: "Interactive shell",
    });

    now = 25;
    registry.registerBackgroundRoot({
      ownerId: "background:watcher-1",
      rootPid: 4500,
      kind: "background",
      label: "Watcher",
      workspaceId: "ws-1",
      startedAt: 25,
    });

    registry.unregisterByOwner("terminal:term-1");

    expect(registry.listRoots()).toEqual([
      {
        ownerId: "server:9001",
        rootPid: 9001,
        kind: "server",
        label: "Coder Studio server",
        startedAt: 5,
      },
      {
        ownerId: "background:watcher-1",
        rootPid: 4500,
        kind: "background",
        label: "Watcher",
        workspaceId: "ws-1",
        startedAt: 25,
      },
    ]);
  });
});
