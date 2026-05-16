# Offline Recovery Vs Session Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep normal websocket recovery on the current route with a top banner, and reserve `/session-gate` for explicit displacement only.

**Architecture:** Narrow activation semantics so reconnect and claim failures no longer mark the app as gated. Track slow recovery from connection timestamps already stored in atoms, and render the second-line hint from the shared connection banner while preserving explicit displacement routing.

**Tech Stack:** React, Jotai, React Router, Vitest, Testing Library

---

## File Structure

- Modify: `packages/web/src/hooks/use-activation.ts`
  - Stop setting activation to `gated` for reconnect and claim failures.
- Modify: `packages/web/src/app/providers.tsx`
  - Keep explicit displacement handling as the only source of activation gating.
  - Reset reconnect counters/timestamps on successful connect so banner timing can recover cleanly.
- Modify: `packages/web/src/shells/shared/connection-status-banner.tsx`
  - Render the unified reconnect message and delayed slow-recovery hint.
- Create: `packages/web/src/shells/shared/connection-status-banner.test.tsx`
  - Focused banner behavior tests without going through the full shell.
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
  - Add regression coverage for reconnect and claim failures staying on the current route/state.
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
  - Update banner copy expectation and keep explicit gated routing coverage.

### Task 1: Freeze The Routing And Activation Regression In Tests

**Files:**
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`

- [ ] **Step 1: Write the failing provider lifecycle regression tests**

Add tests that prove reconnect and claim failures do not gate activation:

```tsx
  it("does not gate activation when websocket reconnect fails", async () => {
    const store = createStore();
    wsState.client!.connect = vi.fn().mockRejectedValue(new Error("connect failed"));

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).not.toBe("gated");
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });

  it("does not gate activation when activation.claim fails", async () => {
    const store = createStore();
    wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
      if (op === "activation.claim") {
        throw new Error("claim failed");
      }
      return undefined;
    });

    renderProviders(store);

    await vi.waitFor(() => {
      expect(wsState.client?.connect).toHaveBeenCalled();
    });

    act(() => {
      wsState.client?.statusHandler?.("connected");
    });

    await vi.waitFor(() => {
      expect(store.get(activationStatusAtom)).not.toBe("gated");
      expect(store.get(activationReasonAtom)).toBeNull();
    });
  });
```

- [ ] **Step 2: Write the failing desktop banner copy test**

Update the shell assertion to the new primary line:

```tsx
  it("shows the reconnecting banner on desktop", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "reconnecting");
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    renderShell(store);

    expect(screen.getByText("连接已断开，正在重新连接...")).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the focused regression tests to verify they fail**

Run:

```bash
pnpm vitest run packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/shells/desktop-shell.test.tsx
```

Expected:

- FAIL because `useActivation` still writes `gated` on reconnect or claim failure
- FAIL because the banner still renders `正在重新连接...`

- [ ] **Step 4: Commit the failing-test checkpoint**

Do not commit yet. This checkpoint exists only to enforce red before green.

### Task 2: Add Banner-Level Slow Recovery Tests

**Files:**
- Create: `packages/web/src/shells/shared/connection-status-banner.test.tsx`
- Test: `packages/web/src/shells/shared/connection-status-banner.test.tsx`

- [ ] **Step 1: Write the failing banner tests**

Create focused tests for the new copy and delayed hint:

```tsx
import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
  connectionStatusAtom,
  lastReconnectAttemptAtom,
} from "../../atoms/connection";
import { ConnectionStatusBanner } from "./connection-status-banner";

function renderBanner(now = Date.now()) {
  vi.setSystemTime(now);
  const store = createStore();
  return {
    store,
    ...render(
      <Provider store={store}>
        <ConnectionStatusBanner />
      </Provider>
    ),
  };
}

describe("ConnectionStatusBanner", () => {
  it("renders the unified reconnect message while reconnecting", () => {
    const { store } = renderBanner();
    store.set(connectionStatusAtom, "reconnecting");

    expect(screen.getByText("连接已断开，正在重新连接...")).toBeInTheDocument();
  });

  it("shows the slow recovery hint after 25 seconds", () => {
    const startedAt = new Date("2026-05-14T00:00:00.000Z").getTime();
    const { store } = renderBanner(startedAt + 25_000);
    store.set(connectionStatusAtom, "reconnecting");
    store.set(lastReconnectAttemptAtom, startedAt);

    expect(
      screen.getByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).toBeInTheDocument();
  });

  it("does not show the slow recovery hint before the threshold", () => {
    const startedAt = new Date("2026-05-14T00:00:00.000Z").getTime();
    const { store } = renderBanner(startedAt + 24_000);
    store.set(connectionStatusAtom, "reconnecting");
    store.set(lastReconnectAttemptAtom, startedAt);

    expect(
      screen.queryByText("连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。")
    ).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the banner tests to verify they fail**

Run:

```bash
pnpm vitest run packages/web/src/shells/shared/connection-status-banner.test.tsx
```

Expected:

- FAIL because the banner does not yet render the new primary line
- FAIL because the slow-recovery secondary hint is not implemented

- [ ] **Step 3: Commit the failing-test checkpoint**

Do not commit yet. This checkpoint exists only to enforce red before green.

### Task 3: Implement Minimal Activation Semantics Fix

**Files:**
- Modify: `packages/web/src/hooks/use-activation.ts`
- Modify: `packages/web/src/app/providers.tsx`

- [ ] **Step 1: Remove reconnect/claim failure gating from `useActivation`**

Change the failure branches so they stop writing `gated` and leave displacement ownership to explicit revoke handling:

```tsx
    if (connectionStatus !== "connected") {
      try {
        await wsClient.connect();
      } catch {
        setReason(null);
        return false;
      }
    }

    setStatus("claiming");

    const pending = wsClient
      .sendCommand<ActivationClaimPayload>("activation.claim", {
        clientInstanceId,
      })
      .then((result) => {
        setGeneration(result.generation);
        setReason(null);
        setStatus("active");
        return true;
      })
      .catch(() => {
        setReason(null);
        if (status !== "gated") {
          setStatus("idle");
        }
        return false;
      })
```

Use the functional setter form if needed to avoid stale closures:

```tsx
        setStatus((current) => (current === "gated" ? current : "idle"));
```

- [ ] **Step 2: Reset reconnect timing state on successful connect in `AppProviders`**

When status becomes `connected`, clear reconnect progress so the banner hint disappears on recovery:

```tsx
      if (status === "connected") {
        setReconnectCount(0);
        setLastReconnect(null);
        syncWorkspaceActivity(true);
      }
```

Keep the existing increment behavior for `reconnecting`:

```tsx
      if (status === "reconnecting") {
        setReconnectCount((count) => count + 1);
        setLastReconnect((previous) => previous ?? Date.now());
      }
```

- [ ] **Step 3: Run the provider lifecycle regressions**

Run:

```bash
pnpm vitest run packages/web/src/app/providers.lifecycle.test.tsx
```

Expected:

- PASS for the new reconnect and claim regression tests
- PASS for the existing explicit `activation.revoked` gating test

- [ ] **Step 4: Refactor only if needed**

Keep production edits minimal. Do not rename atoms or widen the status model in this task.

### Task 4: Implement The Banner Copy And Slow Recovery Hint

**Files:**
- Modify: `packages/web/src/shells/shared/connection-status-banner.tsx`
- Create: `packages/web/src/shells/shared/connection-status-banner.test.tsx`

- [ ] **Step 1: Update the banner component to read reconnect timing atoms**

Import the reconnect timestamp atom and compute the hint threshold inline:

```tsx
import { useAtomValue } from "jotai";
import {
  connectionStatusAtom,
  lastReconnectAttemptAtom,
} from "../../atoms/connection";

const SLOW_RECOVERY_HINT_MS = 25_000;

export function ConnectionStatusBanner() {
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const lastReconnectAttempt = useAtomValue(lastReconnectAttemptAtom);

  if (connectionStatus === "connected" || connectionStatus === "connecting") {
    return null;
  }

  const showRecoveryHint =
    lastReconnectAttempt !== null &&
    Date.now() - lastReconnectAttempt >= SLOW_RECOVERY_HINT_MS &&
    (connectionStatus === "reconnecting" || connectionStatus === "disconnected");

  if (connectionStatus === "rejected") {
    return (
      <div className="connection-banner connection-banner--error" role="status" aria-live="polite">
        <span>另一个标签页已激活</span>
      </div>
    );
  }

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span>连接已断开，正在重新连接...</span>
      {showRecoveryHint ? (
        <span>连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。</span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Run the focused banner tests**

Run:

```bash
pnpm vitest run packages/web/src/shells/shared/connection-status-banner.test.tsx packages/web/src/shells/desktop-shell.test.tsx
```

Expected:

- PASS for unified reconnect copy
- PASS for delayed slow-recovery hint
- PASS for existing desktop shell routing coverage

- [ ] **Step 3: Commit the implementation**

```bash
git add \
  packages/web/src/hooks/use-activation.ts \
  packages/web/src/app/providers.tsx \
  packages/web/src/shells/shared/connection-status-banner.tsx \
  packages/web/src/shells/shared/connection-status-banner.test.tsx \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  docs/superpowers/plans/2026-05-14-offline-recovery-vs-session-gate.md
git commit -m "fix(web): keep offline recovery out of session gate"
```

### Task 5: Final Verification

**Files:**
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`
- Test: `packages/web/src/shells/shared/connection-status-banner.test.tsx`
- Test: `packages/web/src/shells/desktop-shell.test.tsx`

- [ ] **Step 1: Run the full targeted verification set**

Run:

```bash
pnpm vitest run \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/shells/shared/connection-status-banner.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx
```

Expected:

- PASS with 0 failures

- [ ] **Step 2: Review spec coverage**

Confirm the implementation covers:

- reconnect failure stays on current route
- claim failure stays on current route
- explicit displacement still routes to `session-gate`
- banner shows the unified reconnect message
- slow-recovery hint appears after the threshold and clears on recovery

- [ ] **Step 3: Report actual verification evidence**

Record the exact command and result in the final handoff. Do not claim completion without the fresh `pnpm vitest run ...` output.
