# Mobile-Friendly Phase 5A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit websocket foreground/network recovery and surface clearer mobile recovery states without changing desktop layout behavior.

**Architecture:** Extend `WsClient` with tracked connection status plus an explicit recovery method, let `AppProviders` trigger that method from browser lifecycle events, and expose the resulting reconnect/disconnected/rejected states through a compact mobile recovery strip while keeping desktop banners unchanged.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + Testing Library, vanilla CSS, existing websocket singleton bootstrap in `AppProviders`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5a-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md`

---

## File Structure

**New files:**
- `packages/web/src/app/providers.lifecycle.test.tsx` — focused lifecycle recovery coverage for `AppProviders`

**Modified files:**
- `packages/web/src/ws/client.ts` — tracked status and explicit foreground/network recovery method
- `packages/web/src/ws/__tests__/client.test.ts` — recovery-entry-point coverage
- `packages/web/src/app/providers.tsx` — singleton status sync plus `visibilitychange` / `online` handlers
- `packages/web/src/shells/mobile-shell/index.tsx` — compact mobile recovery strip
- `packages/web/src/shells/mobile-shell/mobile-topbar.tsx` — preserve/clarify mobile status labels
- `packages/web/src/shells/mobile-shell/index.test.tsx` — mobile recovery UI coverage
- `packages/web/src/styles/components.css` — mobile recovery strip styling

**No changes in 5A:**
- server websocket protocol
- desktop route/layout structure
- landscape/safe-area compaction
- animation tuning

---

## Task 1: Write Failing Tests for Recovery Entry Points and Mobile Recovery UI

**Files:**
- Modify: `packages/web/src/ws/__tests__/client.test.ts`
- Create: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Add a failing websocket recovery test**

Append a test that:

- starts a client
- simulates socket close so auto-reconnect is scheduled
- calls the new explicit recovery API before the timer fires
- verifies the pending timer is bypassed and a second websocket is created immediately

This should fail because `WsClient` does not currently expose a recovery API.

- [ ] **Step 2: Add a failing status-tracking regression test**

Append a test that:

- closes the socket to enter reconnect flow
- asserts `client.getStatus()` returns `reconnecting`

This should fail because `getStatus()` currently only reflects raw socket readyState.

- [ ] **Step 3: Create `providers.lifecycle.test.tsx` with failing visibility/online recovery tests**

Create focused tests that:

- mock `WsClient`
- mount `AppProviders`
- set the mocked client status to `disconnected`
- dispatch `visibilitychange` with `document.visibilityState = 'visible'`
- assert the client recovery API was called with a visibility reason

Then add a second test for `window.dispatchEvent(new Event('online'))`.

These should fail because `AppProviders` does not currently subscribe to those browser events.

- [ ] **Step 4: Add a failing mobile recovery-strip test**

Append a shell test that seeds:

- `connectionStatusAtom = 'reconnecting'`
- `reconnectAttemptCountAtom = 2`

Then assert the mobile shell renders recovery copy such as `正在恢复连接` and `已尝试 2 次`.

Add another assertion path for `disconnected` copy if needed.

This should fail because mobile shell currently only shows the generic fixed reconnect banner.

---

## Task 2: Implement the Minimal Recovery Behavior to Turn Tests Green

**Files:**
- Modify: `packages/web/src/ws/client.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/shells/mobile-shell/mobile-topbar.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add tracked status and explicit recovery to `WsClient`**

Implement:

- an internal `status` field updated by `setStatus()`
- `getStatus()` returning that tracked field
- a public recovery method that cancels pending backoff and reconnects immediately when status is unhealthy

Keep the implementation minimal:

- no-op on `connected`, `connecting`, or `rejected`
- reset reconnect budget before forced recovery
- reuse existing `connect()` and logging paths

- [ ] **Step 2: Wire browser lifecycle recovery in `AppProviders`**

Add browser lifecycle listeners that:

- on visible foreground: ask the current client to recover
- on `online`: ask the current client to recover
- sync current client status when reusing the singleton client

Keep cleanup aligned with the existing provider lifecycle.

- [ ] **Step 3: Add mobile recovery-strip rendering**

In mobile shell:

- replace the desktop-style reconnect banner for mobile recovery states with a compact inline strip
- show reconnect attempt count when reconnecting
- show clear disconnected/rejected copy

Keep the current routes and workspace scaffold intact.

- [ ] **Step 4: Add minimal CSS for the new strip**

Add focused styling for:

- compact recovery strip container
- warning/error variants
- copy layout that fits within the existing mobile shell rhythm

Do not mix in landscape/safe-area changes from `5B`.

---

## Task 3: Verify, Refactor, and Commit `5A`

**Files:**
- All files changed in Tasks 1-2

- [ ] **Step 1: Run focused tests for the changed areas**

Run:

```bash
pnpm --dir packages/web test src/ws/__tests__/client.test.ts src/app/providers.lifecycle.test.tsx src/shells/mobile-shell/index.test.tsx
```

Confirm the new tests fail first, then pass after implementation.

- [ ] **Step 2: Run broader Phase 5A verification**

Run:

```bash
pnpm --dir packages/web test src/shells/desktop-shell.test.tsx src/app/providers.test.tsx
pnpm lint
git diff --check
```

This verifies:

- desktop shell reconnect/auth behavior still passes
- existing provider routing tests still pass
- lint and patch formatting remain clean

- [ ] **Step 3: Commit `5A`**

Create one implementation commit after verification, for example:

```bash
git add docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5a-design.md \
        docs/superpowers/plans/2026-05-01-mobile-friendly-phase-5a.md \
        packages/web/src/ws/client.ts \
        packages/web/src/ws/__tests__/client.test.ts \
        packages/web/src/app/providers.tsx \
        packages/web/src/app/providers.lifecycle.test.tsx \
        packages/web/src/shells/mobile-shell/index.tsx \
        packages/web/src/shells/mobile-shell/mobile-topbar.tsx \
        packages/web/src/shells/mobile-shell/index.test.tsx \
        packages/web/src/styles/components.css
git commit -m "feat: recover mobile connections on foreground resume"
```

---

## Definition of Done

- `WsClient` supports explicit foreground/network recovery
- `AppProviders` resumes recovery on foreground and network return
- mobile shell surfaces reconnect/disconnected/rejected state clearly
- focused and regression tests pass
- lint and `git diff --check` pass
