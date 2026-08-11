# Desktop Environment Launch Review Hardening Design

## Context

The environment launch readiness handshake now keeps the renderer pending until the target window
is ready, failed, or timed out. A follow-up review found one terminal-state race and two smaller
robustness issues in that implementation.

## Goals

- Treat the atomically committed launch terminal status as the final authority when a child-process
  failure races with target readiness.
- Preserve prompt failure when a child process actually crashes before any ready status is committed.
- Keep the 45-second timeout bounded even if the wall clock moves backwards.
- Represent the final window-readiness wait as indeterminate progress rather than a completed 100%
  bar.
- Cover spawn errors and signal exits explicitly.

## Considered Approaches

### 1. Reconcile the terminal winner after recording a failure — chosen

When child-process readiness waiting rejects, attempt the existing atomic `failed` transition and
then read the committed terminal status. If `ready` already won for the same environment, return
success; otherwise rethrow the original process error.

This preserves immediate crash handling, reuses the existing first-writer-wins protocol, and adds no
new persisted status or process message.

### 2. Ignore abnormal child exit and wait only for the status file

This avoids false failures but restores the previous problem: a genuinely crashed target can leave
the user waiting for the full 45-second timeout. It is rejected.

### 3. Add a separate "activation delivered" acknowledgement

This could distinguish secondary forwarding from primary startup more precisely, but it adds another
cross-process protocol state for a race already resolved by the terminal claim. It is rejected as
unnecessary complexity.

## Design

`environment-launch.ts` will expose one orchestration helper that attempts to record a process
failure and then observes the terminal winner. The helper resolves only when a matching `ready`
status already won; every other outcome rethrows the original error. `main.ts` will delegate its
launch catch path to this helper.

Elapsed timeout accounting in `EnvironmentLaunchStore.waitForTerminal` will use the monotonic Node
performance clock. Persisted `updatedAt` timestamps and stale-file cleanup will continue using wall
clock time because those values must survive across processes and restarts.

The `launching` progress payload will be constructed without a numeric percentage. The renderer
already treats an absent percentage as indeterminate and continues showing its spinner and opening
copy until the IPC promise settles.

## Error Semantics

- Failure claim wins: record `failed` and rethrow the original error immediately.
- Ready claim wins: preserve `ready` and resolve the source launch successfully.
- Timed-out or existing failed claim wins: preserve that terminal state and rethrow.
- Status read or write fails: surface that storage error; do not invent a successful launch.

## Tests

- Real file-store test where `ready` is committed before a late process failure is reconciled.
- Real file-store test where failure wins and the original error is rethrown.
- Timeout test that moves `Date.now()` backwards after waiting begins and still observes a bounded
  timeout.
- Progress factory test proving the launching payload omits `percent`.
- Child-process tests for pre-spawn `error` and signal exit.

## Acceptance

- A committed matching `ready` status cannot be reported to the renderer as failed.
- Genuine non-zero and signal exits still fail promptly.
- Timeout behavior is independent of wall-clock corrections.
- The target-window wait is displayed as indeterminate progress.
