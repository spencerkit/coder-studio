import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { EventBus } from "../bus/event-bus";
import { TerminalRuntime } from "./runtime";
import type { PtyHost, PtyProcess, TerminalDatabase, TerminalSpec } from "./types";

describe("TerminalRuntime", () => {
  let runtime: TerminalRuntime;
  let mockPtyHost: PtyHost;
  let mockDb: TerminalDatabase;
  let mockPty: PtyProcess;

  beforeEach(() => {
    mockPty = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    };

    mockPtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    mockDb = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };

    runtime = new TerminalRuntime({
      ptyHost: mockPtyHost,
      eventBus: new EventBus(),
      db: mockDb,
    });
  });

  const spec: TerminalSpec = {
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/workspace",
  };

  it("kills attached terminals immediately when the owner disconnects", () => {
    runtime.create("term-1", spec, "server-1");

    runtime.handleOwnerDisconnect("server-1");

    expect(mockPty.kill).toHaveBeenCalledTimes(1);
    expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("keeps preserved terminals alive across owner disconnect until the ttl expires", async () => {
    vi.useFakeTimers();

    try {
      runtime.create("term-1", spec, "server-1");

      expect(runtime.detachForRestart("server-1", "req-1", 5_000)).toEqual(["term-1"]);
      expect(runtime.get("term-1")).toMatchObject({
        id: "term-1",
        ownerServerInstanceId: "server-1",
        leaseStatus: "preserved",
      });

      runtime.handleOwnerDisconnect("server-1");
      expect(mockPty.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4_999);
      expect(mockPty.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(mockPty.kill).toHaveBeenCalledTimes(1);
      expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows the next server instance to claim preserved terminals", async () => {
    vi.useFakeTimers();

    try {
      runtime.create("term-1", spec, "server-1");
      runtime.detachForRestart("server-1", "req-1", 5_000);

      runtime.handleOwnerDisconnect("server-1");
      expect(mockPty.kill).not.toHaveBeenCalled();

      const claimed = runtime.claimPreserved("req-1", "server-2");

      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        id: "term-1",
        ownerServerInstanceId: "server-2",
        leaseStatus: "attached",
        alive: true,
      });
      expect(runtime.getOwnerServerInstanceId("term-1")).toBe("server-2");
      expect(runtime.hydrateAttached("server-2")).toMatchObject([
        {
          id: "term-1",
          ownerServerInstanceId: "server-2",
          leaseStatus: "attached",
        },
      ]);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockPty.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks recovery metadata from terminal output", () => {
    runtime.create("term-1", spec, "server-1");

    const onData = (mockPty.onData as Mock).mock.calls[0][0] as (data: string) => void;
    onData("hello");

    expect(runtime.getRecoveryMetadata("term-1")).toMatchObject({
      alive: true,
      recentOutputBase64: Buffer.from("hello").toString("base64"),
      lastOutputAt: expect.any(Number),
    });
  });
});
