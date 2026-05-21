import { describe, expect, it, vi } from "vitest";
import { createRecoveryCoordinator } from "../recovery-coordinator";
import {
  getGlobalRecoveryCoordinator,
  resetGlobalRecoveryCoordinator,
  setGlobalRecoveryCoordinator,
} from "../recovery-singleton";

describe("RecoveryCoordinator", () => {
  it("disposes the previous global coordinator when replacing or resetting it", () => {
    const first = {
      registerTerminal: vi.fn(),
      notifyReason: vi.fn(),
      handleConnectionStatus: vi.fn(),
      dispose: vi.fn(),
    };
    const second = {
      registerTerminal: vi.fn(),
      notifyReason: vi.fn(),
      handleConnectionStatus: vi.fn(),
      dispose: vi.fn(),
    };

    setGlobalRecoveryCoordinator(first);
    expect(getGlobalRecoveryCoordinator()).toBe(first);

    setGlobalRecoveryCoordinator(second);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();
    expect(getGlobalRecoveryCoordinator()).toBe(second);

    resetGlobalRecoveryCoordinator();
    expect(second.dispose).toHaveBeenCalledTimes(1);
    expect(getGlobalRecoveryCoordinator()).toBeNull();
  });

  it("defers foreground recovery until the websocket reconnects when transport is disconnected", async () => {
    let connectionStatus = "disconnected";
    let statusListener: ((status: string) => void) | undefined;
    const setUiMode = vi.fn();
    const sendCommand = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        terminals: [{ terminalId: "term-1", action: "noop", headSeq: 9 }],
      },
    });
    const wsClient = {
      getStatus: vi.fn(() => connectionStatus),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn((listener: (status: string) => void) => {
        statusListener = listener;
        return () => {};
      }),
      subscribe: vi.fn(() => () => {}),
    };

    const coordinator = createRecoveryCoordinator({
      wsClient,
      sendCommand,
      applyReplay: vi.fn(),
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 9,
      setUiMode,
    });

    await coordinator.notifyReason("foreground_resume");

    expect(wsClient.probeConnection).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();

    connectionStatus = "connected";
    statusListener?.("connected");

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("recovery.reconcile", {
        reason: "socket_reconnected",
        terminals: [{ terminalId: "term-1", renderedSeq: 9 }],
      });
    });
    expect(wsClient.probeConnection).not.toHaveBeenCalled();
    expect(setUiMode).toHaveBeenCalledWith("silent");
  });

  it("probes then reconciles silently on foreground resume when transport is connected", async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        terminals: [{ terminalId: "term-1", action: "noop", headSeq: 9 }],
      },
    });
    const wsClient = {
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn(() => () => {}),
      subscribe: vi.fn(() => () => {}),
    };

    const applyReplay = vi.fn();
    const applySnapshot = vi.fn();

    const coordinator = createRecoveryCoordinator({
      wsClient,
      sendCommand,
      applyReplay,
      applySnapshot,
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 9,
      setUiMode: vi.fn(),
    });

    await coordinator.notifyReason("foreground_resume");

    expect(wsClient.probeConnection).toHaveBeenCalledWith("foreground_resume");
    expect(sendCommand).toHaveBeenCalledWith("recovery.reconcile", {
      reason: "foreground_resume",
      terminals: [{ terminalId: "term-1", renderedSeq: 9 }],
    });
    expect(applyReplay).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it("propagates probe failures as pending reconnect recovery instead of throwing", async () => {
    const wsClient = {
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockRejectedValue(new Error("Connection probe timeout")),
      onStatus: vi.fn(() => () => {}),
      subscribe: vi.fn(() => () => {}),
    };
    const sendCommand = vi.fn();

    const setUiMode = vi.fn();
    const coordinator = createRecoveryCoordinator({
      wsClient,
      sendCommand,
      applyReplay: vi.fn(),
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 1,
      setUiMode,
    });

    await expect(coordinator.notifyReason("foreground_resume")).resolves.toBeUndefined();

    expect(sendCommand).not.toHaveBeenCalled();
    expect(setUiMode).not.toHaveBeenCalledWith("error");
  });

  it("executes replay as non-blocking recovery", async () => {
    const setUiMode = vi.fn();
    const applyReplay = vi.fn();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          terminals: [{ terminalId: "term-1", action: "replay", fromSeq: 20, headSeq: 30 }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: 11,
          seq: 30,
          bytes: new TextEncoder().encode("missed tail"),
        },
      });

    const coordinator = createRecoveryCoordinator({
      wsClient: {
        getStatus: vi.fn(() => "connected"),
        probeConnection: vi.fn().mockResolvedValue({ ok: true }),
        onStatus: vi.fn(() => () => {}),
        subscribe: vi.fn(() => () => {}),
      } as never,
      sendCommand,
      applyReplay,
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
    });

    await coordinator.notifyReason("seq_gap", "term-1");

    expect(sendCommand).toHaveBeenNthCalledWith(1, "recovery.reconcile", {
      reason: "seq_gap",
      terminals: [{ terminalId: "term-1", renderedSeq: 20 }],
    });
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "terminal.replay",
      { terminalId: "term-1", lastSeq: 20 },
      { timeoutMs: 120_000 }
    );
    expect(setUiMode).toHaveBeenCalledWith("non_blocking_recovering");
    expect(applyReplay).toHaveBeenCalledWith(
      "term-1",
      expect.objectContaining({
        status: "ok",
        transport: "binary",
        streamId: 1,
        seq: 30,
      })
    );
  });

  it("applies closed terminal state after replay recovery", async () => {
    const setUiMode = vi.fn();
    const markClosed = vi.fn();
    const applyReplay = vi.fn();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          terminals: [
            {
              terminalId: "term-1",
              action: "replay",
              fromSeq: 20,
              headSeq: 30,
              closed: { exitCode: 7 },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: 11,
          seq: 30,
          bytes: new TextEncoder().encode("missed tail"),
        },
      });

    const coordinator = createRecoveryCoordinator({
      wsClient: {
        getStatus: vi.fn(() => "connected"),
        probeConnection: vi.fn().mockResolvedValue({ ok: true }),
        onStatus: vi.fn(() => () => {}),
        subscribe: vi.fn(() => () => {}),
      } as never,
      sendCommand,
      applyReplay,
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
      markClosed,
    });

    await coordinator.notifyReason("seq_gap", "term-1");

    expect(markClosed).toHaveBeenCalledWith({ exitCode: 7 });
    expect(setUiMode).toHaveBeenCalledWith("silent");
  });

  it("executes snapshot as blocking rebuild", async () => {
    const setUiMode = vi.fn();
    const applySnapshot = vi.fn();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          terminals: [{ terminalId: "term-1", action: "snapshot", headSeq: 30 }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: "ok",
          transport: "binary",
          streamId: 1,
          size: 3,
          seq: 30,
          rows: 24,
          cols: 80,
          source: "headless",
          bytes: new Uint8Array([1, 2, 3]),
        },
      });

    const coordinator = createRecoveryCoordinator({
      wsClient: {
        getStatus: vi.fn(() => "connected"),
        probeConnection: vi.fn().mockResolvedValue({ ok: true }),
        onStatus: vi.fn(() => () => {}),
        subscribe: vi.fn(() => () => {}),
      } as never,
      sendCommand,
      applyReplay: vi.fn(),
      applySnapshot,
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 0,
      setUiMode,
    });

    await coordinator.notifyReason("initial_mount", "term-1");

    expect(setUiMode).toHaveBeenCalledWith("blocking_rebuild");
    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "terminal.snapshot",
      { terminalId: "term-1" },
      { timeoutMs: 120_000 }
    );
    expect(applySnapshot).toHaveBeenCalledWith(
      "term-1",
      expect.objectContaining({
        status: "ok",
        transport: "binary",
        streamId: 1,
        seq: 30,
      })
    );
  });
});
