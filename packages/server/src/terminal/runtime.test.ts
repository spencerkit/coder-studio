import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
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

  it("continues owner disconnect cleanup when one terminal kill rejects", async () => {
    const rejectingPty: PtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockRejectedValue(new Error("kill failed")),
    };
    const secondPty: PtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    };

    mockPtyHost.spawn = vi.fn().mockReturnValueOnce(rejectingPty).mockReturnValueOnce(secondPty);

    runtime = new TerminalRuntime({
      ptyHost: mockPtyHost,
      eventBus: new EventBus(),
      db: mockDb,
    });

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
    runtime.create(
      "term-2",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    await expect(runtime.handleOwnerDisconnect("server-a")).resolves.toBeUndefined();
    expect(rejectingPty.kill).toHaveBeenCalledWith("SIGTERM");
    expect(secondPty.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("waits for PTY exit before resolving an explicit close", async () => {
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

    const closePromise = runtime.close("term-1");
    let resolved = false;
    void closePromise.then(() => {
      resolved = true;
    });

    await Promise.resolve();

    expect(mockPty.kill).toHaveBeenCalledWith("SIGTERM");
    expect(resolved).toBe(false);

    const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0] as (event: {
      exitCode: number;
    }) => void;
    onExitCallback({ exitCode: 0 });

    await closePromise;
    expect(resolved).toBe(true);
  });

  it("keeps replay available for 1 second after exit before cleanup", async () => {
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

    const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0] as (data: string) => void;
    const onExitCallback = (mockPty.onExit as Mock).mock.calls[0][0] as (event: {
      exitCode: number;
    }) => void;

    onDataCallback("hello");
    onExitCallback({ exitCode: 0 });

    expect(runtime.replay("term-1", 0)).toMatchObject({
      status: "ok",
      data: Buffer.from("hello"),
      seq: 5,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtime.replay("term-1", 0)).toEqual({ status: "unknown" });
  });
});
