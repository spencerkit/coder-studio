# Desktop Environment Launch Review Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the reviewed ready-versus-exit false failure and harden timeout, progress, and process-exit behavior.

**Architecture:** Keep the file-backed terminal claim as the sole cross-process authority. Add a small launch-layer reconciliation helper, use a monotonic clock only for elapsed waits, and keep renderer state unchanged by emitting indeterminate launch progress.

**Tech Stack:** TypeScript, Electron, Node.js filesystem/process APIs, Vitest, React Testing Library

---

## File Structure

- `packages/desktop/src/environment-launch.ts` — reconcile process failure with the committed terminal winner, use monotonic elapsed time, and create the launching progress payload.
- `packages/desktop/src/environment-launch.test.ts` — real-store race, wall-clock rollback, and progress-payload tests.
- `packages/desktop/src/environment-instance.test.ts` — pre-spawn error and signal-exit coverage.
- `packages/desktop/src/main.ts` — consume launch reconciliation and indeterminate progress.

### Task 1: Preserve a ready terminal winner

**Files:**
- Modify: `packages/desktop/src/environment-launch.test.ts`
- Modify: `packages/desktop/src/environment-launch.ts`
- Modify: `packages/desktop/src/main.ts`

- [ ] **Step 1: Write the failing ready-winner test**

Add a test that creates a real request, commits `ready`, then calls the desired reconciliation helper
with a late process error:

```ts
await store.markReady(request.requestId, requestTarget.id, 4321);
await expect(
  settleEnvironmentLaunchFailure(store, request.requestId, requestTarget, processError)
).resolves.toBeUndefined();
await expect(store.read(request.requestId)).resolves.toMatchObject({ status: "ready" });
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-launch.test.ts
```

Expected: FAIL because `settleEnvironmentLaunchFailure` is not exported.

- [ ] **Step 3: Implement terminal reconciliation**

Add this launch-layer behavior:

```ts
export async function settleEnvironmentLaunchFailure(
  store: EnvironmentLaunchStore,
  requestId: string,
  target: DesktopEnvironmentTarget,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await store.markFailed(requestId, target.id, message);
  const terminal = await store.read(requestId);
  if (terminal?.environmentId === target.id && terminal.status === "ready") return;
  throw error;
}
```

Replace the catch block in `openEnvironmentInstance` with a call to this helper.

- [ ] **Step 4: Add the failure-winner assertion**

Create a pending request, call the helper, assert rejection is the original `Error`, and assert the
stored terminal status is `failed`.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same Desktop Vitest command. Expected: all environment-launch tests pass.

### Task 2: Make elapsed time monotonic

**Files:**
- Modify: `packages/desktop/src/environment-launch.test.ts`
- Modify: `packages/desktop/src/environment-launch.ts`

- [ ] **Step 1: Write the wall-clock rollback test**

Spy on `Date.now()`, begin `waitForTerminal`, move the mocked wall clock backwards, and race the
operation against a short watchdog. Assert the launch timeout error arrives before the watchdog.

- [ ] **Step 2: Run the test and verify RED**

Run the environment-launch test file. Expected: the watchdog wins because current elapsed accounting
uses the rolled-back wall clock.

- [ ] **Step 3: Switch elapsed calculations to `performance.now()`**

Import `performance` from `node:perf_hooks` and use it for `startedAt`, elapsed checks, remaining
poll duration, and the transition-finalization deadline. Keep `Date.now()` for persisted `updatedAt`
and cleanup age comparisons.

- [ ] **Step 4: Run the test and verify GREEN**

Run the environment-launch test file. Expected: the bounded timeout test and all existing transition
tests pass.

### Task 3: Emit indeterminate launching progress

**Files:**
- Modify: `packages/desktop/src/environment-launch.test.ts`
- Modify: `packages/desktop/src/environment-launch.ts`
- Modify: `packages/desktop/src/main.ts`

- [ ] **Step 1: Write the failing progress factory test**

Assert the desired factory returns exactly:

```ts
{
  environmentId: requestTarget.id,
  phase: "launching",
  message: `Opening ${requestTarget.label}…`,
}
```

The absence of `percent` is the required behavior.

- [ ] **Step 2: Run the focused test and verify RED**

Run the environment-launch test file. Expected: FAIL because the factory is not exported.

- [ ] **Step 3: Implement and consume the factory**

Add `createEnvironmentLaunchingProgress(target)` in `environment-launch.ts`, typed as
`DesktopEnvironmentProgress`, and replace the inline `percent: 100` object in `main.ts`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the environment-launch test file. Expected: all tests pass.

### Task 4: Cover process error branches

**Files:**
- Modify: `packages/desktop/src/environment-instance.test.ts`

- [ ] **Step 1: Add the pre-spawn error test**

Emit `error` before `spawn`, assert the original error rejects the wait, and assert `unref` was not
called.

- [ ] **Step 2: Add the signal-exit test**

Emit `spawn` followed by `exit` with `null` code and `SIGTERM`, then assert the error contains
`signal SIGTERM`.

- [ ] **Step 3: Run the instance tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-instance.test.ts
```

Expected: all instance tests pass without production changes.

### Task 5: Verify the complete change

**Files:**
- Verify only

- [ ] **Step 1: Run Desktop type checking and tests**

```bash
pnpm --filter @coder-studio/desktop typecheck
pnpm --filter @coder-studio/desktop test
```

Expected: both commands exit 0.

- [ ] **Step 2: Run renderer regression tests**

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/environment-switcher.test.tsx
```

Expected: all environment switcher tests pass.

- [ ] **Step 3: Run repository verification**

```bash
pnpm ci:verify
```

Expected: formatting, linting, tests, type checking, and production build exit 0.

- [ ] **Step 4: Check the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only scoped tracked changes and the user's pre-existing untracked
documentation files are present.

