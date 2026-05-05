# Shell Snapshot-First Terminal Recovery Design

> Date: 2026-05-05
> Status: Draft for review
> Scope: Align shell terminal historical recovery with agent terminals by making snapshot the primary baseline source while retaining replay for fallback and gap recovery

## 1. Goal

This design aligns shell terminal recovery with the existing agent recovery model. Today, agent terminals recover from a headless xterm snapshot first and use replay only when snapshot is unavailable or when a live sequence gap must be repaired. Shell terminals do not follow that model. They skip snapshot entirely and recover only through replay.

The target of this change is to make shell and agent terminals share the same recovery semantics:

- use headless xterm snapshot as the primary recovery baseline
- retain replay as the fallback path when snapshot is unavailable
- retain replay as the incremental repair path for sequence gaps, dropped stream frames, and reconnect recovery

This change is intentionally about recovery semantics, not buffer sizing. The ring buffer remains in place for this phase.

## 2. In Scope

This design includes:

- creating and maintaining a headless snapshot buffer for shell terminals as well as agent terminals
- allowing `terminal.snapshot` to succeed for shell terminals when the headless buffer is available
- changing frontend terminal historical recovery so shell terminals attempt snapshot before replay
- preserving the existing replay-based sequence-gap repair flow
- preserving replay fallback when snapshot is unsupported, disabled, or times out
- updating tests to reflect the new shared behavior

## 3. Out of Scope

This phase does not include:

- changing ring buffer size
- removing ring buffer usage
- removing `terminal.replay`
- replacing replay-based seq-gap repair with snapshot-only recovery
- changing websocket backpressure protocol or stream-drop semantics
- changing supervisor evidence behavior
- introducing a new terminal capability negotiation protocol

## 4. Current Behavior

### 4.1 Backend

Today `TerminalManager.create()` always creates a ring buffer but only creates a `HeadlessSnapshotBuffer` for `agent` terminals. `shell` terminals have no headless snapshot state.

As a result:

- `terminal.snapshot` is effectively an agent-only command
- `terminal.replay` reads historical output directly from the ring buffer for both shell and agent terminals
- ring buffer currently serves both shell cold-start recovery and seq-gap repair

### 4.2 Frontend

`XtermHost` currently branches by terminal kind:

- `agent`
  - request `terminal.snapshot`
  - if snapshot succeeds, paint it as the historical baseline
  - if snapshot fails or is unsupported, fallback to `terminal.replay`
- `shell`
  - skip snapshot
  - always request `terminal.replay`

Live sequence-gap recovery already uses `terminal.replay(lastSeq)` for both kinds.

## 5. Problem

The current split produces an unnecessary divergence in recovery behavior:

- shell and agent terminals recover through different primary paths
- snapshot-based semantics are already trusted for agent but not reused for shell
- shell historical recovery depends on a large replay window even for hard refresh and cold start
- the frontend recovery flow is more conditional than it needs to be

This divergence also makes future memory tuning harder. As long as shell cold start depends entirely on replay, the replay buffer has to carry more responsibility than it otherwise would.

## 6. Design Constraints

- Existing replay-based seq-gap repair must continue to work unchanged.
- Existing websocket backpressure design that depends on seq-gap plus replay must remain valid.
- Shell recovery must degrade cleanly if headless snapshot initialization or serialization fails.
- Frontend recovery must not duplicate already-covered live chunks after applying a snapshot baseline.
- The phase must not silently reduce shell resilience by removing replay fallback.
- This phase must not change user-visible recovery semantics for agent terminals except through internal simplification.

## 7. Core Decision

Adopt a shared recovery model for both shell and agent terminals:

- all interactive terminals maintain a headless snapshot buffer when available
- historical recovery attempts `terminal.snapshot` first
- replay remains the fallback path and the incremental repair path

This is not a snapshot-only design. It is a snapshot-first design.

The semantic split after this change becomes:

- `terminal.snapshot`
  - authoritative source for current terminal screen state at cold start, hard refresh, and reconnect baseline recovery
- `terminal.replay`
  - fallback when snapshot is unavailable
  - incremental patch source for seq-gap repair and replay-from-seq recovery
- ring buffer
  - retained for replay and lightweight tail reads
  - no longer the primary baseline source for shell cold start

## 8. Backend Design

### 8.1 Snapshot Buffer Creation

`TerminalManager.create()` should instantiate `HeadlessSnapshotBuffer` for both `shell` and `agent` terminals.

This means:

- shell PTY output will mirror into headless xterm the same way agent PTY output already does
- resize operations for shell terminals will also keep the snapshot buffer geometry in sync
- teardown and explicit close paths must dispose shell snapshot buffers exactly the same way they already dispose agent snapshot buffers

If headless snapshot initialization fails, terminal creation must still succeed. The terminal remains usable, and recovery falls back to replay.

### 8.2 Snapshot Command Semantics

`TerminalManager.snapshot()` should stop treating `agent` as the gate. The correct gate is whether a usable snapshot buffer exists.

New behavior:

- if terminal does not exist: preserve current behavior
- if terminal has no snapshot buffer or the buffer is disabled: return `unsupported`
- otherwise serialize the headless state and return `ok`

This keeps the command contract stable while broadening shell support.

### 8.3 Ring Buffer Role

The ring buffer stays in place and keeps its current responsibilities:

- serve `terminal.replay(lastSeq)`
- support sequence-gap repair after dropped stream frames
- support reconnect recovery when snapshot fallback is needed
- support lightweight tail reads used by session-level APIs

This phase intentionally does not resize or replace it.

## 9. Frontend Design

### 9.1 Historical Recovery Model

`XtermHost` should stop branching on `terminalKind` for the primary recovery path.

Unified recovery algorithm:

1. request `terminal.snapshot`
2. if snapshot succeeds:
   - paint the snapshot payload into xterm
   - record the returned `seq` as the covered historical boundary
   - flush only live chunks newer than that boundary
3. if snapshot returns `unsupported` or errors:
   - request `terminal.replay(lastSeq)`
   - use replay as today

This applies to both:

- initial cold start
- reconnect historical recovery

### 9.2 Gap Recovery

Live output gap detection remains unchanged.

When the frontend detects that a new live chunk starts after `replayedSeqRef.current`, it should continue to:

- queue the incoming chunk
- request `terminal.replay(replayedSeqRef.current)`
- patch the missing output from ring buffer

Snapshot is not used for gap repair in this phase. That would change semantics from incremental patching to state replacement and is explicitly out of scope.

### 9.3 Fallback Semantics

Frontend fallback remains important even after shell gains snapshot support.

Fallback to replay should still occur when:

- snapshot buffer failed to initialize
- snapshot buffer disabled itself after an internal write/serialize failure
- `terminal.snapshot` times out
- terminal implementation returns `unsupported`

This keeps the system resilient under partial degradation.

## 10. Architecture After Change

After this design lands, terminal recovery semantics become:

| Concern | Shell | Agent |
|---|---|---|
| Cold start baseline | snapshot first | snapshot first |
| Hard refresh baseline | snapshot first | snapshot first |
| Reconnect baseline | snapshot first | snapshot first |
| Snapshot unavailable | replay fallback | replay fallback |
| Seq-gap repair | replay | replay |
| Ring buffer tail reads | yes | yes |

This removes the current shell/agent divergence without changing replay’s role in stream repair.

## 11. Risks

### 11.1 Performance Risk

Shell output will now be mirrored into headless xterm on every PTY chunk, just like agent output. This adds CPU and memory overhead on shell-heavy workloads.

This risk is real, but bounded:

- the system already supports this mechanism for agent terminals
- replay remains available if headless snapshot degrades
- this phase does not add any new synchronous round-trips to the live output path beyond the existing headless write call

The main thing to watch is high-volume shell traffic or multiple shell terminals running interactive TUIs.

### 11.2 Behavioral Compatibility Risk

Shell workloads are more diverse than agent workloads. Full-screen TUIs, alternate screen mode, carriage-return progress UIs, and complex ANSI flows may surface issues that were not visible in agent-only usage.

This is why replay fallback must remain in place and why shell-specific snapshot coverage needs to be added before rollout.

### 11.3 Recovery Timing Risk

If snapshot succeeds but returns a stale or partially drained view, the frontend could misclassify subsequent live output as already covered or not covered. Existing snapshot-seq behavior already guards this for agent terminals, but shell adoption extends that assumption to more workloads.

The design relies on preserving the existing invariant:

- snapshot `seq` must reflect the latest mirrored PTY sequence included in the serialized state

## 12. Benefits

- shell and agent recovery become conceptually uniform
- frontend historical recovery logic becomes simpler and easier to reason about
- shell hard-refresh behavior becomes based on current rendered terminal state rather than requiring a large replay window
- replay is reserved for what it does best: incremental repair and degraded fallback
- future ring buffer tuning becomes safer because shell baseline recovery no longer depends on replay alone

## 13. Testing Strategy

### 13.1 Backend

Add or update tests to cover:

- shell terminals create a snapshot buffer
- shell `terminal.snapshot` returns serialized headless output when available
- shell `terminal.snapshot` returns `unsupported` when the snapshot buffer initialization fails
- shell resize updates the snapshot buffer dimensions
- shell close and shutdown paths dispose the snapshot buffer correctly

Important shell fixture categories:

- multiline shell output
- carriage-return progress updates
- clear-screen and cursor-home resets
- alternate-screen transitions when representable through xterm headless
- unicode and wide-character output

### 13.2 Frontend

Add or update tests to cover:

- shell cold start prefers `terminal.snapshot`
- shell reconnect prefers `terminal.snapshot`
- shell snapshot unsupported path falls back to `terminal.replay`
- shell snapshot timeout path falls back to `terminal.replay`
- shell snapshot baseline only flushes live chunks newer than snapshot `seq`
- shell seq-gap detection still triggers replay and does not route through snapshot

### 13.3 Regression Focus

The highest-value regression checks are:

- no duplicate rendering after snapshot + live flush
- no loss of live chunks that arrive during snapshot recovery
- no behavior regression in existing agent snapshot-first tests
- no regression in replay-based truncation and degraded-state UI

## 14. Rollout Notes

This design is structured so it can ship as a contained recovery change:

- backend broadens snapshot support
- frontend uses snapshot-first for both terminal kinds
- replay remains intact for degraded paths

Because replay remains available, rollback is straightforward: front-end can be switched back to replay-first for shell without changing the wire contract.

## 15. Acceptance Criteria

- shell terminals expose the same snapshot-first recovery semantics as agent terminals
- both shell and agent cold start through `terminal.snapshot` when available
- shell and agent both fallback to replay when snapshot is unavailable or times out
- seq-gap repair remains replay-based and passes existing recovery expectations
- no change is made to ring buffer sizing in this phase

## 16. Open Decision Resolved

For this phase, we explicitly choose:

- yes: unify shell and agent on snapshot-first recovery
- yes: retain replay for fallback and gap repair
- no: do not resize the ring buffer yet
- no: do not attempt snapshot-only recovery

This keeps the change narrowly focused and preserves room for a later buffer-sizing follow-up once the shared recovery model is proven stable.
