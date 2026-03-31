# WebSocket Transport Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce WS frame churn, serialization overhead, and slow-socket pressure in the single-user workspace runtime without changing the visible Claude/Codex/terminal UX.

**Architecture:** Keep the existing single WS connection model and keep current event names (`agent://event`, `terminal://event`, `workspace://...`) stable. Optimize the hot path by classifying events into `stream` vs `control`, batching only high-frequency stream payloads on the server before `socket.send`, and adding bounded backpressure handling so slow sockets cannot accumulate unbounded small-frame work.

**Tech Stack:** Rust backend, React + TypeScript frontend, Axum WebSocket, tokio broadcast, Playwright transport tests, cargo test, pnpm build

---

## Scope Guardrails

- This plan explicitly assumes the current product is still **single-user**.
- This plan **does not** prioritize `workspace/client`-level routing. Under the current single-user assumption, its ROI is low relative to batching and backpressure.
- Phase 1 should preserve the current frontend payload shapes so the command layer and most UI code remain unchanged.

## File Map

### Create

- `apps/server/src/ws/outbound_batcher.rs` — classify outbound WS events, accumulate stream chunks, flush by timer/size, and preserve ordering barriers.

### Modify

- `apps/server/src/ws/server.rs` — route transport events through the batcher before `socket.send`, flush on timer and on control-event boundaries.
- `apps/server/src/ws/mod.rs` — expose the new batcher module if needed by the current module layout.
- `apps/server/src/models.rs` — add internal-only metadata if batching needs event class hints; do not change externally visible WS payload shapes in phase 1 unless required.
- `apps/server/src/app.rs` — add lightweight counters/state only if batch-size or drop metrics need shared config.
- `apps/web/src/ws/connection-manager.ts` — optional only if phase 2 adds client-visible disconnect/backpressure handling or debug counters.
- `apps/web/src/ws/protocol.ts` — optional only if phase 3 introduces a true batched envelope instead of reusing existing event payloads.
- `tests/e2e/transport.spec.ts` — update expectations from “many tiny frames” to “same semantics with fewer frames”.
- `tests/ws-reconnect-policy.test.ts` — extend only if reconnect behavior changes.

### Keep Unchanged In Phase 1

- `apps/web/src/command/agent.command.ts`
- `apps/web/src/command/terminal.command.ts`
- `apps/web/src/command/workspace.command.ts`
- `apps/web/src/features/workspace/workspace-sync-hooks.ts`

These should stay unchanged if batching is implemented by merging `data` within the existing payload schema.

## Event Classes

### Hot Path: batchable

- `agent://event` when `kind` is `stdout` or `stderr`
- `terminal://event`

### Warm Path: immediate

- `workspace://artifacts_dirty`

### Control Path: immediate and ordering barriers

- `agent://lifecycle`
- `workspace://controller`
- `workspace://runtime_state`
- WS `ping` / `pong`

Any control-path event must force a flush of pending stream batches before it is sent.

## Task 1: Add Outbound Stream Classification And Coalescing

**Files:**
- Create: `apps/server/src/ws/outbound_batcher.rs`
- Modify: `apps/server/src/ws/server.rs`
- Test: `apps/server/src/ws/outbound_batcher.rs`

- [ ] **Step 1: Write failing batcher tests**

Add unit tests covering:
- two adjacent `agent://event stdout` chunks for the same `workspace_id/session_id/kind` merge into one outbound event
- two adjacent `terminal://event` chunks for the same `workspace_id/terminal_id` merge into one outbound event
- a control event forces pending stream chunks to flush before the control event
- chunks for different session ids / terminal ids never merge

- [ ] **Step 2: Run the targeted tests and confirm failure**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml outbound_batcher -- --nocapture
```

Expected: FAIL because the batcher module and merge logic do not exist yet.

- [ ] **Step 3: Implement the batcher with schema-preserving merges**

Implementation rules:
- keep the emitted WS event name unchanged
- keep payload keys unchanged
- only change `data` by concatenating adjacent chunks
- flush after a short window such as `16ms` or `33ms`
- also flush immediately when accumulated bytes cross a hard threshold such as `32KB`-`64KB`

- [ ] **Step 4: Re-run the tests and confirm pass**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml outbound_batcher -- --nocapture
```

Expected: PASS.

## Task 2: Integrate Batching Into `ws_session`

**Files:**
- Modify: `apps/server/src/ws/server.rs`
- Test: `tests/e2e/transport.spec.ts`

- [ ] **Step 1: Add per-socket batching instead of changing the shared transport bus first**

Integrate the batcher inside `ws_session(...)` so phase 1 only changes the final outbound leg:
- read from the existing `transport_events` broadcast
- buffer only hot-path stream events per socket
- send control/warm-path events immediately
- flush buffered stream events on timer, size threshold, disconnect, and before control events

This keeps the blast radius smaller than changing the global transport bus.

- [ ] **Step 2: Preserve ordering guarantees explicitly**

The integration must guarantee:
- stream chunk order is preserved within a session/terminal
- lifecycle/controller/runtime events cannot overtake earlier stream output
- `exit`/`session_ended` related visibility still appears after all preceding output

- [ ] **Step 3: Update transport e2e expectations**

Adjust tests so they verify:
- the same semantic output still arrives
- frame counts for long-running output are lower than before
- reconnect behavior still works

- [ ] **Step 4: Run verification**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml
```

```bash
pnpm test:e2e -- --grep transport
```

Expected:
- server tests green
- transport tests green with fewer stream frames

## Task 3: Add Backpressure Policy For Slow Sockets

**Files:**
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/ws/outbound_batcher.rs`
- Optional Modify: `apps/web/src/ws/connection-manager.ts`
- Test: `tests/e2e/transport.spec.ts`

- [ ] **Step 1: Define a bounded pending-output policy**

Rules for phase 1:
- control-path events are never dropped
- hot-path stream output is allowed to collapse further under pressure
- once pending stream bytes exceed a configured cap, prefer replacing multiple queued stream events with one newer aggregate event instead of letting the queue grow indefinitely

- [ ] **Step 2: Add explicit accounting**

Track at least:
- current pending stream bytes per socket
- flush count
- collapse count
- drop count if any stream data is intentionally discarded

This can be debug-only logging or lightweight counters; it does not need product UI.

- [ ] **Step 3: Verify degraded behavior is controlled**

Simulate a slow consumer or artificial send delay and confirm:
- the socket does not accumulate unbounded pending output
- control events still arrive
- the connection does not thrash reconnects under normal stream load

- [ ] **Step 4: Run verification**

Run:

```bash
cargo test --manifest-path apps/server/Cargo.toml
```

Plus any targeted local slow-socket test harness used for this task.

## Task 4: Optional Phase 2 Protocol Upgrade Only If Needed

**Files:**
- Modify: `apps/web/src/ws/protocol.ts`
- Modify: `apps/web/src/ws/connection-manager.ts`
- Modify: `apps/web/src/command/*`
- Modify: `apps/server/src/ws/server.rs`
- Test: `tests/e2e/transport.spec.ts`

- [ ] **Step 1: Re-measure after Tasks 1-3**

Only continue if phase 1 is still insufficient.

- [ ] **Step 2: Introduce a true batched envelope if necessary**

Potential shape:
- one WS frame containing multiple logical events
- or one WS frame containing an event plus `items: []`

Do this only if phase 1 schema-preserving batching does not reduce frame count enough.

- [ ] **Step 3: Update frontend demux layer**

Teach `WsConnectionManager` to fan a batched frame back into the current per-event subscription API so callers outside the WS layer stay unchanged.

- [ ] **Step 4: Verify all transport-facing tests again**

Run:

```bash
pnpm test:e2e -- --grep transport
```

Expected: no behavioral regression.

## Recommended Rollout Order

1. Implement server-side per-socket stream batching with unchanged event schemas.
2. Add bounded backpressure / collapse policy.
3. Re-measure real stream sessions.
4. Only then decide whether protocol-level batched envelopes are worth the added complexity.

## Change Scope

### Primary Change Scope

- Backend WS transport send path
- Transport-related e2e tests

### Secondary Change Scope

- Frontend WS manager only if metrics or a protocol upgrade becomes necessary

### Explicitly Deferred

- Workspace/client-level WS routing
- Multi-user isolation logic
- Replacing the current broadcast bus

## Impact Analysis

### Affected Runtime Behaviors

- Claude/Codex stdout and stderr delivery cadence
- Terminal output delivery cadence
- Ordering between stream output and lifecycle/control events
- Reconnect transport tests and transport observability

### Not Expected To Change In Phase 1

- Frontend command subscription API
- Session restore/resume semantics
- Workspace controller semantics
- Artifacts dirty semantics
- User-visible event names and payload shapes

## Expected Benefits

- Fewer WS frames during long-running Claude/Codex/terminal output
- Lower server-side `serde_json` and `socket.send` frequency
- Lower browser-side `JSON.parse` and event-dispatch frequency
- Lower GC churn caused by many tiny transport messages
- Better behavior under transient slow-socket conditions

## Expected Negative Effects

- Small added output latency from the flush window, typically `16ms`-`33ms`
- More complexity in WS ordering logic
- Transport tests become more timing-sensitive unless assertions are updated carefully
- Backpressure collapse policies can make raw stream capture less granular during extreme stalls
- Debugging “exactly how many frames were sent” becomes less straightforward

## Success Criteria

- Long Claude/Codex/terminal runs emit materially fewer WS frames than before
- No regressions in output ordering, reconnect behavior, or controller/runtime state handling
- No schema change required for phase 1
- No user-visible difference besides smoother performance under heavy output
