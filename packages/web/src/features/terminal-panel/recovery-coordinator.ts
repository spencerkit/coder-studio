import type {
  RecoveryClosedTerminalState,
  RecoveryReason,
  RecoveryReconcileDecision,
  RecoveryReconcileResult,
  TerminalContinuityLostEvent,
} from "@coder-studio/core";
import type { DispatchCommand } from "../../atoms/connection";
import type {
  ConnectionStatus,
  ProbeTrigger,
  TerminalReplayPayload,
  TerminalSnapshotPayload,
} from "../../ws/client";
import {
  isRecoveryControlPlaneError,
  type RecoveryOperation,
  type RecoveryUiMode,
  type RecoveryUiModeDetail,
  TERMINAL_REPLAY_TIMEOUT_MS,
} from "./replay-state";

interface RegisteredTerminal {
  terminalId: string;
  workspaceId: string;
  getRenderedSeq: () => number;
  setUiMode: (mode: RecoveryUiMode, detail?: RecoveryUiModeDetail) => void;
  markClosed?: (state: RecoveryClosedTerminalState) => Promise<void> | void;
  completeRecovery?: (
    headSeq: number,
    closed?: RecoveryClosedTerminalState
  ) => Promise<void> | void;
  applyReplay?: (payload: TerminalReplayPayload) => Promise<void> | void;
  applySnapshot?: (payload: TerminalSnapshotPayload) => Promise<void> | void;
}

interface RecoveryCoordinatorDeps {
  wsClient: Pick<
    {
      getStatus: () => ConnectionStatus;
      probeConnection: (trigger: ProbeTrigger) => Promise<{ ok: true }>;
      onStatus: (listener: (status: ConnectionStatus) => void) => () => void;
      subscribe: (
        topics: string[],
        handler: (topic: string, payload: unknown, seq: number) => void
      ) => () => void;
    },
    "getStatus" | "probeConnection" | "onStatus" | "subscribe"
  >;
  sendCommand: DispatchCommand;
  applyReplay: (terminalId: string, payload: TerminalReplayPayload) => Promise<void> | void;
  applySnapshot: (terminalId: string, payload: TerminalSnapshotPayload) => Promise<void> | void;
  subscribeToContinuityLost?: boolean;
  subscribeToStatus?: boolean;
}

type RawRecoverySendCommand = <T = unknown>(
  op: string,
  args: unknown,
  options?: { timeoutMs?: number }
) => Promise<T>;

interface ScheduledRecovery {
  reason: RecoveryReason;
  skipProbe: boolean;
}

interface TerminalRecoveryState {
  idleResolvers: Array<() => void>;
  queued: ScheduledRecovery | null;
  running: Promise<void> | null;
}

export interface RecoveryCoordinator {
  registerTerminal(entry: RegisteredTerminal): () => void;
  notifyReason(reason: RecoveryReason, terminalId?: string): Promise<void>;
  handleConnectionStatus(status: ConnectionStatus): void;
  dispose(): void;
}

export function createRecoveryDispatchCommand(
  sendCommand: RawRecoverySendCommand
): DispatchCommand {
  return async <T = unknown>(op: string, args: unknown, options) => {
    try {
      const data = await sendCommand<T>(op, args, options);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "command_error",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  };
}

function toProbeTrigger(reason: RecoveryReason): ProbeTrigger | null {
  if (reason === "foreground_resume") {
    return "foreground_resume";
  }

  if (reason === "network_online") {
    return "network_online";
  }

  return null;
}

export function createRecoveryCoordinator(deps: RecoveryCoordinatorDeps): RecoveryCoordinator {
  const terminals = new Map<string, RegisteredTerminal>();
  const terminalStates = new Map<string, TerminalRecoveryState>();
  let pendingSocketReconcile = false;
  let disposed = false;

  const getTerminalState = (terminalId: string): TerminalRecoveryState => {
    const existing = terminalStates.get(terminalId);
    if (existing) {
      return existing;
    }

    const created: TerminalRecoveryState = {
      idleResolvers: [],
      queued: null,
      running: null,
    };
    terminalStates.set(terminalId, created);
    return created;
  };

  const getRecoveryPriority = (reason: RecoveryReason) => {
    switch (reason) {
      case "initial_mount":
        return 1;
      case "foreground_resume":
      case "network_online":
        return 2;
      case "socket_reconnected":
        return 3;
      case "continuity_lost":
      case "seq_gap":
        return 4;
      default:
        return 0;
    }
  };

  const mergeScheduledRecovery = (
    current: ScheduledRecovery | null,
    next: ScheduledRecovery
  ): ScheduledRecovery => {
    if (!current) {
      return next;
    }

    const currentPriority = getRecoveryPriority(current.reason);
    const nextPriority = getRecoveryPriority(next.reason);
    if (nextPriority > currentPriority) {
      return next;
    }

    if (nextPriority === currentPriority) {
      return next;
    }

    return current;
  };

  const isReconnectPending = () => {
    const status = deps.wsClient.getStatus();
    return status === "connecting" || status === "disconnected" || status === "reconnecting";
  };

  const shouldRetryAfterReconnect = (error?: unknown) => {
    if (isReconnectPending()) {
      return true;
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: string }).message)
          : "";

    return (
      message.includes("WebSocket disconnected") ||
      message.includes("WebSocket not connected") ||
      message.includes("Connection probe timeout") ||
      message.includes("Command timeout: connection.probe")
    );
  };

  const scheduleReconnectRecovery = (terminalId: string) => {
    pendingSocketReconcile = true;
    if (isReconnectPending()) {
      return;
    }

    queueRecovery(terminalId, { reason: "socket_reconnected", skipProbe: true });
  };

  const surfaceRecoveryCheckFailure = (
    terminal: RegisteredTerminal,
    operation: RecoveryOperation,
    errorCode?: string
  ) => {
    terminal.setUiMode("error", {
      reason: "reconcile_failed",
      operation,
      errorCode,
    } satisfies RecoveryUiModeDetail);
  };

  const resolveIdleWaiters = (state: TerminalRecoveryState) => {
    const resolvers = state.idleResolvers;
    state.idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };

  const queueRecovery = (terminalId: string, recovery: ScheduledRecovery) => {
    if (disposed) {
      return Promise.resolve();
    }

    const state = getTerminalState(terminalId);
    state.queued = mergeScheduledRecovery(state.queued, recovery);

    if (state.running) {
      return new Promise<void>((resolve) => {
        state.idleResolvers.push(resolve);
      });
    }

    state.running = (async () => {
      try {
        while (true) {
          const next = state.queued;
          state.queued = null;
          if (!next) {
            return;
          }

          await runRecovery(terminalId, next);
        }
      } finally {
        state.running = null;

        if (state.queued) {
          void queueRecovery(terminalId, state.queued);
          return;
        }

        resolveIdleWaiters(state);
      }
    })();

    return new Promise<void>((resolve) => {
      state.idleResolvers.push(resolve);
    });
  };

  const requestSnapshot = async (
    terminalId: string,
    terminal: RegisteredTerminal,
    closed?: RecoveryClosedTerminalState,
    options?: { controlPlaneFailureMeansRecoveryFailure?: boolean }
  ) => {
    if (disposed) {
      return;
    }

    terminal.setUiMode("blocking_rebuild");
    const snapshotResult = await deps.sendCommand<TerminalSnapshotPayload>(
      "terminal.snapshot",
      { terminalId },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    );

    if (disposed) {
      return;
    }

    if (!snapshotResult.ok || !snapshotResult.data || snapshotResult.data.status !== "ok") {
      if (!snapshotResult.ok && shouldRetryAfterReconnect(snapshotResult.error)) {
        scheduleReconnectRecovery(terminalId);
        return;
      }

      if (!snapshotResult.ok && isRecoveryControlPlaneError(snapshotResult.error)) {
        if (options?.controlPlaneFailureMeansRecoveryFailure) {
          terminal.setUiMode("error");
          return;
        }

        surfaceRecoveryCheckFailure(terminal, "terminal.snapshot", snapshotResult.error?.code);
        return;
      }

      if (!snapshotResult.data) {
        if (options?.controlPlaneFailureMeansRecoveryFailure) {
          terminal.setUiMode("error");
          return;
        }

        surfaceRecoveryCheckFailure(terminal, "terminal.snapshot");
        return;
      }

      terminal.setUiMode("error");
      return;
    }

    if (terminal.applySnapshot) {
      await terminal.applySnapshot(snapshotResult.data);
    } else {
      await deps.applySnapshot(terminalId, snapshotResult.data);
    }
    await applyClosedState(terminal, closed);
    terminal.setUiMode(closed ? "closed" : "silent");
  };

  const applyClosedState = async (
    terminal: RegisteredTerminal,
    closed?: RecoveryClosedTerminalState
  ) => {
    if (!closed) {
      return;
    }

    await terminal.markClosed?.(closed);
  };

  const applyDecision = async (decision: RecoveryReconcileDecision) => {
    if (disposed) {
      return;
    }

    const terminal = terminals.get(decision.terminalId);
    if (!terminal) {
      return;
    }

    if (decision.action === "noop") {
      if (terminal.completeRecovery) {
        await terminal.completeRecovery(decision.headSeq);
      }
      terminal.setUiMode("silent");
      return;
    }

    if (decision.action === "closed") {
      if (terminal.completeRecovery) {
        await terminal.completeRecovery(decision.headSeq, { exitCode: decision.exitCode });
      } else {
        await applyClosedState(terminal, { exitCode: decision.exitCode });
      }
      terminal.setUiMode("closed");
      return;
    }

    if (decision.action === "unrecoverable") {
      terminal.setUiMode("error", { reason: decision.reason });
      return;
    }

    if (decision.action === "replay") {
      terminal.setUiMode("non_blocking_recovering");
      const replayResult = await deps.sendCommand<TerminalReplayPayload>(
        "terminal.replay",
        { terminalId: decision.terminalId, lastSeq: decision.fromSeq },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );

      if (!replayResult.ok) {
        if (shouldRetryAfterReconnect(replayResult.error)) {
          scheduleReconnectRecovery(decision.terminalId);
          return;
        }

        if (isRecoveryControlPlaneError(replayResult.error)) {
          surfaceRecoveryCheckFailure(terminal, "terminal.replay", replayResult.error?.code);
          return;
        }

        await requestSnapshot(decision.terminalId, terminal, decision.closed, {
          controlPlaneFailureMeansRecoveryFailure: true,
        });
        return;
      }

      if (!replayResult.data) {
        surfaceRecoveryCheckFailure(terminal, "terminal.replay");
        return;
      }

      if (replayResult.data.status === "too_old") {
        await requestSnapshot(decision.terminalId, terminal, decision.closed);
        return;
      }

      if (replayResult.data.status === "unknown") {
        terminal.setUiMode("error", { reason: "unknown_terminal" });
        return;
      }

      if (replayResult.data.status !== "ok") {
        surfaceRecoveryCheckFailure(terminal, "terminal.replay");
        return;
      }

      if (terminal.applyReplay) {
        await terminal.applyReplay(replayResult.data);
      } else {
        await deps.applyReplay(decision.terminalId, replayResult.data);
      }
      await applyClosedState(terminal, decision.closed);
      terminal.setUiMode(decision.closed ? "closed" : "silent");
      return;
    }

    await requestSnapshot(decision.terminalId, terminal, decision.closed);
  };

  const reconcile = async (reason: RecoveryReason, targetTerminalId?: string) => {
    if (disposed) {
      return;
    }

    const entries = Array.from(terminals.values()).filter((entry) =>
      targetTerminalId ? entry.terminalId === targetTerminalId : true
    );
    if (targetTerminalId && entries.length === 0) {
      return;
    }

    const result = await deps.sendCommand<RecoveryReconcileResult>("recovery.reconcile", {
      reason,
      terminals: entries.map((entry) => ({
        terminalId: entry.terminalId,
        renderedSeq: entry.getRenderedSeq(),
      })),
    });

    if (disposed) {
      return;
    }

    if (!result.ok || !result.data || !Array.isArray(result.data.terminals)) {
      if (shouldRetryAfterReconnect(result.ok ? undefined : result.error)) {
        pendingSocketReconcile = true;
        if (targetTerminalId) {
          scheduleReconnectRecovery(targetTerminalId);
        }
        return;
      }

      for (const entry of entries) {
        surfaceRecoveryCheckFailure(
          entry,
          "recovery.reconcile",
          result.ok ? undefined : result.error?.code
        );
      }
      return;
    }

    for (const decision of result.data.terminals) {
      await applyDecision(decision);
    }
  };

  const maybeProbe = async (reason: RecoveryReason) => {
    if (disposed) {
      return false;
    }

    const trigger = toProbeTrigger(reason);
    if (!trigger) {
      return true;
    }

    if (deps.wsClient.getStatus() !== "connected") {
      return false;
    }

    try {
      await deps.wsClient.probeConnection(trigger);
      return true;
    } catch (error) {
      if (shouldRetryAfterReconnect(error)) {
        pendingSocketReconcile = true;
        return false;
      }
      throw error;
    }
  };

  const runRecovery = async (terminalId: string, scheduled: ScheduledRecovery) => {
    if (disposed) {
      return;
    }

    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }

    try {
      if (!scheduled.skipProbe) {
        const shouldProceed = await maybeProbe(scheduled.reason);
        if (!shouldProceed) {
          pendingSocketReconcile = true;
          return;
        }
      }

      await reconcile(scheduled.reason, terminalId);
    } catch (error) {
      if (shouldRetryAfterReconnect(error)) {
        scheduleReconnectRecovery(terminalId);
        return;
      }

      surfaceRecoveryCheckFailure(terminal, "recovery.reconcile");
    }
  };

  const handleConnectionStatus = (status: ConnectionStatus) => {
    if (disposed) {
      return;
    }

    if (status === "disconnected" || status === "reconnecting") {
      pendingSocketReconcile = true;
      return;
    }

    if (status === "connected" && pendingSocketReconcile) {
      pendingSocketReconcile = false;
      for (const terminalId of terminals.keys()) {
        queueRecovery(terminalId, {
          reason: "socket_reconnected",
          skipProbe: true,
        });
      }
    }
  };

  const unsubscribeStatus =
    deps.subscribeToStatus === false ? () => {} : deps.wsClient.onStatus(handleConnectionStatus);

  const unsubscribeContinuity =
    deps.subscribeToContinuityLost === false
      ? () => {}
      : deps.wsClient.subscribe(["workspace.*"], (topic, payload) => {
          if (disposed) {
            return;
          }

          const match = topic.match(/^workspace\.([^.]+)\.terminal\.([^.]+)\.continuity_lost$/);
          if (!match) {
            return;
          }

          const data = payload as TerminalContinuityLostEvent;
          void queueRecovery(data.terminalId, { reason: "continuity_lost", skipProbe: true });
        });

  return {
    registerTerminal(entry: RegisteredTerminal) {
      if (disposed) {
        return () => {};
      }

      terminals.set(entry.terminalId, entry);
      return () => {
        terminals.delete(entry.terminalId);
        terminalStates.delete(entry.terminalId);
      };
    },
    async notifyReason(reason: RecoveryReason, terminalId?: string) {
      if (disposed) {
        return;
      }

      if (terminalId) {
        await queueRecovery(terminalId, { reason, skipProbe: false });
        return;
      }

      const shouldProceed = await maybeProbe(reason);
      if (!shouldProceed) {
        pendingSocketReconcile = true;
        return;
      }

      if (terminals.size === 0) {
        await reconcile(reason);
        return;
      }

      await Promise.all(
        Array.from(terminals.keys(), (registeredTerminalId) =>
          queueRecovery(registeredTerminalId, {
            reason,
            skipProbe: true,
          })
        )
      );
    },
    handleConnectionStatus,
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      unsubscribeStatus();
      unsubscribeContinuity();
      pendingSocketReconcile = false;
      terminals.clear();
      for (const state of terminalStates.values()) {
        state.queued = null;
        resolveIdleWaiters(state);
      }
      terminalStates.clear();
    },
  };
}
