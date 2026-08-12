# Update State Activation-Aware Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Desktop update-state hydration from running before the WebSocket activation lease is active, so About receives the Runtime release timestamp.

**Architecture:** Keep activation ownership in `useActivation` and update-controller construction in the existing updates feature. Change only the `AppProviders` lifecycle effect so it reacts to `activationStatus === "active"`; verify the order with a deferred activation claim and verify rehydration after reconnect.

**Tech Stack:** React 19, Jotai, TypeScript, Vitest, Testing Library

---

## File Structure

- Modify `packages/web/src/app/providers.tsx`: gate update-state hydration on active activation status.
- Modify `packages/web/src/app/providers.lifecycle.test.tsx`: add lifecycle regression coverage for delayed activation and reconnect hydration.

### Task 1: Reproduce the startup ordering bug

**Files:**
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write the failing activation-order regression test**

Add a focused lifecycle test that holds `activation.claim` pending and verifies that `updates.getState` is not sent until the claim resolves:

```tsx
it("waits for activation before hydrating update state", async () => {
  const activationClaim = createDeferred<{
    active: true;
    generation: number;
    recoveryMode: "fresh";
  }>();
  const updateState: UpdateStateView = {
    version: 2,
    currentVersion: "0.5.6",
    currentPublishedAt: null,
    latestVersion: null,
    latestPublishedAt: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: false,
    installKind: "unsupported",
    unsupportedReason: "Managed by Coder Studio Desktop",
    runtimeContext: {
      environment: "desktop-managed",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
  };
  wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
    if (op === "activation.claim") return activationClaim.promise;
    if (op === "updates.getState") return updateState;
    return undefined;
  });
  const store = createStore();
  renderProviders(store);

  await vi.waitFor(() => expect(wsState.client?.connect).toHaveBeenCalled());
  act(() => wsState.client?.statusHandler?.("connected"));
  await vi.waitFor(() => {
    expect(wsState.client?.sendCommand).toHaveBeenCalledWith(
      "activation.claim",
      expect.anything()
    );
  });
  expect(
    wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
  ).toHaveLength(0);

  await act(async () => {
    activationClaim.resolve({ active: true, generation: 1, recoveryMode: "fresh" });
    await activationClaim.promise;
  });

  await vi.waitFor(() => {
    expect(wsState.client?.sendCommand).toHaveBeenCalledWith("updates.getState", {}, undefined);
    expect(store.get(serverUpdateStateAtom)).toEqual(updateState);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- providers.lifecycle.test.tsx -t "waits for activation before hydrating update state"
```

Expected: FAIL because the current connection-only effect sends `updates.getState` while `activation.claim` is still pending.

### Task 2: Gate hydration on activation

**Files:**
- Modify: `packages/web/src/app/providers.tsx:500-520`
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Implement the minimal effect guard**

Change the update-state hydration effect to require both a connected socket and an active activation lease:

```tsx
useEffect(() => {
  if (connectionStatus !== "connected" || activationStatus !== "active") {
    return;
  }

  let cancelled = false;

  const hydrateUpdateState = async () => {
    const result = await dispatch<UpdateStateView>("updates.getState", {});
    if (cancelled || !result.ok || !result.data) {
      return;
    }
    setServerUpdateState(result.data);
  };

  void hydrateUpdateState();

  return () => {
    cancelled = true;
  };
}, [activationStatus, connectionStatus, dispatch, setServerUpdateState]);
```

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @coder-studio/web test -- providers.lifecycle.test.tsx -t "waits for activation before hydrating update state"
```

Expected: PASS.

- [ ] **Step 3: Add reconnect regression coverage**

Add a test that connects, waits for the first hydration, transitions through `reconnecting`, reconnects, and expects a second hydration only after activation is active again:

```tsx
it("hydrates update state again after reconnect activation", async () => {
  const updateState: UpdateStateView = {
    version: 2,
    currentVersion: "0.5.6",
    currentPublishedAt: null,
    latestVersion: null,
    latestPublishedAt: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: false,
    installKind: "unsupported",
    unsupportedReason: "Managed by Coder Studio Desktop",
    runtimeContext: {
      environment: "desktop-managed",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
  };
  wsState.client!.sendCommand = createWsSendCommandMock(async (op) =>
    op === "updates.getState" ? updateState : undefined
  );
  const store = createStore();
  renderProviders(store);

  await vi.waitFor(() => expect(wsState.client?.connect).toHaveBeenCalled());
  act(() => wsState.client?.statusHandler?.("connected"));
  await vi.waitFor(() => {
    expect(
      wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
    ).toHaveLength(1);
  });

  act(() => wsState.client?.statusHandler?.("reconnecting"));
  await vi.waitFor(() => expect(store.get(activationStatusAtom)).toBe("idle"));
  act(() => wsState.client?.statusHandler?.("connected"));

  await vi.waitFor(() => {
    expect(
      wsState.client?.sendCommand?.mock.calls.filter(([op]) => op === "updates.getState")
    ).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Make the Desktop bridge regression fixture include the release timestamp**

In the existing `hydrates Desktop-managed Server context before resolving the Desktop controller` test, construct the bridge state with a trusted timestamp:

```tsx
const productState = createDefaultProductUpdateState(
  {
    environment: "desktop-native",
    authority: "desktop",
    supported: true,
    unsupportedReason: null,
  },
  "0.5.6",
  "2026-08-08T15:41:11.000Z"
);
```

Keep the existing equality assertion on `productUpdateStateAtom`; it then verifies that controller hydration preserves `productPublishedAt` from the Desktop IPC state.

- [ ] **Step 5: Run the lifecycle test file**

Run:

```bash
pnpm --filter @coder-studio/web test -- providers.lifecycle.test.tsx
```

Expected: all tests in the file PASS with no unhandled errors.

### Task 3: Verify and commit the fix

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Create: `docs/superpowers/plans/2026-08-09-update-state-activation-hydration.md`

- [ ] **Step 1: Run Web package tests**

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected: all Web tests PASS.

- [ ] **Step 2: Run Web production build**

Run:

```bash
pnpm --filter @coder-studio/web build
```

Expected: Vite build exits successfully.

- [ ] **Step 3: Check formatting and the exact diff**

Run:

```bash
git diff --check
git diff -- packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx docs/superpowers/plans/2026-08-09-update-state-activation-hydration.md
```

Expected: `git diff --check` exits successfully and the diff contains only the planned lifecycle fix, regression tests, and implementation plan.

- [ ] **Step 4: Commit the implementation**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx docs/superpowers/plans/2026-08-09-update-state-activation-hydration.md
git commit -m "fix(web): hydrate updates after activation"
```
