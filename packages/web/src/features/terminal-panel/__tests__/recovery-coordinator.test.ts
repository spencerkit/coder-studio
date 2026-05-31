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
    expect(setUiMode).toHaveBeenCalledWith("closed");
  });

  it("surfaces directly closed terminals as closed UI state", async () => {
    const setUiMode = vi.fn();
    const markClosed = vi.fn();
    const sendCommand = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        terminals: [{ terminalId: "term-1", action: "closed", headSeq: 30, exitCode: 9 }],
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
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
      markClosed,
    });

    await coordinator.notifyReason("initial_mount", "term-1");

    expect(markClosed).toHaveBeenCalledWith({ exitCode: 9 });
    expect(setUiMode).toHaveBeenCalledWith("closed");
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

  it("surfaces closed UI after snapshot recovery completes a closed session", async () => {
    const setUiMode = vi.fn();
    const markClosed = vi.fn();
    const applySnapshot = vi.fn();
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          terminals: [
            {
              terminalId: "term-1",
              action: "snapshot",
              headSeq: 30,
              closed: { exitCode: 5 },
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
      markClosed,
    });

    await coordinator.notifyReason("initial_mount", "term-1");

    expect(markClosed).toHaveBeenCalledWith({ exitCode: 5 });
    expect(setUiMode).toHaveBeenCalledWith("closed");
  });

  it("passes through unrecoverable reasons so terminals can render scenario-specific recovery UI", async () => {
    const setUiMode = vi.fn();
    const sendCommand = vi.fn().mockResolvedValueOnce({
      ok: true,
      data: {
        terminals: [
          {
            terminalId: "term-1",
            action: "unrecoverable",
            reason: "too_old_no_snapshot",
          },
        ],
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
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
    });

    await coordinator.notifyReason("seq_gap", "term-1");

    expect(setUiMode).toHaveBeenCalledWith("error", { reason: "too_old_no_snapshot" });
  });

  it("surfaces reconcile command failures as reconcile_failed details instead of a generic recovery failure", async () => {
    const setUiMode = vi.fn();
    const sendCommand = vi.fn().mockResolvedValueOnce({
      ok: false,
      error: {
        code: "unknown_op",
        message: "Unknown operation: recovery.reconcile",
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
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
    });

    await coordinator.notifyReason("initial_mount", "term-1");

    expect(setUiMode).toHaveBeenCalledWith("error", {
      reason: "reconcile_failed",
      operation: "recovery.reconcile",
      errorCode: "unknown_op",
    });
  });

  it("defers silently when reconcile hits activation_required instead of surfacing a recovery failure", async () => {
    // Regression: there is a ~1s window after a WS reconnect where the socket
    // is healthy but the activation lease still points at the previous
    // wsClientId. Hitting that window with `recovery.reconcile` produced a
    // spurious "terminal recovery check failed" notice that stuck around even
    // after the client re-claimed the lease. The coordinator must now treat
    // activation_required as transient and wait for handleActivationStatus
    // to drive a retry.
    const setUiMode = vi.fn();
    const sendCommand = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "command_error",
        message: "This tab is no longer the active session",
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
      applySnapshot: vi.fn(),
    });

    coordinator.registerTerminal({
      terminalId: "term-1",
      workspaceId: "ws-1",
      getRenderedSeq: () => 20,
      setUiMode,
    });

    await coordinator.notifyReason("initial_mount", "term-1");

    // No "error" UiMode call at all — we deliberately swallow the activation
    // race instead of confusing the user with a recovery failure.
    expect(setUiMode).not.toHaveBeenCalledWith("error", expect.anything());
    expect(setUiMode).not.toHaveBeenCalledWith(
      "error",
      expect.objectContaining({ reason: "reconcile_failed" })
    );
  });

  it("retries deferred reconcile once activation transitions back to active", async () => {
    const setUiMode = vi.fn();
    const applyReplay = vi.fn();
    const sendCommand = vi
      .fn()
      // First reconcile attempt — server rejects because the activation lease
      // belongs to the previous WS.
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "command_error",
          message: "This tab is no longer the active session",
        },
      })
      // Replay attempt after activation comes back — server now accepts.
      .mockResolvedValueOnce({
        ok: true,
        data: {
          terminals: [{ terminalId: "term-1", action: "noop", headSeq: 20 }],
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

    await coordinator.notifyReason("foreground_resume", "term-1");

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(setUiMode).not.toHaveBeenCalledWith("error", expect.anything());

    // Simulate activation going through claiming -> active. The transition
    // out of "active" arms the pending flag; the transition back to "active"
    // fires the deferred reconcile.
    coordinator.handleActivationStatus("idle");
    coordinator.handleActivationStatus("active");

    // queueRecovery schedules work on a microtask chain — drain it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(2, "recovery.reconcile", {
      reason: "socket_reconnected",
      terminals: [{ terminalId: "term-1", renderedSeq: 20 }],
    });
    expect(setUiMode).toHaveBeenCalledWith("silent");
  });
});
