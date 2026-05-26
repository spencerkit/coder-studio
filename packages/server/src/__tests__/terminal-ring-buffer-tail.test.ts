import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TerminalManager } from "../terminal/manager.js";
import type { PtyHost, PtyProcess, TerminalDatabase, TerminalSpec } from "../terminal/types.js";

describe("TerminalManager.getRingBufferTail", () => {
  it("returns the last N bytes from the terminal ring buffer", () => {
    const mockPty: PtyProcess = {
      pid: 43210,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    };

    const ptyHost: PtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    const db: TerminalDatabase = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };

    const manager = new TerminalManager({
      ptyHost,
      eventBus: new EventBus(),
      db,
    });

    const spec: TerminalSpec = {
      workspaceId: "ws-tail",
      kind: "shell",
      argv: ["bash"],
      cwd: "/tmp",
    };

    const terminal = manager.create(spec);
    const onData = vi.mocked(mockPty.onData).mock.calls[0]?.[0];
    expect(onData).toBeTypeOf("function");

    onData?.("abcdefghij");

    expect(manager.getRingBufferTail(terminal.id, 4).toString()).toBe("ghij");
  });
});
