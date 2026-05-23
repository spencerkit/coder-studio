# Terminal Recovery Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented websocket and terminal replay heuristics with one recovery flow so foreground return only validates silently, and replay or snapshot happens only when continuity evidence exists.

**Architecture:** Introduce a single policy layer across `packages/web` and `packages/server`: the frontend `RecoveryCoordinator` collects transport and continuity signals, calls a new `recovery.reconcile` command, and executes the returned per-terminal action. `WsClient` remains transport-only, `XtermHost` becomes a render/runtime host that reports evidence and applies bytes, and the server becomes the single authority for deciding `noop | replay | snapshot | closed | unrecoverable`.

**Tech Stack:** TypeScript, Zod, Vitest, Jotai, xterm.js, existing websocket command/event protocol

---

## File Map

**Create:**
- `packages/server/src/commands/recovery.ts`
  Register `recovery.reconcile` and keep recovery decision logic out of websocket transport code.
- `packages/web/src/features/terminal-panel/recovery-coordinator.ts`
  Own frontend recovery state machine, mounted terminal registry, reconcile batching, UI mode, and replay/snapshot execution.
- `packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts`
  Cover coordinator decisions, probe vs reconnect behavior, and replay/snapshot execution ordering.

**Modify:**
- `packages/core/src/protocol/messages.ts`
  Add typed request/response exports for `recovery.reconcile` and `terminal.continuity_lost`.
- `packages/core/src/protocol/topics.ts`
  Add `Topics.terminalContinuityLost(workspaceId, terminalId)`.
- `packages/core/src/domain/events.ts`
  Add `terminal.continuity_lost` domain event type for server-side fan-out.
- `packages/core/src/index.ts`
  Export the new protocol types.
- `packages/server/src/commands/index.ts`
  Register `./recovery.js`.
- `packages/server/src/commands/connection.ts`
  Keep `connection.probe` transport-only; no recovery semantics.
- `packages/server/src/commands/terminal.ts`
  Keep `terminal.replay` and `terminal.snapshot` as data-plane only.
- `packages/server/src/terminal/types.ts`
  Add replayability/head-seq helpers used by reconciliation.
- `packages/server/src/terminal/manager.ts`
  Expose terminal recovery inspection helpers: current head seq, replayability, snapshot support, alive/exit state.
- `packages/server/src/ws/client.ts`
  Surface stream-buffer drop/eviction callbacks with client/topic context.
- `packages/server/src/ws/hub.ts`
  Emit client-scoped `terminal.continuity_lost` control events when terminal stream continuity is lost and route the new domain event topic.
- `packages/web/src/ws/client.ts`
  Remove `onRecovery` terminal semantics, keep explicit `probeConnection()` and raw status updates, preserve reconnect/resubscribe/resync.
- `packages/web/src/ws/index.ts`
  Export any new `WsClient` probe types.
- `packages/web/src/app/providers.tsx`
  Replace direct `recoverConnection("visibility_resume" | "network_online")` terminal semantics with coordinator notifications.
- `packages/web/src/atoms/connection.ts`
  Export any new transport probe types if needed by the coordinator wiring.
- `packages/web/src/features/terminal-panel/index.tsx`
  Export the coordinator entry points if the feature surface needs them.
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  Remove direct replay policy ownership; register terminal with coordinator, report `seq_gap`, and render coordinator-owned UI mode.
- `packages/web/src/features/terminal-panel/replay-state.ts`
  Expand replay/snapshot UI classification so only snapshot rebuild is blocking.

**Test:**
- `packages/core/src/protocol/messages.test.ts`
- `packages/server/src/__tests__/terminal-commands.test.ts`
- `packages/server/src/__tests__/ws-hub.test.ts`
- `packages/server/src/__tests__/ws-client.test.ts`
- `packages/server/src/__tests__/stream-buffer.test.ts`
- `packages/server/src/terminal/manager.test.ts`
- `packages/web/src/ws/__tests__/client.test.ts`
- `packages/web/src/app/providers.lifecycle.test.tsx`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts`

## Design Notes

- The new rule is not “only replay after websocket disconnect”. Stream drops can still lose terminal continuity while the websocket stays connected, so `terminal.continuity_lost` must enter the same reconcile path.
- `foreground_resume`, `network_online`, and `manual_retry` are suspicion-only reasons. They may trigger silent probe plus reconcile, but they must not directly trigger `terminal.replay`.
- `recovery.reconcile` is the single authority for choosing `noop`, `replay`, `snapshot`, `closed`, or `unrecoverable`.
- `terminal.replay` and `terminal.snapshot` remain binary data-plane commands. Their behavior stays stable; only their callers change.
- `XtermHost` still owns xterm creation, live byte rendering, mobile input, and resize behavior. It stops deciding when replay or snapshot is appropriate.
- Replay UI severity is explicit:
  - `checking`: silent
  - `non_blocking_recovering`: terminal visible, non-blocking
  - `blocking_rebuild`: only for snapshot/full reset
  - `error`: degraded state
- The approved UX target is specific: switching away from the browser and back while the socket remains live and no bytes were lost must produce no blocking recovery overlay and usually no replay at all.

## Task 1: Add Shared Recovery Protocol Types

**Files:**
- Modify: `packages/core/src/protocol/messages.ts`
- Modify: `packages/core/src/protocol/topics.ts`
- Modify: `packages/core/src/domain/events.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/protocol/messages.test.ts`

- [ ] **Step 1: Write the failing protocol tests**

Add these cases to `packages/core/src/protocol/messages.test.ts`:

```ts
import { Topics } from "./topics";
import {
  type RecoveryReconcileDecision,
  type RecoveryReconcileRequest,
  type TerminalContinuityLostEvent,
} from "./messages";

describe("terminal recovery protocol types", () => {
  it("exports a terminal continuity topic builder", () => {
    expect(Topics.terminalContinuityLost("ws-1", "term-1")).toBe(
      "workspace.ws-1.terminal.term-1.continuity_lost"
    );
  });

  it("accepts a recovery reconcile request shape", () => {
    const request: RecoveryReconcileRequest = {
      reason: "foreground_resume",
      terminals: [
        {
          terminalId: "term-1",
          renderedSeq: 128,
        },
      ],
    };

    expect(request.terminals[0]?.renderedSeq).toBe(128);
  });

  it("supports the full reconcile decision union", () => {
    const decisions: RecoveryReconcileDecision[] = [
      { terminalId: "term-noop", action: "noop", headSeq: 10 },
      { terminalId: "term-replay", action: "replay", fromSeq: 4, headSeq: 10 },
      { terminalId: "term-snapshot", action: "snapshot", headSeq: 10 },
      { terminalId: "term-closed", action: "closed", headSeq: 10, exitCode: 0 },
      {
        terminalId: "term-bad",
        action: "unrecoverable",
        reason: "too_old_no_snapshot",
      },
    ];

    expect(decisions.map((entry) => entry.action)).toEqual([
      "noop",
      "replay",
      "snapshot",
      "closed",
      "unrecoverable",
    ]);
  });

  it("models terminal continuity lost control events", () => {
    const event: TerminalContinuityLostEvent = {
      workspaceId: "ws-1",
      terminalId: "term-1",
      reason: "stream_drop",
    };

    expect(event.reason).toBe("stream_drop");
  });
});
```

- [ ] **Step 2: Run the core protocol tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/protocol/messages.test.ts
```

Expected:
- FAIL because `RecoveryReconcileRequest`, `RecoveryReconcileDecision`, and `TerminalContinuityLostEvent` do not exist yet
- FAIL because `Topics.terminalContinuityLost()` does not exist yet

- [ ] **Step 3: Add the protocol types and topic builder**

Update `packages/core/src/protocol/messages.ts` with concrete exports:

```ts
export const RECOVERY_REASONS = [
  "initial_mount",
  "foreground_resume",
  "network_online",
  "socket_reconnected",
  "seq_gap",
  "continuity_lost",
] as const;

export type RecoveryReason = (typeof RECOVERY_REASONS)[number];

export interface RecoveryReconcileTerminalRequest {
  terminalId: string;
  renderedSeq: number;
}

export interface RecoveryReconcileRequest {
  reason: RecoveryReason;
  terminals: RecoveryReconcileTerminalRequest[];
}

export type RecoveryReconcileDecision =
  | { terminalId: string; action: "noop"; headSeq: number }
  | { terminalId: string; action: "replay"; fromSeq: number; headSeq: number }
  | { terminalId: string; action: "snapshot"; headSeq: number }
  | { terminalId: string; action: "closed"; headSeq: number; exitCode?: number }
  | {
      terminalId: string;
      action: "unrecoverable";
      reason: "too_old_no_snapshot" | "unknown_terminal";
    };

export interface RecoveryReconcileResult {
  terminals: RecoveryReconcileDecision[];
}

export interface TerminalContinuityLostEvent {
  workspaceId: string;
  terminalId: string;
  reason: "stream_drop" | "topic_evicted";
}
```

Update `packages/core/src/protocol/topics.ts`:

```ts
terminalContinuityLost: (workspaceId: string, terminalId: string) =>
  `workspace.${workspaceId}.terminal.${terminalId}.continuity_lost`,
```

Update `packages/core/src/domain/events.ts`:

```ts
  | {
      type: "terminal.continuity_lost";
      workspaceId: string;
      terminalId: string;
      clientId: string;
      reason: "stream_drop" | "topic_evicted";
    }
```

Update `packages/core/src/index.ts` only if new exports are not already covered via `protocol/messages` and `protocol/topics`.

- [ ] **Step 4: Run the core protocol tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/protocol/messages.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the protocol layer**

```bash
git add packages/core/src/protocol/messages.ts packages/core/src/protocol/topics.ts packages/core/src/domain/events.ts packages/core/src/index.ts packages/core/src/protocol/messages.test.ts
git commit -m "Add shared terminal recovery protocol types"
```

## Task 2: Add Server-Side Recovery Reconciliation

**Files:**
- Create: `packages/server/src/commands/recovery.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/terminal/types.ts`
- Modify: `packages/server/src/terminal/manager.ts`
- Test: `packages/server/src/terminal/manager.test.ts`
- Test: `packages/server/src/__tests__/terminal-commands.test.ts`

- [ ] **Step 1: Write the failing terminal recovery decision tests**

Add these tests to `packages/server/src/terminal/manager.test.ts`:

```ts
describe("terminal recovery inspection", () => {
  it("reports head seq and replay availability for a live terminal", () => {
    const terminal = manager.create({
      workspaceId: "ws-1",
      kind: "shell",
      argv: ["/bin/bash"],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      title: "bash",
    });

    ptyCallbacks.onData?.("hello");

    expect(manager.inspectRecovery(terminal.id, 0)).toMatchObject({
      status: "ok",
      headSeq: 5,
      replay: { kind: "available", fromSeq: 0 },
      snapshot: { kind: "available" },
      alive: true,
    });
  });

  it("reports replay too old when rendered seq falls behind the ring buffer window", () => {
    const smallManager = createManager({ ringBufferSize: 4 });
    const terminal = smallManager.create({
      workspaceId: "ws-1",
      kind: "shell",
      argv: ["/bin/bash"],
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      title: "bash",
    });

    smallPtyCallbacks.onData?.("abcdef");

    expect(smallManager.inspectRecovery(terminal.id, 0)).toMatchObject({
      status: "ok",
      replay: { kind: "too_old" },
    });
  });
});
```

Add these command tests to `packages/server/src/__tests__/terminal-commands.test.ts`:

```ts
import "../commands/recovery.js";

it("returns noop when rendered seq already matches terminal head seq", async () => {
  const ctx = createContext({
    terminalMgr: {
      ...createContext().terminalMgr,
      inspectRecovery: vi.fn().mockReturnValue({
        status: "ok",
        headSeq: 42,
        replay: { kind: "available", fromSeq: 42 },
        snapshot: { kind: "available" },
        alive: true,
      }),
      get: vi.fn().mockReturnValue({ exitCode: undefined }),
    } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "recovery-reconcile-noop",
      op: "recovery.reconcile",
      args: {
        reason: "foreground_resume",
        terminals: [{ terminalId: "term-1", renderedSeq: 42 }],
      },
    },
    ctx,
    "client-1"
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual({
    terminals: [{ terminalId: "term-1", action: "noop", headSeq: 42 }],
  });
});

it("prefers snapshot on initial mount when snapshot is available", async () => {
  const ctx = createContext({
    terminalMgr: {
      ...createContext().terminalMgr,
      inspectRecovery: vi.fn().mockReturnValue({
        status: "ok",
        headSeq: 42,
        replay: { kind: "available", fromSeq: 0 },
        snapshot: { kind: "available" },
        alive: true,
      }),
      get: vi.fn().mockReturnValue({ exitCode: undefined }),
    } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "recovery-reconcile-snapshot",
      op: "recovery.reconcile",
      args: {
        reason: "initial_mount",
        terminals: [{ terminalId: "term-1", renderedSeq: 0 }],
      },
    },
    ctx,
    "client-1"
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual({
    terminals: [{ terminalId: "term-1", action: "snapshot", headSeq: 42 }],
  });
});

it("falls back to unrecoverable when replay is too old and no snapshot is available", async () => {
  const ctx = createContext({
    terminalMgr: {
      ...createContext().terminalMgr,
      inspectRecovery: vi.fn().mockReturnValue({
        status: "ok",
        headSeq: 42,
        replay: { kind: "too_old" },
        snapshot: { kind: "unavailable" },
        alive: true,
      }),
      get: vi.fn().mockReturnValue({ exitCode: undefined }),
    } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "recovery-reconcile-bad",
      op: "recovery.reconcile",
      args: {
        reason: "seq_gap",
        terminals: [{ terminalId: "term-1", renderedSeq: 0 }],
      },
    },
    ctx,
    "client-1"
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual({
    terminals: [
      {
        terminalId: "term-1",
        action: "unrecoverable",
        reason: "too_old_no_snapshot",
      },
    ],
  });
});
```

- [ ] **Step 2: Run the server recovery tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/terminal/manager.test.ts src/__tests__/terminal-commands.test.ts
```

Expected:
- FAIL because `inspectRecovery()` does not exist
- FAIL because `recovery.reconcile` is not registered

- [ ] **Step 3: Add terminal inspection helpers and the new reconcile command**

Extend `packages/server/src/terminal/types.ts`:

```ts
export type TerminalReplayAvailability =
  | { kind: "available"; fromSeq: number }
  | { kind: "too_old" };

export type TerminalSnapshotAvailability =
  | { kind: "available" }
  | { kind: "unavailable" };

export type TerminalRecoveryInspection =
  | {
      status: "ok";
      headSeq: number;
      replay: TerminalReplayAvailability;
      snapshot: TerminalSnapshotAvailability;
      alive: boolean;
      exitCode?: number;
    }
  | { status: "unknown" };
```

Add `inspectRecovery()` to `packages/server/src/terminal/manager.ts`:

```ts
inspectRecovery(terminalId: TerminalId, renderedSeq: number): TerminalRecoveryInspection {
  const terminal = this.terminals.get(terminalId);
  if (!terminal) {
    return { status: "unknown" };
  }

  const headSeq = terminal.ringBuffer.getSeq();
  const replay = terminal.ringBuffer.replayFrom(renderedSeq);

  return {
    status: "ok",
    headSeq,
    replay:
      replay.status === "too_old"
        ? { kind: "too_old" }
        : { kind: "available", fromSeq: renderedSeq },
    snapshot:
      terminal.snapshotBuffer && !terminal.snapshotBuffer.disabled
        ? { kind: "available" }
        : { kind: "unavailable" },
    alive: terminal.alive,
    exitCode: terminal.exitCode,
  };
}
```

Create `packages/server/src/commands/recovery.ts`:

```ts
import { type RecoveryReconcileDecision, RECOVERY_REASONS } from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const RecoveryReasonSchema = z.enum(RECOVERY_REASONS);

registerCommand(
  "recovery.reconcile",
  z.object({
    reason: RecoveryReasonSchema,
    terminals: z.array(
      z.object({
        terminalId: z.string(),
        renderedSeq: z.number().int().nonnegative(),
      })
    ),
  }),
  async (args, ctx) => {
    const terminals: RecoveryReconcileDecision[] = args.terminals.map((entry) => {
      const inspection = ctx.terminalMgr.inspectRecovery(entry.terminalId, entry.renderedSeq);

      if (inspection.status === "unknown") {
        return {
          terminalId: entry.terminalId,
          action: "unrecoverable",
          reason: "unknown_terminal",
        };
      }

      if (entry.renderedSeq === inspection.headSeq) {
        return {
          terminalId: entry.terminalId,
          action: "noop",
          headSeq: inspection.headSeq,
        };
      }

      if (!inspection.alive && entry.renderedSeq >= inspection.headSeq) {
        return {
          terminalId: entry.terminalId,
          action: "closed",
          headSeq: inspection.headSeq,
          exitCode: inspection.exitCode,
        };
      }

      if (args.reason === "initial_mount" && inspection.snapshot.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "snapshot",
          headSeq: inspection.headSeq,
        };
      }

      if (inspection.replay.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "replay",
          fromSeq: entry.renderedSeq,
          headSeq: inspection.headSeq,
        };
      }

      if (inspection.snapshot.kind === "available") {
        return {
          terminalId: entry.terminalId,
          action: "snapshot",
          headSeq: inspection.headSeq,
        };
      }

      if (!inspection.alive) {
        return {
          terminalId: entry.terminalId,
          action: "closed",
          headSeq: inspection.headSeq,
          exitCode: inspection.exitCode,
        };
      }

      return {
        terminalId: entry.terminalId,
        action: "unrecoverable",
        reason: "too_old_no_snapshot",
      };
    });

    return { terminals };
  }
);
```

Register the file in `packages/server/src/commands/index.ts`:

```ts
import "./recovery.js";
```

- [ ] **Step 4: Run the server recovery tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/terminal/manager.test.ts src/__tests__/terminal-commands.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the server recovery decision layer**

```bash
git add packages/server/src/commands/recovery.ts packages/server/src/commands/index.ts packages/server/src/terminal/types.ts packages/server/src/terminal/manager.ts packages/server/src/terminal/manager.test.ts packages/server/src/__tests__/terminal-commands.test.ts
git commit -m "Add server-side terminal recovery reconciliation"
```

## Task 3: Emit Explicit Continuity Loss Control Events

**Files:**
- Modify: `packages/server/src/ws/client.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Test: `packages/server/src/__tests__/ws-client.test.ts`
- Test: `packages/server/src/__tests__/stream-buffer.test.ts`
- Test: `packages/server/src/__tests__/ws-hub.test.ts`

- [ ] **Step 1: Write the failing continuity loss tests**

Add this test to `packages/server/src/__tests__/ws-client.test.ts`:

```ts
it("invokes a continuity callback when a terminal stream frame is dropped", () => {
  const onContinuityLost = vi.fn();
  client = new WsClient(mockSocket, "test-client-id", logger, {
    onTerminalContinuityLost: onContinuityLost,
  });

  mockSocket.bufferedAmount = 1024 * 1024;
  client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.from("aaaa"));
  client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.from("bbbb"));
  client.sendStream("workspace.ws-1.terminal.term-1.output", Buffer.alloc(600 * 1024));

  expect(onContinuityLost).toHaveBeenCalledWith({
    clientId: "test-client-id",
    topic: "workspace.ws-1.terminal.term-1.output",
    reason: "stream_drop",
  });
});
```

Add this test to `packages/server/src/__tests__/ws-hub.test.ts`:

```ts
it("sends terminal continuity lost over the control path to the affected client", () => {
  const socket = createMockSocket();
  hub.handleConnection(socket as never, createMockRequest());
  subscribeToAllTopics(socket);

  const connected = parseSentEvents(socket)[0];
  const clientId = (connected as Extract<ServerToClient, { kind: "event" }>).data.clientId as string;

  eventBus.emit({
    type: "terminal.continuity_lost",
    workspaceId: "ws-1",
    terminalId: "term-1",
    clientId,
    reason: "stream_drop",
  });

  expect(parseSentEvents(socket)).toContainEqual(
    expect.objectContaining({
      kind: "event",
      topic: Topics.terminalContinuityLost("ws-1", "term-1"),
      data: {
        workspaceId: "ws-1",
        terminalId: "term-1",
        reason: "stream_drop",
      },
    })
  );
});
```

- [ ] **Step 2: Run the websocket server tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/ws-client.test.ts src/__tests__/ws-hub.test.ts src/__tests__/stream-buffer.test.ts
```

Expected:
- FAIL because `WsClient` has no continuity-loss callback
- FAIL because `WsHub` does not emit or route `terminal.continuity_lost`

- [ ] **Step 3: Wire stream-buffer drops into a client-scoped control event**

Update `packages/server/src/ws/client.ts` constructor shape:

```ts
interface WsClientHooks {
  onTerminalContinuityLost?: (event: {
    clientId: string;
    topic: string;
    reason: "stream_drop" | "topic_evicted";
  }) => void;
}
```

Call the hook from stream buffer pressure handlers:

```ts
private emitContinuityLost(topic: string, reason: "stream_drop" | "topic_evicted"): void {
  if (!topic.includes(".terminal.") || !topic.endsWith(".output")) {
    return;
  }

  this.hooks.onTerminalContinuityLost?.({
    clientId: this.id,
    topic,
    reason,
  });
}

private handleStreamBufferDrop(event: StreamBufferDropOldestEvent): void {
  this.droppedFramesSinceLastWarn += 1;
  this.droppedBytesSinceLastWarn += event.frameSize;
  this.emitContinuityLost(event.topic, "stream_drop");
  this.warnStreamBufferPressure("topic-cap", event.topic);
}

private handleStreamBufferEviction(event: StreamBufferEvictTopicEvent): void {
  this.evictedTopicsSinceLastWarn += 1;
  this.evictedFramesSinceLastWarn += event.frames;
  this.evictedBytesSinceLastWarn += event.bytes;
  this.emitContinuityLost(event.topic, "topic_evicted");
  this.warnStreamBufferPressure("topic-lru", event.topic);
}
```

Update `packages/server/src/ws/hub.ts` to pass a callback when constructing `WsClient`:

```ts
const client = new WsClient(socket, uuidv4(), this.deps.logger, {
  onTerminalContinuityLost: ({ clientId, topic, reason }) => {
    const match = topic.match(/^workspace\.([^.]+)\.terminal\.([^.]+)\.output$/);
    if (!match) {
      return;
    }

    this.deps.eventBus.emit({
      type: "terminal.continuity_lost",
      workspaceId: match[1]!,
      terminalId: match[2]!,
      clientId,
      reason,
    });
  },
});
```

Route the new domain event in `handleDomainEvent()`:

```ts
      case "terminal.continuity_lost":
        topic = Topics.terminalContinuityLost(event.workspaceId, event.terminalId);
        data = {
          workspaceId: event.workspaceId,
          terminalId: event.terminalId,
          reason: event.reason,
        };
        this.sendToClient(event.clientId, {
          kind: "event",
          topic,
          seq: 0,
          timestamp: Date.now(),
          data,
        });
        return;
```

Add `"terminal.continuity_lost"` to the `eventTypes` subscription list in `subscribeToEvents()`.

- [ ] **Step 4: Run the websocket server tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/ws-client.test.ts src/__tests__/ws-hub.test.ts src/__tests__/stream-buffer.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the continuity loss event plumbing**

```bash
git add packages/server/src/ws/client.ts packages/server/src/ws/hub.ts packages/server/src/__tests__/ws-client.test.ts packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/stream-buffer.test.ts
git commit -m "Emit explicit terminal continuity loss events"
```

## Task 4: Make Web `WsClient` Transport-Only

**Files:**
- Modify: `packages/web/src/ws/client.ts`
- Modify: `packages/web/src/ws/index.ts`
- Test: `packages/web/src/ws/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing web websocket client tests**

Add these tests to `packages/web/src/ws/__tests__/client.test.ts`:

```ts
it("does not emit terminal recovery callbacks on successful probe of a connected socket", async () => {
  const client = new WsClient("ws://127.0.0.1:4173/ws");
  const connectPromise = client.connect();
  const socket = MockWebSocket.instances[0]!;
  socket.triggerOpen();
  await connectPromise;

  const statusListener = vi.fn();
  client.onStatus(statusListener);

  const probePromise = client.probeConnection("foreground_resume");
  const command = socket.sent
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => JSON.parse(entry))
    .find((entry) => entry.kind === "command" && entry.op === "connection.probe");

  socket.triggerMessage({
    kind: "result",
    id: command.id,
    ok: true,
    data: { ok: true },
  });

  await expect(probePromise).resolves.toEqual({ ok: true });
  expect(statusListener).not.toHaveBeenCalledWith("reconnecting");
});

it("forces reconnect when probe times out", async () => {
  vi.useFakeTimers();

  const client = new WsClient("ws://127.0.0.1:4173/ws");
  const connectPromise = client.connect();
  const socket = MockWebSocket.instances[0]!;
  socket.triggerOpen();
  await connectPromise;

  const statuses: string[] = [];
  client.onStatus((status) => {
    statuses.push(status);
  });

  const probePromise = client.probeConnection("foreground_resume").catch((error) => error);
  await vi.advanceTimersByTimeAsync(2501);

  expect(statuses).toContain("reconnecting");
  await probePromise;
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run the web websocket client tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/ws/__tests__/client.test.ts
```

Expected:
- FAIL because `probeConnection()` does not exist
- FAIL because the current client still routes successful probe results through `onRecovery`

- [ ] **Step 3: Replace recovery callbacks with an explicit probe API**

Refactor `packages/web/src/ws/client.ts`:

```ts
export type ProbeTrigger = "foreground_resume" | "network_online" | "manual_retry";

export interface ProbeResult {
  ok: true;
}

private pendingProbe:
  | {
      id: string;
      resolve: (value: ProbeResult) => void;
      reject: (error: Error) => void;
      timeoutId: NodeJS.Timeout;
      trigger: ProbeTrigger;
    }
  | null = null;

async probeConnection(trigger: ProbeTrigger): Promise<ProbeResult> {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    this.forceReconnect(`probe_${trigger}_socket_unavailable`);
    throw new Error("WebSocket not connected");
  }

  if (this.pendingProbe) {
    return new Promise<ProbeResult>((resolve, reject) => {
      this.pendingProbe = {
        ...this.pendingProbe!,
        resolve,
        reject,
      };
    });
  }

  return new Promise<ProbeResult>((resolve, reject) => {
    const id = createCommandId();
    const timeoutId = setTimeout(() => {
      if (this.pendingProbe?.id !== id) {
        return;
      }
      this.forceReconnect("probe_timeout");
      reject(new Error("Connection probe timeout"));
    }, CONNECTION_PROBE_TIMEOUT_MS);

    this.pendingProbe = { id, resolve, reject, timeoutId, trigger };
    this.pendingCommands.set(id, {
      resolve: () => {
        this.clearPendingProbe();
        resolve({ ok: true });
      },
      reject: (error) => {
        if (this.pendingProbe?.id !== id) {
          return;
        }
        this.clearPendingProbe();
        this.forceReconnect("probe_rejected");
        reject(error);
      },
      timeoutId,
    });

    this.ws!.send(
      JSON.stringify({
        kind: "command",
        id,
        op: "connection.probe",
        args: {},
      } satisfies ClientToServer)
    );
  });
}
```

Remove:

```ts
export type RecoveryListener = ...
private recoveryListeners = ...
onRecovery(...)
notifyRecoveryListeners(...)
activeRecoveryTrigger ...
```

Keep `recoverConnection()` only as transport orchestration:

```ts
recoverConnection(trigger: ProbeTrigger = "manual_retry"): void {
  const status = this.getStatus();
  if (status === "rejected") {
    return;
  }

  if (status === "connected") {
    void this.probeConnection(trigger).catch(() => {});
    return;
  }

  if (status === "connecting") {
    return;
  }

  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  this.reconnectAttempts = 0;
  void this.connect().catch((err) => {
    console.error("Recovery connect failed:", err);
  });
}
```

Export `ProbeTrigger` from `packages/web/src/ws/index.ts`.

- [ ] **Step 4: Run the web websocket client tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/ws/__tests__/client.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the transport-only websocket client**

```bash
git add packages/web/src/ws/client.ts packages/web/src/ws/index.ts packages/web/src/ws/__tests__/client.test.ts
git commit -m "Make web websocket client transport-only"
```

## Task 5: Introduce the Frontend Recovery Coordinator

**Files:**
- Create: `packages/web/src/features/terminal-panel/recovery-coordinator.ts`
- Create: `packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts`
- Modify: `packages/web/src/features/terminal-panel/index.tsx`
- Modify: `packages/web/src/features/terminal-panel/replay-state.ts`

- [ ] **Step 1: Write the failing coordinator tests**

Create `packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRecoveryCoordinator } from "../recovery-coordinator";

describe("RecoveryCoordinator", () => {
  it("probes then reconciles silently on foreground resume when transport is connected", async () => {
    const wsClient = {
      getStatus: vi.fn(() => "connected"),
      probeConnection: vi.fn().mockResolvedValue({ ok: true }),
      onStatus: vi.fn(() => () => {}),
      subscribe: vi.fn(() => () => {}),
      sendCommand: vi.fn()
        .mockResolvedValueOnce({
          terminals: [{ terminalId: "term-1", action: "noop", headSeq: 9 }],
        }),
    } as const;

    const applyReplay = vi.fn();
    const applySnapshot = vi.fn();

    const coordinator = createRecoveryCoordinator({
      wsClient,
      sendCommand: wsClient.sendCommand,
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
    expect(wsClient.sendCommand).toHaveBeenCalledWith("recovery.reconcile", {
      reason: "foreground_resume",
      terminals: [{ terminalId: "term-1", renderedSeq: 9 }],
    });
    expect(applyReplay).not.toHaveBeenCalled();
    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it("executes replay as non-blocking recovery", async () => {
    const setUiMode = vi.fn();
    const sendCommand = vi.fn()
      .mockResolvedValueOnce({
        terminals: [{ terminalId: "term-1", action: "replay", fromSeq: 20, headSeq: 30 }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: 10,
        seq: 30,
        bytes: new TextEncoder().encode("missed tail"),
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
  });

  it("executes snapshot as blocking rebuild", async () => {
    const setUiMode = vi.fn();
    const sendCommand = vi.fn()
      .mockResolvedValueOnce({
        terminals: [{ terminalId: "term-1", action: "snapshot", headSeq: 30 }],
      })
      .mockResolvedValueOnce({
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: 10,
        seq: 30,
        rows: 24,
        cols: 80,
        source: "headless",
        bytes: new Uint8Array([1, 2, 3]),
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
  });
});
```

- [ ] **Step 2: Run the coordinator tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/recovery-coordinator.test.ts
```

Expected:
- FAIL because `createRecoveryCoordinator()` does not exist

- [ ] **Step 3: Implement the coordinator and recovery UI types**

Create `packages/web/src/features/terminal-panel/recovery-coordinator.ts`:

```ts
import type {
  RecoveryReason,
  RecoveryReconcileDecision,
  RecoveryReconcileResult,
  TerminalContinuityLostEvent,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import type { DispatchCommand } from "../../atoms/connection";
import type {
  ProbeTrigger,
  TerminalReplayPayload,
  TerminalSnapshotPayload,
  WsClient,
} from "../../ws/client";
import { TERMINAL_REPLAY_TIMEOUT_MS } from "./replay-state";

export type RecoveryUiMode =
  | "silent"
  | "checking"
  | "non_blocking_recovering"
  | "blocking_rebuild"
  | "error";

interface RegisteredTerminal {
  terminalId: string;
  workspaceId: string;
  getRenderedSeq: () => number;
  setUiMode: (mode: RecoveryUiMode) => void;
}

interface RecoveryCoordinatorDeps {
  wsClient: Pick<WsClient, "getStatus" | "probeConnection" | "onStatus" | "subscribe">;
  sendCommand: DispatchCommand;
  applyReplay: (terminalId: string, payload: TerminalReplayPayload) => Promise<void> | void;
  applySnapshot: (terminalId: string, payload: TerminalSnapshotPayload) => Promise<void> | void;
}

export function createRecoveryCoordinator(deps: RecoveryCoordinatorDeps) {
  const terminals = new Map<string, RegisteredTerminal>();
  let pendingSocketReconcile = false;

  const reconcile = async (reason: RecoveryReason, targetTerminalId?: string) => {
    const entries = Array.from(terminals.values()).filter((entry) =>
      targetTerminalId ? entry.terminalId === targetTerminalId : true
    );
    if (entries.length === 0) {
      return;
    }

    const result = await deps.sendCommand<RecoveryReconcileResult>("recovery.reconcile", {
      reason,
      terminals: entries.map((entry) => ({
        terminalId: entry.terminalId,
        renderedSeq: entry.getRenderedSeq(),
      })),
    });

    if (!result.ok || !result.data) {
      for (const entry of entries) {
        entry.setUiMode("error");
      }
      return;
    }

    for (const decision of result.data.terminals) {
      await applyDecision(decision);
    }
  };

  const applyDecision = async (decision: RecoveryReconcileDecision) => {
    const terminal = terminals.get(decision.terminalId);
    if (!terminal) {
      return;
    }

    if (decision.action === "noop" || decision.action === "closed") {
      terminal.setUiMode("silent");
      return;
    }

    if (decision.action === "unrecoverable") {
      terminal.setUiMode("error");
      return;
    }

    if (decision.action === "replay") {
      terminal.setUiMode("non_blocking_recovering");
      const replayResult = await deps.sendCommand<TerminalReplayPayload>(
        "terminal.replay",
        { terminalId: decision.terminalId, lastSeq: decision.fromSeq },
        { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
      );
      if (!replayResult.ok || !replayResult.data || replayResult.data.status !== "ok") {
        terminal.setUiMode("error");
        return;
      }
      await deps.applyReplay(decision.terminalId, replayResult.data);
      terminal.setUiMode("silent");
      return;
    }

    terminal.setUiMode("blocking_rebuild");
    const snapshotResult = await deps.sendCommand<TerminalSnapshotPayload>(
      "terminal.snapshot",
      { terminalId: decision.terminalId },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    );
    if (!snapshotResult.ok || !snapshotResult.data || snapshotResult.data.status !== "ok") {
      terminal.setUiMode("error");
      return;
    }
    await deps.applySnapshot(decision.terminalId, snapshotResult.data);
    terminal.setUiMode("silent");
  };

  const maybeProbe = async (reason: RecoveryReason) => {
    if (reason !== "foreground_resume" && reason !== "network_online") {
      return true;
    }

    if (deps.wsClient.getStatus() !== "connected") {
      return false;
    }

    await deps.wsClient.probeConnection(
      reason === "foreground_resume" ? "foreground_resume" : "network_online"
    );
    return true;
  };

  deps.wsClient.onStatus((status) => {
    if (status === "disconnected" || status === "reconnecting") {
      pendingSocketReconcile = true;
      return;
    }

    if (status === "connected" && pendingSocketReconcile) {
      pendingSocketReconcile = false;
      void reconcile("socket_reconnected");
    }
  });

  deps.wsClient.subscribe(["workspace.*"], (topic, payload) => {
    const match = topic.match(/^workspace\.([^.]+)\.terminal\.([^.]+)\.continuity_lost$/);
    if (!match) {
      return;
    }

    const data = payload as TerminalContinuityLostEvent;
    void reconcile("continuity_lost", data.terminalId);
  });

  return {
    registerTerminal(entry: RegisteredTerminal) {
      terminals.set(entry.terminalId, entry);
      return () => {
        terminals.delete(entry.terminalId);
      };
    },
    async notifyReason(reason: RecoveryReason, terminalId?: string) {
      const shouldProceed = await maybeProbe(reason);
      if (!shouldProceed) {
        pendingSocketReconcile = true;
        return;
      }

      await reconcile(reason, terminalId);
    },
  };
}
```

Update `packages/web/src/features/terminal-panel/replay-state.ts`:

```ts
export type RecoveryUiMode =
  | "silent"
  | "checking"
  | "non_blocking_recovering"
  | "blocking_rebuild"
  | "error";
```

Export the coordinator from `packages/web/src/features/terminal-panel/index.tsx` if needed:

```ts
export { createRecoveryCoordinator } from "./recovery-coordinator";
```

- [ ] **Step 4: Run the coordinator tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/recovery-coordinator.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit the frontend recovery coordinator**

```bash
git add packages/web/src/features/terminal-panel/recovery-coordinator.ts packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts packages/web/src/features/terminal-panel/index.tsx packages/web/src/features/terminal-panel/replay-state.ts
git commit -m "Add terminal recovery coordinator"
```

## Task 6: Route Lifecycle Events Through the Coordinator

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write the failing providers lifecycle tests**

Add these tests to `packages/web/src/app/providers.lifecycle.test.tsx`:

```ts
it("probes and reconciles on visibility return instead of forcing replay semantics", async () => {
  const probeConnection = vi.fn().mockResolvedValue({ ok: true });
  const sendCommand = createWsSendCommandMock((op) => {
    if (op === "recovery.reconcile") {
      return {
        terminals: [],
      };
    }
    return undefined;
  });

  wsState.client = {
    ...wsState.client!,
    getStatus: vi.fn(() => "connected"),
    probeConnection,
    sendCommand,
  };

  const store = createStore();
  setVisibilityState("hidden");
  renderProviders(store);

  await vi.waitFor(() => {
    expect(wsState.client?.connect).toHaveBeenCalled();
  });

  act(() => {
    setVisibilityState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await vi.waitFor(() => {
    expect(probeConnection).toHaveBeenCalledWith("foreground_resume");
  });
  expect(sendCommand).toHaveBeenCalledWith(
    "recovery.reconcile",
    expect.objectContaining({ reason: "foreground_resume" })
  );
});

it("does not reconcile on foreground return while activation is gated", async () => {
  const probeConnection = vi.fn().mockResolvedValue({ ok: true });
  wsState.client = {
    ...wsState.client!,
    getStatus: vi.fn(() => "connected"),
    probeConnection,
    sendCommand: createWsSendCommandMock(),
  };

  const store = createStore();
  act(() => {
    store.set(activationStatusAtom, "gated");
  });

  renderProviders(store);

  act(() => {
    setVisibilityState("visible");
    window.dispatchEvent(new Event("focus"));
  });

  await Promise.resolve();
  expect(probeConnection).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the providers lifecycle tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/app/providers.lifecycle.test.tsx
```

Expected:
- FAIL because `providers.tsx` still only calls `recoverConnection()`
- FAIL because no recovery coordinator exists in the provider wiring

- [ ] **Step 3: Replace direct recovery triggers with coordinator notifications**

In `packages/web/src/app/providers.tsx`, instantiate one coordinator alongside the websocket singleton:

```ts
let globalRecoveryCoordinator: ReturnType<typeof createRecoveryCoordinator> | null = null;
```

When the websocket client is created or reused:

```ts
if (!globalRecoveryCoordinator) {
  globalRecoveryCoordinator = createRecoveryCoordinator({
    wsClient: client,
    sendCommand: (op, args, options) => client.sendCommand(op, args, options),
    applyReplay: async () => {},
    applySnapshot: async () => {},
  });
}
```

For this task, keep the provider-level coordinator transport-facing only and expose it to terminal hosts through a module getter:

```ts
export function getGlobalRecoveryCoordinator() {
  return globalRecoveryCoordinator;
}
```

Update lifecycle handlers:

```ts
const triggerForegroundRecovery = () => {
  if (store.get(activationStatusAtom) === "gated") {
    return;
  }

  syncWorkspaceActivity();
  if (document.visibilityState !== "visible") {
    lastForegroundRecoveryAtRef.current = null;
    return;
  }

  const now = Date.now();
  const lastForegroundRecoveryAt = lastForegroundRecoveryAtRef.current;
  if (
    lastForegroundRecoveryAt !== null &&
    now - lastForegroundRecoveryAt < FOREGROUND_RECOVERY_COOLDOWN_MS
  ) {
    return;
  }

  lastForegroundRecoveryAtRef.current = now;
  void globalRecoveryCoordinator?.notifyReason("foreground_resume");
};

const handleOnline = () => {
  if (store.get(activationStatusAtom) === "gated") {
    return;
  }

  void globalRecoveryCoordinator?.notifyReason("network_online");
};
```

Keep `client.recoverConnection("manual_retry")` only for existing explicit reconnect paths such as reusing a disconnected singleton.

- [ ] **Step 4: Run the providers lifecycle tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/app/providers.lifecycle.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Commit the lifecycle routing changes**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx
git commit -m "Route lifecycle recovery through coordinator"
```

## Task 7: Migrate `XtermHost` to Coordinator-Owned Recovery

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/replay-state.ts`
- Test: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Write the failing xterm host tests**

Add these tests to `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`:

```ts
it("does not trigger replay on successful foreground probe when continuity is intact", async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === "recovery.reconcile") {
      return {
        terminals: [{ terminalId: "term-1", action: "noop", headSeq: 12 }],
      };
    }

    if (op === "terminal.snapshot") {
      return {
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: 4,
        seq: 12,
        rows: 24,
        cols: 80,
        source: "headless",
        bytes: new TextEncoder().encode("init"),
      };
    }

    throw new Error(`Unexpected op ${op}`);
  });

  renderXtermHost({
    terminalId: "term-1",
    workspaceId: "ws-1",
    sendCommand,
  });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.snapshot",
      { terminalId: "term-1" },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    );
  });

  sendCommand.mockClear();
  await act(async () => {
    await getGlobalRecoveryCoordinator()?.notifyReason("foreground_resume", "term-1");
  });

  expect(sendCommand).toHaveBeenCalledWith("recovery.reconcile", {
    reason: "foreground_resume",
    terminals: [{ terminalId: "term-1", renderedSeq: 12 }],
  });
  expect(sendCommand.mock.calls.some(([op]) => op === "terminal.replay")).toBe(false);
});

it("routes live seq gaps through recovery.reconcile before replay", async () => {
  const sendCommand = vi.fn(async (op: string) => {
    if (op === "terminal.snapshot") {
      return {
        status: "ok",
        transport: "binary",
        streamId: 1,
        size: 5,
        seq: 100,
        rows: 24,
        cols: 80,
        source: "headless",
        bytes: new TextEncoder().encode("hello"),
      };
    }

    if (op === "recovery.reconcile") {
      return {
        terminals: [{ terminalId: "gap-terminal", action: "replay", fromSeq: 100, headSeq: 112 }],
      };
    }

    if (op === "terminal.replay") {
      return {
        status: "ok",
        transport: "binary",
        streamId: 2,
        size: 12,
        seq: 112,
        bytes: new TextEncoder().encode("missed\\ntail\\n"),
      };
    }

    throw new Error(`Unexpected op ${op}`);
  });

  const { eventHandler } = renderXtermHost({
    terminalId: "gap-terminal",
    workspaceId: "test-workspace",
    sendCommand,
  });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "terminal.snapshot",
      { terminalId: "gap-terminal" },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    );
  });

  act(() => {
    eventHandler?.(
      Topics.terminalOutput("test-workspace", "gap-terminal"),
      {
        transport: "binary",
        streamId: 9,
        size: 4,
        bytes: new TextEncoder().encode("tail"),
      },
      116
    );
  });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("recovery.reconcile", {
      reason: "seq_gap",
      terminals: [{ terminalId: "gap-terminal", renderedSeq: 100 }],
    });
  });
  expect(sendCommand).toHaveBeenCalledWith(
    "terminal.replay",
    { terminalId: "gap-terminal", lastSeq: 100 },
    { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
  );
});
```

- [ ] **Step 2: Run the xterm host tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:
- FAIL because `XtermHost` still owns replay policy directly
- FAIL because foreground validation still reaches replay paths through websocket recovery semantics

- [ ] **Step 3: Refactor `XtermHost` to report evidence and apply coordinator actions**

In `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`:

1. Register/unregister the terminal with the global recovery coordinator:

```ts
const recoveryCoordinator = getGlobalRecoveryCoordinator();

useEffect(() => {
  if (!recoveryCoordinator) {
    return;
  }

  return recoveryCoordinator.registerTerminal({
    terminalId,
    workspaceId,
    getRenderedSeq: () => latestRenderedSeqRef.current,
    setUiMode: (mode) => {
      if (mode === "silent") {
        setReplayUiState({ kind: "ready" });
      } else if (mode === "non_blocking_recovering") {
        setReplayUiState({ kind: "loading" });
      } else if (mode === "blocking_rebuild") {
        setReplayUiState({ kind: "loading" });
      } else if (mode === "error") {
        setReplayUiState({ kind: "degraded", reason: "failed" });
      }
    },
  });
}, [terminalId, workspaceId, recoveryCoordinator]);
```

2. Replace direct cold-start policy:

```ts
(async () => {
  await initialReplayReady;
  if (!mountedRef.current) {
    return;
  }

  await recoveryCoordinator?.notifyReason("initial_mount", terminalId);
})().catch((error) => {
  failHistoricalRecovery(error);
});
```

3. Replace live seq gap direct replay:

```ts
if (chunkStartSeq > replayedSeqRef.current) {
  pendingReplayChunksRef.current.push({
    bytes: outputData.bytes,
    seq: _seq,
  });
  setOutputAtom((_prev: OutputBuffer) => ({
    chunks: [],
    lastSeq: replayedSeqRef.current,
  }));
  void recoveryCoordinator?.notifyReason("seq_gap", terminalId);
  return;
}
```

4. Delete websocket-driven recovery policy hooks:

```ts
useEffect(() => {
  if (!wsClient || typeof wsClient.onRecovery !== "function") {
    return;
  }
  ...
}, [wsClient]);
```

5. Keep byte application helpers, but expose them to the coordinator by lifting replay/snapshot application into named functions inside the component and passing them through registration or module-level callbacks.

6. Only render blocking overlay for snapshot rebuild states. Replay patching keeps the terminal visible:

```ts
const shouldBlockTerminal =
  replayUiState.kind === "loading" && activeRecoveryModeRef.current === "snapshot";
```

- [ ] **Step 4: Run the xterm host tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:
- PASS

- [ ] **Step 5: Run the focused end-to-end verification set**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/protocol/messages.test.ts
pnpm --filter @coder-studio/server exec vitest run src/terminal/manager.test.ts src/__tests__/terminal-commands.test.ts src/__tests__/ws-client.test.ts src/__tests__/ws-hub.test.ts src/__tests__/stream-buffer.test.ts
pnpm --filter @coder-studio/web exec vitest run src/ws/__tests__/client.test.ts src/app/providers.lifecycle.test.tsx src/features/terminal-panel/__tests__/recovery-coordinator.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:
- PASS across all commands
- No test still expecting `wsClient.onRecovery()` to exist

- [ ] **Step 6: Commit the convergence pass**

```bash
git add packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx packages/web/src/features/terminal-panel/replay-state.ts packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
git add packages/web/src/features/terminal-panel/recovery-coordinator.ts packages/web/src/features/terminal-panel/__tests__/recovery-coordinator.test.ts
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/ws/client.ts packages/web/src/ws/index.ts packages/web/src/ws/__tests__/client.test.ts
git add packages/server/src/commands/recovery.ts packages/server/src/commands/index.ts packages/server/src/terminal/types.ts packages/server/src/terminal/manager.ts packages/server/src/terminal/manager.test.ts
git add packages/server/src/ws/client.ts packages/server/src/ws/hub.ts packages/server/src/__tests__/terminal-commands.test.ts packages/server/src/__tests__/ws-client.test.ts packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/stream-buffer.test.ts
git add packages/core/src/protocol/messages.ts packages/core/src/protocol/topics.ts packages/core/src/domain/events.ts packages/core/src/index.ts packages/core/src/protocol/messages.test.ts
git commit -m "Unify terminal recovery flow"
```

## Spec Coverage Check

- `RecoveryCoordinator` as sole frontend recovery authority:
  Covered by Task 5 and Task 7.
- `recovery.reconcile` as single backend decision command:
  Covered by Task 2.
- `terminal.continuity_lost` explicit control event:
  Covered by Task 3.
- `WsClient` transport-only semantics:
  Covered by Task 4.
- `providers.tsx` foreground/online listeners become suspicion-only:
  Covered by Task 6.
- `XtermHost` stops interpreting foreground/probe/reconnect as replay intent:
  Covered by Task 7.
- Replay non-blocking, snapshot blocking:
  Covered by Task 5 and Task 7.
- Browser switch-away/return should not show blocking recovery when socket stayed alive:
  Covered by Task 5, Task 6, and Task 7 test cases.

## Placeholder Scan

- No `TODO`, `TBD`, or “similar to Task N” placeholders remain.
- Every task names exact files and concrete test commands.
- All command names and reasons are aligned with the approved design:
  - `recovery.reconcile`
  - `terminal.continuity_lost`
  - `initial_mount`
  - `foreground_resume`
  - `network_online`
  - `socket_reconnected`
  - `seq_gap`
  - `continuity_lost`

## Type Consistency Check

- `RecoveryReason` values are consistent across protocol, server command, coordinator, and tests.
- UI mode naming is consistent across plan tasks:
  - `silent`
  - `checking`
  - `non_blocking_recovering`
  - `blocking_rebuild`
  - `error`
- Reconcile decisions are consistent across plan tasks:
  - `noop`
  - `replay`
  - `snapshot`
  - `closed`
  - `unrecoverable`
