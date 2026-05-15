import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus";
import { TerminalRuntime } from "./runtime";
import type { PtyHost, PtyProcess, TerminalDatabase } from "./types";

describe("TerminalRuntime preserve leases", () => {
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

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("kills attached terminals immediately when the owner disconnects without preserve", async () => {
    runtime.create(
      "term-1",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    await runtime.handleOwnerDisconnect("server-a");

    expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("keeps preserved terminals alive until they are claimed or the TTL expires", async () => {
    vi.useFakeTimers();
    runtime.create(
      "term-1",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    runtime.detachForRestart("server-a", "restart-1", 5_000);
    await runtime.handleOwnerDisconnect("server-a");

    expect(mockPty.kill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("claims preserved terminals for the next server instance", () => {
    runtime.create(
      "term-1",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    runtime.detachForRestart("server-a", "restart-1", 5_000);
    const claimed = runtime.claimPreserved("restart-1", "server-b");

    expect(claimed.map((terminal) => terminal.id)).toEqual(["term-1"]);
    expect(runtime.get("term-1")?.ownerServerInstanceId).toBe("server-b");
  });
});
