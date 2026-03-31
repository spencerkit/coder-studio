# Runtime Reload Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce page reload request storms, redundant runtime attach work, and frontend allocation pressure without changing the visible Claude/Codex/workspace UX.

**Architecture:** Keep the current UI flow and RPC shapes stable. First suppress duplicate `workspace_runtime_attach` triggers on the frontend and reduce non-critical reload-time RPC fanout. Then, only if profiling still shows attach latency pressure, add a backend fast path for runtime attach assembly instead of changing the transport protocol or workspace model.

**Tech Stack:** React + TypeScript frontend, Rust backend, rusqlite, Playwright e2e, cargo test, pnpm test:e2e

---

## Confirmed Findings

### 1. Reload currently fans out multiple `attach` requests for the same workspace

- `WorkspaceScreen` route bootstrap attaches the active workspace during initial load.
- `WorkbenchRuntimeCoordinator` immediately runs ready-tab runtime recovery.
- `useWorkspaceTransportSync` runs `resyncWorkspaceSnapshots()` whenever WS reaches `connected` or `reconnected`.
- `WorkbenchRuntimeCoordinator` also runs controller recovery polling for observer tabs.

Relevant files:

- `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- `apps/web/src/features/workspace/runtime-attach.ts`

### 2. The current attach dedupe window does not cover the ready-tab retry pattern

- `ATTACH_RUNTIME_SUCCESS_REUSE_MS = 1200`
- `READY_TAB_RUNTIME_RECOVERY_DELAYS_MS = [0, 3000]`

This means the delayed recovery pass is guaranteed to miss the success reuse window and issue another real `attach` unless another in-flight request happens to overlap.

### 3. Every backend `attach` rebuilds the expensive parts under a global DB lock

- `with_db(...)` guards a single shared connection with `state.db.lock()`.
- `workspace_runtime_attach(...)` always:
  - updates/controller lease state
  - loads a full workspace snapshot
  - loads lifecycle replay
- `build_snapshot_from_conn(...)` always:
  - loads active sessions and parses session JSON
  - loads archive and parses session JSON again
  - loads view state
  - loads persisted terminals

Relevant files:

- `apps/server/src/services/workspace_runtime.rs`
- `apps/server/src/infra/db.rs`

### 4. Frontend `attach` application allocates a lot of short-lived objects

- `applyWorkspaceRuntimeSnapshot(...)` rebuilds the tab from snapshot again.
- `createTabFromWorkspaceSnapshot(...)` recreates session arrays, archive arrays, terminal arrays, pane layout, preview state, and normalized tab state.
- `applyLifecycleReplayToState(...)` repeatedly maps tabs and sessions for each replay event.

Repeated reload-time `attach` calls therefore amplify JS allocation churn and GC pressure even when the visible state does not materially change.

Relevant files:

- `apps/web/src/shared/utils/workspace.ts`

### 5. Reload also triggers unrelated RPC fanout

After bootstrap, the UI also starts:

- `listSessionHistory()`
- full artifact refresh:
  - `getGitStatus`
  - `getGitChanges`
  - `getWorktreeList`
  - `getWorkspaceTree`

These compete with `attach` on the same backend process and, for DB-backed calls, on the same DB lock.

Relevant files:

- `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- `apps/web/src/features/workspace/workspace-sync-hooks.ts`

## Root Cause Summary

This is not three separate problems. It is one hot path:

1. Page reload triggers overlapping recovery paths.
2. Overlapping recovery paths call the same expensive `workspace_runtime_attach` RPC.
3. Backend serializes that work under one DB mutex and rebuilds full snapshot state each time.
4. Frontend re-materializes the same workspace structures repeatedly, creating avoidable GC churn.

So the highest-ROI fix is to reduce redundant reload-time `attach` calls first. Backend fast paths should follow only if one `attach` per reload is still too expensive.

## Scope Guardrails

- Keep Claude/Codex/session UX unchanged.
- Keep current workspace/runtime RPC shapes unchanged in phase 1.
- Do not introduce legacy compatibility work.
- Do not rewrite the DB layer or introduce a connection pool in this round.
- Do not change WS protocol/event names in this round.

## File Map

### Phase 1: Frontend request suppression

- Modify: `apps/web/src/features/workspace/runtime-attach.ts`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Test: `tests/e2e/transport.spec.ts`

### Phase 2: Reload-time request fanout reduction

- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Test: `tests/e2e/transport.spec.ts`

### Phase 3: Backend attach assembly fast path

- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/infra/db.rs`
- Test: `apps/server/src/services/workspace_runtime.rs`
- Test: `apps/server/src/command/http.rs`

## Recommended Rollout Order

1. Frontend: converge all reload/reconnect attach triggers behind one scheduler.
2. Frontend: reduce non-critical reload-time RPC fanout.
3. Re-measure reload latency, attach count, and browser heap churn.
4. Backend: only if still needed, reduce per-attach assembly cost.

## Task 1: Converge Runtime Attach Scheduling

**Files:**
- Modify: `apps/web/src/features/workspace/runtime-attach.ts`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Test: `tests/e2e/transport.spec.ts`

- [ ] Replace the current “dedupe only” helper with a per-workspace attach scheduler that tracks:
  - in-flight request
  - last success timestamp
  - last requested reason
  - last observed WS reconnect timestamp
  - last controller convergence timestamp

- [ ] Route all attach callers through that scheduler instead of calling `attachWorkspaceRuntimeWithRetry(...)` independently.

- [ ] Collapse these triggers into scheduler reasons instead of direct network calls:
  - route bootstrap attach
  - ready-tab recovery
  - WS reconnect resync
  - controller recovery polling

- [ ] Add suppression rules:
  - if a recent attach already succeeded and WS is healthy, do not issue another attach just because the ready-tab delayed timer fired
  - if controller state already converged, pause controller recovery attach polling
  - if WS reconnect fires while an attach is in flight or just succeeded, reuse that result instead of issuing another request

- [ ] Keep the existing retry behavior for true recovery cases; only suppress redundant requests.

- [ ] Verification:

```bash
pnpm test:e2e -- --grep "reload|reconnect|observer|recovery"
```

Expected:
- no regression in reload recovery
- no regression in observer/controller convergence
- fewer `workspace_runtime_attach` calls during reload

## Task 2: Reduce Reload-Time Request Fanout

**Files:**
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Test: `tests/e2e/transport.spec.ts`

- [ ] Stop treating all reload-time fetches as equally urgent.

- [ ] Keep these on the critical path:
  - `getWorkbenchBootstrap`
  - route `activate_workspace`
  - one effective `workspace_runtime_attach`

- [ ] Move these off the immediate reload critical path:
  - `listSessionHistory()` unless the history drawer or a restore affordance is actually needed
  - `getWorktreeList()` unless the code panel/worktree UI needs it
  - `getWorkspaceTree()` unless the code panel is visible

- [ ] Keep git summary fast, but consider splitting “top-bar git summary” from “full sidebar tree/worktree refresh” so page load does not always request the full artifact bundle.

- [ ] Ensure deferral does not create stale UI traps:
  - history button still opens correctly
  - code panel still loads data when shown
  - welcome screen history affordance still behaves predictably

- [ ] Verification:

```bash
pnpm test:e2e -- --grep "workspace|history|reload"
```

Expected:
- reload still restores the same workspace/session state
- deferred panels/data still load when opened
- initial page load sends fewer parallel RPCs

## Task 3: Reduce Frontend Allocation Churn During Attach Apply

**Files:**
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Test: `tests/e2e/transport.spec.ts`

- [ ] Avoid re-materializing unchanged workspace structures during attach apply where safe.

- [ ] Prioritize these low-risk reuse points:
  - skip replacing archive/terminals/sessions arrays when the incoming effective data is unchanged
  - avoid repeated full-state `tabs.map(...)` chains for each lifecycle replay event when replay only touches one workspace/session
  - preserve existing tab-level references when no effective field changes

- [ ] Do not introduce deep structural comparison across the whole workbench state. Limit reuse checks to the active workspace/tab path to avoid turning CPU time into comparison time.

- [ ] Verification:

```bash
pnpm test:e2e -- --grep "reload replays agent lifecycle history|interrupted sessions"
```

Expected:
- no UI regression in lifecycle replay/recovery
- fewer repeated tab/session object replacements during reload attach

## Task 4: Backend Attach Fast Path If Phase 1-3 Are Still Not Enough

**Files:**
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/infra/db.rs`
- Test: `apps/server/src/services/workspace_runtime.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] Keep the public `workspace_runtime_attach` RPC shape unchanged.

- [ ] Add a backend fast path that reduces assembly cost without changing semantics. Preferred order:
  1. avoid rebuilding lifecycle replay when there is no recent lifecycle history
  2. avoid loading archive for attach callers that only need runtime recovery, if this can be done without UI regression
  3. cache per-workspace assembled runtime pieces only if invalidation can stay simple and correct

- [ ] Do not start with a DB pool or broad schema rewrite. Those changes are higher risk than the currently confirmed bottleneck.

- [ ] If cache is introduced, invalidation must stay obvious:
  - session create/update/archive/delete
  - terminal create/output/close
  - workspace view updates
  - controller changes if controller is included in cached structure
  - lifecycle append if replay is cached

- [ ] Verification:

```bash
cargo test --manifest-path apps/server/Cargo.toml
pnpm test:e2e -- --grep "reload|reconnect|recovery"
```

Expected:
- runtime attach semantics unchanged
- lower attach latency under repeated reloads

## Impact Analysis

### Highest-Value, Lowest-Risk Changes

- Converging attach scheduling on the frontend
- suppressing redundant recovery attaches
- deferring non-critical reload-time RPCs

These should deliver the main benefit without changing data model or protocol shape.

### Medium-Risk Changes

- reusing existing tab/session structures during attach apply

Risk:
- hidden stale-state bugs if reuse checks are too aggressive

Mitigation:
- restrict reuse to active workspace path
- keep exhaustive reload/recovery e2e coverage

### Higher-Risk Changes

- backend cached attach payloads
- partial attach payload assembly

Risk:
- invalidation bugs
- stale archive/lifecycle/controller state

Mitigation:
- only do this after measuring phase 1-3
- keep invalidation keyed to explicit write paths

## Functional Areas Affected

These changes may affect:

- page reload recovery
- reconnect recovery
- observer/controller takeover convergence
- interrupted-session resume UX
- history drawer freshness
- workspace code panel initial data load
- restore-candidate visibility

These changes should not affect when done correctly:

- Claude/Codex agent start/resume semantics
- session persistence schema
- WS event protocol
- controller lease semantics

## Verification Plan

### Existing Coverage To Re-run

- `cargo test --manifest-path apps/server/Cargo.toml`
- `pnpm test:e2e -- --grep transport`

### Coverage To Add

- reload path asserts effective `workspace_runtime_attach` count stays bounded
- WS reconnect after reload does not immediately cause a second redundant attach
- deferred history/artifact requests still load on first use

## Recommendation

Implement only phase 1 and phase 2 first.

Reason:

- they directly address page refresh, concurrent request fanout, and frontend GC pressure together
- they preserve the current UX and protocol
- they avoid the highest-risk backend caching/invalidation work

Only move to phase 3 or phase 4 if profiling after phase 1-2 still shows reload latency or attach cost is too high.
