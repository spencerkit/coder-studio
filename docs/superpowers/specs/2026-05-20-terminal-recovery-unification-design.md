# Terminal Recovery Unification Design

> **Date:** 2026-05-20
> **Status:** Draft
> **Scope:** `packages/web` and `packages/server` terminal recovery, websocket liveness recovery, terminal continuity recovery, and recovery UI governance

## 1. Goal

Unify websocket recovery and terminal historical recovery into a single recovery model so the product stops treating every foreground return as if the terminal must be rebuilt.

The target outcome is:

- foreground return, focus regain, or `online` events do not directly trigger terminal replay
- websocket liveness, terminal continuity, and recovery UI are modeled separately
- a single coordinator decides when to do nothing, when to reconcile, when to replay, and when to snapshot
- terminal recovery becomes evidence-driven rather than trigger-driven
- blocking recovery UI appears only for state-replacement recovery, not for benign liveness checks

This design is intentionally a one-time convergence. It does not preserve the old split recovery behavior.

## 2. Current Problem

Today recovery semantics are spread across three layers with overlapping authority:

- `packages/web/src/app/providers.tsx`
  - emits foreground and online recovery triggers
- `packages/web/src/ws/client.ts`
  - mixes reconnect behavior with probe-driven recovery callbacks
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - consumes websocket recovery callbacks and terminal stream gaps, then directly issues replay or snapshot requests

This creates a semantic collapse:

- "the socket answered a probe" gets treated as "the terminal likely needs historical recovery"
- "foreground return" gets treated as a recovery event rather than a suspicion that may require validation
- terminal recovery UI appears in cases where the websocket never actually disconnected and terminal continuity was never lost

The user-visible failure mode is the current regression:

- switch away from the browser
- return a moment later
- the terminal shows a blocking recovery overlay even though the websocket never disconnected and no terminal data was actually lost

## 3. Root Cause

The root cause is not a single bad condition. It is a bad architecture boundary.

The current system conflates three separate concerns:

1. websocket transport liveness
2. terminal output continuity
3. terminal recovery presentation

These concerns do interact, but they are not equivalent:

- a live websocket does not prove terminal continuity
- a disconnected websocket does not prove terminal continuity loss for every terminal
- a possible continuity problem does not justify blocking the UI

The current design still partially relies on implication chains like:

- foreground return
- probe socket
- probe succeeds
- fire recovery callback
- terminal performs replay

That implication chain is the architectural problem this design removes.

## 4. Design Principles

### 4.1 Evidence Before Recovery

No terminal replay or snapshot may be triggered directly from a foreground, focus, `pageshow`, or `online` event.

Those events may only raise suspicion and trigger reconciliation.

### 4.2 Single Recovery Authority

Only one frontend unit may decide whether a terminal should:

- do nothing
- replay from a sequence number
- snapshot-rebuild
- enter degraded state

That unit is the new `RecoveryCoordinator`.

### 4.3 Control Plane vs Data Plane

Recovery strategy and recovery data are different concerns.

- control plane
  - decide what recovery action is required
- data plane
  - fetch replay bytes or snapshot bytes

This separation keeps policy in one place and historical data transport in another.

### 4.4 UI Must Reflect Recovery Severity

Recovery UI must match the real level of disruption:

- liveness validation: silent
- continuity reconciliation: silent
- incremental replay patch: non-blocking
- snapshot rebuild: blocking
- unrecoverable failure: degraded/error

### 4.5 Terminal Continuity Is Per Terminal

Recovery cannot remain a global websocket-only concept.

Continuity must be tracked per terminal because:

- terminals can have different rendered sequence positions
- some terminals may need recovery while others do not
- stream drop pressure can affect one terminal topic but not another

## 5. In Scope

This design includes:

- adding a frontend `RecoveryCoordinator`
- removing direct terminal replay decisions from websocket recovery callbacks
- introducing a unified `recovery.reconcile` command
- narrowing `connection.probe` semantics to transport liveness only
- adding server-to-client control events for terminal continuity loss
- redefining overlay behavior for replay vs snapshot recovery
- migrating `XtermHost` to a render-only plus event-reporting role
- unifying initial mount, reconnect, gap repair, and foreground-return validation under one recovery decision flow

## 6. Out of Scope

This design does not include:

- changing websocket authentication, activation, or fencing semantics
- replacing `terminal.replay` or `terminal.snapshot` with a new historical data format
- resizing the ring buffer
- replacing the stream backpressure model
- changing terminal binary encoding
- changing session-level terminal ownership rules
- introducing backward compatibility with the old recovery protocol

## 7. High-Level Architecture

After convergence, recovery authority is split like this:

### 7.1 `WsClient`

`WsClient` becomes transport-focused:

- connect
- reconnect
- status updates
- liveness probe
- raw command dispatch
- raw event delivery

It no longer implies terminal recovery semantics from probe success.

### 7.2 `RecoveryCoordinator`

`RecoveryCoordinator` becomes the sole recovery policy owner:

- consume recovery-related events
- maintain transport and per-terminal continuity state
- batch reconciliation requests
- decide when to request replay or snapshot
- control recovery UI mode

### 7.3 `XtermHost`

`XtermHost` becomes a terminal runtime host:

- render live terminal output
- track latest rendered sequence
- report local evidence such as detected sequence gaps
- apply replay bytes
- apply snapshot bytes

It no longer decides recovery strategy.

### 7.4 Server Recovery Decision Layer

The server becomes responsible for answering:

- does this terminal need recovery
- if yes, what is the correct action

That decision moves into `recovery.reconcile`.

The server continues to expose:

- `terminal.replay`
- `terminal.snapshot`

as data-plane commands only.

## 8. Recovery Model

Recovery is modeled as three independent but coordinated dimensions.

### 8.1 Transport State

Global transport state:

- `connected`
- `probing`
- `reconnecting`
- `rejected`

### 8.2 Per-Terminal Continuity State

Per terminal:

- `clean`
- `suspect`
- `gap`
- `recovering_replay`
- `recovering_snapshot`
- `closed`
- `degraded`

### 8.3 Per-Terminal UI Mode

Per terminal:

- `silent`
- `checking`
- `non_blocking_recovering`
- `blocking_rebuild`
- `error`

The key design rule is that transport and continuity do not collapse into one state.

## 9. RecoveryCoordinator Responsibilities

The `RecoveryCoordinator` is the only place allowed to turn a recovery signal into a recovery action.

It must:

- receive normalized recovery events
- coalesce duplicate events
- batch reconcile requests for mounted terminals
- run silent liveness checks when needed
- decide whether to hold reconciliation until reconnect completes
- issue `recovery.reconcile`
- execute resulting replay or snapshot actions
- expose per-terminal UI mode to the terminal host

It must not:

- own xterm rendering details
- own websocket framing
- contain business logic about activation or workspace auth

## 10. Recovery Event Sources

The coordinator consumes these normalized event reasons:

- `initial_mount`
- `foreground_resume`
- `network_online`
- `socket_closed`
- `socket_reconnected`
- `seq_gap`
- `continuity_lost`

### 10.1 `initial_mount`

Raised when a terminal host mounts and needs an initial historical baseline.

This is not treated as an error case. It is normal hydration.

### 10.2 `foreground_resume`

Raised from:

- `visibilitychange` to visible
- `focus`
- `pageshow`

This reason means:

- the app may have been suspended
- terminal continuity is uncertain
- validate silently

It must not directly replay.

### 10.3 `network_online`

Raised when the browser emits `online`.

This also means:

- possible uncertainty
- silent validation first

It must not directly replay.

### 10.4 `socket_closed`

Raised when websocket transport actually closes.

This moves transport into `reconnecting`. No terminal recovery action is executed yet.

### 10.5 `socket_reconnected`

Raised once websocket transport is back in `connected` after a real reconnect.

This is a high-confidence reason to reconcile all mounted terminals.

### 10.6 `seq_gap`

Raised by `XtermHost` when live terminal output sequence numbers are not contiguous.

This is direct terminal continuity evidence and should reconcile that terminal immediately.

### 10.7 `continuity_lost`

Raised by a server control event when the server knows that terminal stream continuity for a client is no longer trustworthy.

This is also direct continuity evidence and should reconcile that terminal immediately.

## 11. Trigger Matrix

| Trigger | WS Action | Coordinator Action | Terminal Data Action |
|---|---|---|---|
| initial mount | none | reconcile terminal | snapshot first or replay fallback |
| foreground resume, socket connected | silent probe | reconcile mounted terminals | usually `noop` |
| foreground resume, socket disconnected | reconnect | defer until reconnected | reconcile after connect |
| online, socket connected | silent probe | reconcile mounted terminals | usually `noop` |
| online, socket disconnected | reconnect | defer until reconnected | reconcile after connect |
| websocket close | reconnect | mark pending | none yet |
| websocket reopened | resubscribe/resync | reconcile mounted terminals | replay or snapshot if needed |
| live seq gap | none | reconcile affected terminal | replay or snapshot |
| server continuity lost | none | reconcile affected terminal | replay or snapshot |

## 12. Unified Protocol

Recovery uses two protocol layers:

- decision layer
  - `recovery.reconcile`
- data layer
  - `terminal.replay`
  - `terminal.snapshot`

### 12.1 `connection.probe`

`connection.probe` remains, but its semantics are narrowed:

- prove transport round-trip liveness
- do not imply terminal recovery

If the probe succeeds:

- transport remains `connected`
- coordinator may proceed to reconciliation

If the probe fails:

- websocket transport is forced into reconnect flow

### 12.2 `recovery.reconcile`

This is the new strategy command.

Frontend request:

```ts
type RecoveryReason =
  | "initial_mount"
  | "foreground_resume"
  | "network_online"
  | "socket_reconnected"
  | "seq_gap"
  | "continuity_lost";

interface RecoveryReconcileRequest {
  reason: RecoveryReason;
  terminals: Array<{
    terminalId: string;
    renderedSeq: number;
  }>;
}
```

Server response:

```ts
type RecoveryReconcileDecision =
  | { terminalId: string; action: "noop"; headSeq: number }
  | { terminalId: string; action: "replay"; fromSeq: number; headSeq: number }
  | { terminalId: string; action: "snapshot"; headSeq: number }
  | { terminalId: string; action: "closed"; headSeq: number; exitCode?: number }
  | {
      terminalId: string;
      action: "unrecoverable";
      reason: "too_old_no_snapshot" | "unknown_terminal";
    };

interface RecoveryReconcileResult {
  terminals: RecoveryReconcileDecision[];
}
```

This command is the only backend authority for choosing recovery action.

### 12.3 `terminal.replay`

`terminal.replay` continues to accept:

- `terminalId`
- `lastSeq`

Its role after convergence:

- fetch replay bytes only
- do not decide whether replay is appropriate

### 12.4 `terminal.snapshot`

`terminal.snapshot` continues to fetch current baseline state only.

Its role after convergence:

- fetch snapshot bytes only
- do not decide whether snapshot is appropriate

## 13. Server Decision Rules

For each terminal in `recovery.reconcile`, the server decides based on:

- whether the terminal exists
- terminal current `headSeq`
- client `renderedSeq`
- ring buffer replayability
- snapshot buffer availability
- terminal liveness / exit state
- reconcile reason

The unified decision rules are:

1. if terminal does not exist:
   - return `unrecoverable(unknown_terminal)`

2. if `renderedSeq === headSeq`:
   - return `noop`

3. if terminal is closed and `renderedSeq >= headSeq`:
   - return `closed`

4. if reason is `initial_mount` and snapshot is available:
   - return `snapshot`

5. if replay from `renderedSeq` is possible from ring buffer:
   - return `replay`

6. if replay is too old and snapshot is available:
   - return `snapshot`

7. if terminal is closed and no additional recovery is possible:
   - return `closed`

8. otherwise:
   - return `unrecoverable(too_old_no_snapshot)`

This makes the fallback hierarchy explicit and centralized.

## 14. Foreground Return Behavior

Foreground return behavior is the primary UX target of this design.

New behavior:

1. app returns to foreground
2. if websocket is still connected:
   - do a silent probe
3. if probe succeeds:
   - reconcile mounted terminals silently
4. if reconcile returns `noop` for a terminal:
   - do nothing
   - no overlay
   - no replay
   - no terminal interruption

This is the required user-facing result:

- switching away from the browser and back must not show a blocking recovery overlay when the socket remained live and no terminal data was lost

## 15. Server Continuity Loss Event

The current system allows terminal stream data to be dropped under stream buffer pressure. That creates continuity risk even while websocket transport stays open.

To model this explicitly, add a control-path event:

- `terminal.continuity_lost`

Payload:

```ts
interface TerminalContinuityLostEvent {
  workspaceId: string;
  terminalId: string;
  reason: "stream_drop" | "topic_evicted";
}
```

Rules:

- emitted when the server knows a terminal stream for a specific client lost continuity
- must travel over the control path, not the stream path
- consumed by the coordinator, not directly by `XtermHost`

This event removes the need to infer continuity loss only from client-side gaps.

## 16. Frontend UI Rules

Recovery UI must be driven by actual recovery severity.

### 16.1 `checking`

Used for:

- foreground validation
- online validation
- initial decision reconciliation

Rules:

- no blocking overlay
- preferably no visible overlay at all
- safe to remain entirely silent

### 16.2 `non_blocking_recovering`

Used for:

- replay-based incremental patch recovery

Rules:

- no blocking overlay
- terminal remains visible
- optional subtle indicator only

### 16.3 `blocking_rebuild`

Used for:

- snapshot rebuild or any state-replacement recovery that resets the terminal baseline

Rules:

- blocking overlay allowed
- only this class of recovery may interrupt user interaction

### 16.4 `error`

Used for:

- unrecoverable recovery failure
- repeated snapshot/replay failure

Rules:

- explicit degraded/error copy
- no misleading "recovering" spinner when recovery already failed

## 17. Frontend Flow

The steady-state frontend flow becomes:

1. source event arrives
2. coordinator classifies reason
3. if transport validation is needed:
   - run silent probe
4. coordinator builds reconcile request from mounted terminals:
   - `terminalId`
   - current `renderedSeq`
5. coordinator calls `recovery.reconcile`
6. for each decision:
   - `noop`: mark clean
   - `replay`: call `terminal.replay`, apply bytes
   - `snapshot`: call `terminal.snapshot`, replace baseline
   - `closed`: mark closed
   - `unrecoverable`: mark degraded

No other layer may bypass this flow for recovery policy.

## 18. `XtermHost` Migration

`XtermHost` responsibilities after convergence:

- maintain local terminal instance
- track latest rendered sequence
- report `seq_gap`
- consume replay bytes and snapshot bytes
- render UI according to coordinator-owned mode

`XtermHost` must stop doing these things:

- interpreting websocket `onRecovery` events as replay intent
- inferring recovery policy directly from connection status transitions
- issuing ad-hoc replay requests from foreground-return-like causes

The specific old path to remove is the current `onRecovery(trigger !== "reconnected")` branch that schedules reconnect recovery.

## 19. `WsClient` Migration

`WsClient` responsibilities after convergence:

- connect
- reconnect
- probe
- resubscribe
- resync
- emit raw transport status

`WsClient` should no longer expose a terminal-facing recovery meaning on probe success.

This convergence removes `onRecovery` as a terminal recovery signal.

After the change:

- probe results are consumed explicitly by `RecoveryCoordinator`
- transport state remains available through normal status updates
- terminal recovery policy is never inferred from a websocket callback whose meaning is broader than transport liveness

## 20. `providers.tsx` Migration

`providers.tsx` continues to listen for:

- `visibilitychange`
- `focus`
- `pageshow`
- `online`

But these listeners stop meaning "recover the terminal".

They now mean:

- inform the coordinator that liveness or continuity may need validation

This keeps lifecycle wiring in one place while removing recovery policy from the provider layer.

## 21. Backend Migration

Backend changes required:

1. add `recovery.reconcile`
2. add server-side terminal decision logic described above
3. add client-scoped `terminal.continuity_lost` control events from stream pressure paths
4. preserve `terminal.replay` and `terminal.snapshot` as data-plane commands
5. keep `connection.probe` lightweight and transport-only

## 22. Observability

This recovery model is more structured and should expose better tracing.

Recommended trace points:

- reconcile request reason
- requested terminal ids and rendered seqs
- per-terminal server decision
- probe success vs forced reconnect
- replay applied bytes and resulting seq
- snapshot applied seq
- UI mode transitions
- continuity loss control events

This is required to verify that foreground return now mostly produces:

- probe success
- reconcile `noop`
- no visible recovery UI

## 23. Risks

### 23.1 Coordinator Complexity

A centralized coordinator adds statefulness to the frontend runtime.

This is intentional. The current distributed logic is already stateful, but in a fragmented and contradictory way. Centralization reduces semantic drift at the cost of making the state machine explicit.

### 23.2 Migration Risk

Moving replay policy out of `XtermHost` touches a critical path with many tests.

This migration should preserve the existing data-plane commands while replacing the policy entry points in a single convergence pass, then rewriting tests around the new coordinator flow.

### 23.3 Misclassified Recovery Severity

If `recovery.reconcile` makes poor decisions, the UI may either fail to recover or overuse snapshot rebuilds.

This risk is lower than the current system because the decision logic becomes centralized and testable.

## 24. Benefits

- foreground return no longer causes false blocking recovery UI
- websocket liveness and terminal continuity stop being conflated
- one recovery policy path replaces multiple overlapping heuristics
- per-terminal recovery becomes explicit and testable
- server-side continuity knowledge can be surfaced directly rather than inferred indirectly
- replay and snapshot become stable data-plane primitives under a single policy layer

## 25. Acceptance Criteria

This design is successful when all of the following are true:

- returning to the browser while websocket remains connected does not show blocking recovery UI
- foreground return with no lost terminal output results in `recovery.reconcile -> noop`
- websocket reconnect recovery uses `recovery.reconcile` rather than direct terminal replay heuristics
- client-side sequence gaps use the same reconcile flow as reconnect recovery
- server-detected stream continuity loss is surfaced via explicit control event and reconciled through the same flow
- `XtermHost` no longer owns terminal recovery policy
- `WsClient` no longer implies terminal replay semantics from probe success

## 26. Recommended Implementation Order

1. add `recovery.reconcile` server command and tests
2. add `terminal.continuity_lost` control event plumbing
3. introduce frontend `RecoveryCoordinator`
4. migrate provider lifecycle events to the coordinator
5. migrate `XtermHost` to coordinator-owned recovery policy
6. remove or narrow ambiguous websocket recovery callbacks
7. update recovery UI rules and overlays
8. delete obsolete replay-trigger paths
