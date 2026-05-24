# Supervisor Refresh Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an existing in-memory supervisor reappears after a web refresh or websocket reconnect without changing the current design that server restarts do not restore supervisor runtime.

**Architecture:** Reintroduce client-side supervisor hydration as an explicit read of the server's current runtime snapshot via `supervisor.get`. Trigger hydration per mounted full-capability session when the client is connected, dedupe it with a per-session hydration marker, and clear that marker when the websocket reconnects or the server instance changes so the next connected state re-fetches authoritative runtime state.

**Tech Stack:** React, Jotai, Vitest, existing websocket command/event routing

---

## File Structure

- Modify: `packages/web/src/features/supervisor/actions/use-supervisor.ts`
  - Expand the hook from dialog-only behavior into dialog + runtime hydration behavior.
- Modify: `packages/web/src/features/supervisor/atoms.ts`
  - Keep the existing per-session hydration marker and add any minimal reset helper atom only if needed.
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
  - Replace the current "does not hydrate" expectation with refresh-hydration expectations.
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
  - Add a reconnect/server-instance regression test that proves hydration markers reset after reconnect.
- Modify: `packages/web/src/app/providers.tsx`
  - Reset supervisor hydration markers when connection state/server identity indicates the client must re-fetch runtime snapshot.
- Optional modify: `packages/web/src/app/providers.test.tsx`
  - Add atom-routing level coverage if a helper/reset path is implemented there.

## Semantics To Preserve

- `supervisor.get` is for client refresh/reconnect hydration against the current live server runtime.
- `supervisor.get` is **not** the mechanism for server restart runtime recovery.
- A server restart may still legitimately result in no active supervisor runtime; the UI should then reflect that after hydration returns `null`.
- Existing push-driven `supervisor.state` updates remain the primary live update path; hydration only fills the cold-start / reconnect gap.

### Task 1: Lock Down Expected Behavior In SessionCard Tests

**Files:**
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`

- [ ] **Step 1: Write the failing test for initial hydration**

Add a test near the existing supervisor coverage that renders a running full-capability session and expects a `supervisor.get` command on mount:

```tsx
  it("hydrates supervisor state via supervisor.get when a full session card mounts", async () => {
    const { store, sendCommand } = createSessionStore({
      state: "running",
      capability: "full",
      endedAt: undefined,
      terminalId: "term-live",
    });

    sendCommand.mockImplementation(async (op: string) => {
      if (op === "supervisor.get") {
        return { supervisor: null };
      }

      return undefined;
    });

    render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "supervisor.get",
        { sessionId: "sess_123456" },
        undefined
      );
    });
  });
```

- [ ] **Step 2: Write the failing test for deduped hydration**

Add a second test proving a rerender does not spam `supervisor.get` once the session is marked hydrated:

```tsx
  it("hydrates a mounted session only once per hydration cycle", async () => {
    const { store, sendCommand } = createSessionStore({
      state: "running",
      capability: "full",
      endedAt: undefined,
      terminalId: "term-live",
    });

    sendCommand.mockImplementation(async (op: string) => {
      if (op === "supervisor.get") {
        return { supervisor: null };
      }

      return undefined;
    });

    const view = render(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
    });

    view.rerender(
      <Provider store={store}>
        <SessionCard sessionId="sess_123456" />
      </Provider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run the focused test file to verify failure**

Run: `pnpm --filter web test -- packages/web/src/features/agent-panes/components/session-card.test.tsx`

Expected: FAIL because the current implementation explicitly does not call `supervisor.get`.

- [ ] **Step 4: Commit the failing-test checkpoint**

```bash
git add packages/web/src/features/agent-panes/components/session-card.test.tsx
git commit -m "test: capture supervisor refresh hydration regression"
```

### Task 2: Implement Client-Side Supervisor Hydration

**Files:**
- Modify: `packages/web/src/features/supervisor/actions/use-supervisor.ts`
- Modify: `packages/web/src/features/supervisor/atoms.ts`

- [ ] **Step 1: Implement hydration-aware useSupervisor hook**

Update `useSupervisor.ts` so the hook:
- reads `connectionStatusAtom`, `dispatchCommandAtom`, `supervisorsAtom`, and `supervisorHydratedAtomFamily(sessionId)`
- only hydrates when the session exists, is `capability === "full"`, is not `draft`/`ended`, and connection is `connected`
- marks the session as hydrated before/around the request to prevent duplicate in-flight requests
- writes the returned supervisor into `supervisorsAtom` when non-null
- removes any stale entry for that session when the response returns `null`
- keeps the existing dialog API unchanged

Target shape:

```ts
import type { Session, Supervisor } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { connectionStatusAtom, dispatchCommandAtom } from "../../../atoms/connection";
import { supervisorDialogAtom, supervisorHydratedAtomFamily, supervisorsAtom } from "../atoms";
import { formatScheduledAtInput } from "./use-objective-dialog-state";

const EMPTY_SESSION_ID = "__supervisor-empty__";

export function useSupervisor(session: Session | null | undefined) {
  const sessionId = session?.id ?? EMPTY_SESSION_ID;
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const hydrated = useAtomValue(supervisorHydratedAtomFamily(sessionId));
  const setHydrated = useSetAtom(supervisorHydratedAtomFamily(sessionId));
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);

  useEffect(() => {
    if (!session) {
      return;
    }
    if (session.capability !== "full") {
      return;
    }
    if (session.state === "draft" || session.state === "ended") {
      return;
    }
    if (connectionStatus !== "connected" || hydrated) {
      return;
    }

    let cancelled = false;
    setHydrated(true);

    void dispatch<{ supervisor: Supervisor | null }>("supervisor.get", { sessionId: session.id })
      .then((result) => {
        if (cancelled || !result.ok) {
          return;
        }

        setSupervisors((prev) => {
          const next = new Map(prev);
          if (result.data?.supervisor) {
            next.set(session.id, result.data.supervisor);
          } else {
            next.delete(session.id);
          }
          return next;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, dispatch, hydrated, session, setHydrated, setSupervisors]);

  // existing openDialog callback remains
}
```

- [ ] **Step 2: Keep atom changes minimal**

If `supervisorHydratedAtomFamily` is sufficient as-is, do not introduce new atom structures. Only adjust `packages/web/src/features/supervisor/atoms.ts` if you need a tiny helper such as a resettable atom family export or a documented comment update:

```ts
// Tracks whether the current client connection has already fetched supervisor.get
// for this session. Reset when reconnecting to the server.
export const supervisorHydratedAtomFamily = atomFamily((_sessionId: string) => atom(false));
```

- [ ] **Step 3: Run the focused SessionCard tests to verify green**

Run: `pnpm --filter web test -- packages/web/src/features/agent-panes/components/session-card.test.tsx`

Expected: PASS with the new hydration expectations.

- [ ] **Step 4: Commit the implementation checkpoint**

```bash
git add packages/web/src/features/supervisor/actions/use-supervisor.ts packages/web/src/features/supervisor/atoms.ts packages/web/src/features/agent-panes/components/session-card.test.tsx
git commit -m "fix: hydrate supervisor state after refresh"
```

### Task 3: Reset Hydration On Reconnect / Server Identity Change

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write the failing lifecycle regression test**

Add a lifecycle test proving that after one successful hydration cycle, a reconnect or server instance replacement resets the hydration marker so a subsequent mounted session can fetch again.

Suggested test pattern:

```tsx
  it("clears supervisor hydration markers after reconnect so sessions can rehydrate", async () => {
    const store = createStore();
    const sendCommand = createWsSendCommandMock(async (op) => {
      if (op === "supervisor.get") {
        return { supervisor: null };
      }
      return undefined;
    });

    wsState.client = {
      ...wsState.client!,
      sendCommand,
    };

    renderProviders(store);

    act(() => {
      store.set(connectionStatusAtom, "connected");
      store.set(sessionsAtom, {
        "sess-1": {
          id: "sess-1",
          workspaceId: "ws-1",
          terminalId: "term-1",
          providerId: "codex",
          state: "running",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        },
      });
    });

    // mount path that calls useSupervisor, or directly render SessionCard under Provider
    // assert first hydration call

    act(() => {
      wsState.client?.statusHandler?.("reconnecting");
      wsState.client?.eventHandler?.(
        "connection.status",
        {
          status: "connected",
          version: "0.4.0",
          serverInstanceId: "server-2",
          authEnabled: false,
        },
        1
      );
      wsState.client?.statusHandler?.("connected");
    });

    // remount or trigger effect again and assert supervisor.get is called a second time
  });
```

If the existing lifecycle harness is awkward for `SessionCard`, render a minimal `<Provider><SessionCard ... /></Provider>` inside this file after the provider setup. The core assertion is that reconnect resets the per-session hydration gate.

- [ ] **Step 2: Run the lifecycle test to confirm it fails**

Run: `pnpm --filter web test -- packages/web/src/app/providers.lifecycle.test.tsx`

Expected: FAIL because hydration markers currently never reset.

- [ ] **Step 3: Implement hydration reset in AppProviders**

In `packages/web/src/app/providers.tsx`, add a small effect that observes connection lifecycle/server metadata and clears the per-session hydration marker when the client must distrust previous hydration:

- track the last connected `serverInstanceId`
- when connection transitions away from `connected`, or when a new `connected` metadata event carries a different `serverInstanceId`, set every currently known session's `supervisorHydratedAtomFamily(sessionId)` back to `false`
- do **not** clear `supervisorsAtom` eagerly; let `supervisor.get` refresh authoritative state and remove stale entries if the runtime no longer exists

One acceptable implementation shape:

```ts
import { supervisorHydratedAtomFamily } from "../features/supervisor/atoms";

const lastSupervisorHydrationServerIdRef = useRef<string | null>(null);

useEffect(() => {
  if (connectionStatus !== "connected") {
    for (const session of Object.values(store.get(sessionsAtom))) {
      store.set(supervisorHydratedAtomFamily(session.id), false);
    }
    lastSupervisorHydrationServerIdRef.current = null;
    return;
  }

  const currentServerId = store.get(serverInfoAtom)?.serverInstanceId ?? null;
  const previousServerId = lastSupervisorHydrationServerIdRef.current;
  if (previousServerId && currentServerId && previousServerId !== currentServerId) {
    for (const session of Object.values(store.get(sessionsAtom))) {
      store.set(supervisorHydratedAtomFamily(session.id), false);
    }
  }

  if (currentServerId) {
    lastSupervisorHydrationServerIdRef.current = currentServerId;
  }
}, [connectionStatus, store, sessions]);
```

Refine the exact dependency shape to avoid re-running on every session mutation; the important part is deterministic reset on disconnect/reconnect/server replacement, not per-render churn.

- [ ] **Step 4: Run lifecycle tests to verify green**

Run: `pnpm --filter web test -- packages/web/src/app/providers.lifecycle.test.tsx`

Expected: PASS, proving reconnect/server replacement opens a new hydration cycle.

- [ ] **Step 5: Commit the reconnect-reset checkpoint**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx
git commit -m "fix: rehydrate supervisor state after reconnect"
```

### Task 4: Regression Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the targeted supervisor-related unit suite**

Run:

```bash
pnpm --filter web test -- \
  packages/web/src/features/agent-panes/components/session-card.test.tsx \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/features/supervisor/components/supervisor-card.test.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run the websocket resync/server tests to confirm no accidental contract change**

Run:

```bash
pnpm --filter server test -- packages/server/src/__tests__/ws-hub.test.ts
```

Expected: PASS, with no requirement to emit `supervisor.state` during resync.

- [ ] **Step 3: Optional higher-confidence browser regression**

Run if time permits:

```bash
pnpm --filter e2e test -- e2e/specs/supervisor/lifecycle.spec.ts
```

Expected: PASS. If no dedicated refresh scenario exists yet, capture that gap in follow-up notes rather than expanding scope in this fix.

- [ ] **Step 4: Commit the verification checkpoint**

```bash
git add .
git commit -m "test: verify supervisor refresh hydration fix"
```

## Recommended Approach

Prefer the client-side `supervisor.get` hydration path over changing websocket resync:

- Smallest behavioral change.
- Aligns with the already documented issue and existing `supervisorHydratedAtomFamily`.
- Preserves the current server contract that resync only replays workspace/session state.
- Avoids broadening websocket replay semantics for every reconnecting client.

## Explicit Non-Goals

- Do not restore supervisor runtime after a server restart.
- Do not change `supervisor.get` into a persisted-history lookup.
- Do not add speculative localStorage persistence for supervisor UI state.
- Do not bundle unrelated supervisor dialog or mobile UI cleanup into this fix.

## Self-Review

- Spec coverage: covers initial refresh hydration, reconnect/server-instance reset, and regression verification.
- Placeholder scan: all tasks include concrete files, commands, and expected outcomes.
- Type consistency: uses existing `Session`, `Supervisor`, `dispatchCommandAtom`, `supervisorsAtom`, and `supervisorHydratedAtomFamily` names from the current codebase.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-supervisor-refresh-hydration.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
