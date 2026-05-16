# Workspace Last Viewed Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the last viewed workspace/session target on the server so desktop and mobile restore the correct location after refresh or on another device.

**Architecture:** Store one global last-viewed target in `user_settings` under a dedicated command path, then hydrate that target during workspace bootstrap before the app resolves the active workspace. Desktop restores only the workspace tab, while mobile restores the workspace first and then the session inside that workspace using the saved target with existing `uiState.activeSessionId` fallback rules.

**Tech Stack:** TypeScript, React, Jotai, React Router, Vitest, Playwright, Zod, existing `user_settings` storage

---

## File Structure

- Modify: `packages/core/src/domain/types.ts`
  - Add a shared `WorkspaceLastViewedTarget` type so server and web code use the same shape.
- Modify: `packages/core/src/index.ts`
  - Re-export the new shared type.
- Modify: `packages/server/src/commands/workspace-activity.ts`
  - Add dedicated read/write commands for the global last-viewed target near existing workspace activity commands.
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`
  - Add command-level coverage for writing and reading the last-viewed target.
- Modify: `packages/web/src/hooks/use-bootstrap.ts`
  - Hydrate the saved target during workspace bootstrap and resolve the initial active workspace before the ready state is exposed.
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
  - Cover bootstrap hydration behavior and fallback cases.
- Modify: `packages/web/src/features/topbar/components/tab.tsx`
  - Persist the workspace target when a desktop workspace tab is selected.
- Modify: `packages/web/src/features/topbar/components/tab.test.tsx`
  - Verify clicking a tab writes the server-backed target.
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  - Persist workspace + session when a desktop session card is selected.
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
  - Verify session card clicks write the global target alongside workspace UI state.
- Modify: `packages/web/src/features/notifications/focus-session.ts`
  - Extend the focus helper so notification-driven focus can also persist the target.
- Modify: `packages/web/src/features/notifications/focus-session.test.ts`
  - Verify focus writes without breaking current navigation behavior.
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
  - Persist a workspace-only target when a workspace is opened and activated.
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx`
  - Persist a workspace-only target when mobile switches workspace.
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
  - Persist workspace + session when mobile switches session.
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
  - Apply the global session target on mobile before falling back to `workspace.uiState.activeSessionId`.
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
  - Cover mobile restore and writeback behavior.
- Modify: `e2e/specs/workspace/route-history.spec.ts`
  - Add desktop refresh/cross-instance workspace restore coverage.
- Modify: `e2e/specs/sessions/hydrate-refresh.spec.ts`
  - Add mobile refresh restore coverage using the global target.

### Task 1: Add server commands and shared target type

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/commands/workspace-activity.ts`
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`

- [ ] **Step 1: Write the failing server command test for writing and reading the target**

```ts
it("persists and returns the global workspace last-viewed target", async () => {
  const dir = join(tmpdir(), `workspace-target-test-${Date.now()}`);
  await mkdir(dir);

  const openResult = await dispatch(
    {
      kind: "command",
      id: "open-workspace-target",
      op: "workspace.open",
      args: { path: dir },
    },
    ctx
  );

  expect(openResult.ok).toBe(true);
  const workspaceId = (openResult.data as { id: string }).id;

  const writeResult = await dispatch(
    {
      kind: "command",
      id: "set-last-viewed-target",
      op: "workspace.lastViewedTarget.set",
      args: {
        workspaceId,
        sessionId: "sess-123",
      },
    },
    ctx
  );

  expect(writeResult.ok).toBe(true);
  expect(writeResult.data).toMatchObject({
    workspaceId,
    sessionId: "sess-123",
  });

  const readResult = await dispatch(
    {
      kind: "command",
      id: "get-last-viewed-target",
      op: "workspace.lastViewedTarget.get",
      args: {},
    },
    ctx
  );

  expect(readResult.ok).toBe(true);
  expect(readResult.data).toMatchObject({
    workspaceId,
    sessionId: "sess-123",
  });
});
```

- [ ] **Step 2: Run the server command test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/__tests__/workspace-commands.test.ts --testNamePattern "persists and returns the global workspace last-viewed target"`

Expected: FAIL with unknown operation errors for `workspace.lastViewedTarget.set` / `workspace.lastViewedTarget.get`

- [ ] **Step 3: Add the shared target type**

```ts
export interface WorkspaceLastViewedTarget {
  workspaceId: string;
  sessionId?: string;
  updatedAt: number;
}
```

Also re-export it from `packages/core/src/index.ts` through the existing `export * from "./domain/types";` surface.

- [ ] **Step 4: Implement the new server commands in `workspace-activity.ts`**

```ts
import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const WORKSPACE_LAST_VIEWED_TARGET_KEY = "workspace.lastViewedTarget";

registerCommand("workspace.lastViewedTarget.get", z.object({}), async (_args, ctx) => {
  return (ctx.db
    .prepare("SELECT value FROM user_settings WHERE key = ?")
    .get(WORKSPACE_LAST_VIEWED_TARGET_KEY) as { value: string } | undefined)
    ? JSON.parse(
        (
          ctx.db
            .prepare("SELECT value FROM user_settings WHERE key = ?")
            .get(WORKSPACE_LAST_VIEWED_TARGET_KEY) as { value: string }
        ).value
      )
    : null;
});

registerCommand(
  "workspace.lastViewedTarget.set",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found: ${args.workspaceId}`,
      };
    }

    const session =
      args.sessionId !== undefined ? ctx.sessionMgr.get(args.sessionId) : undefined;

    const nextTarget: WorkspaceLastViewedTarget = {
      workspaceId: args.workspaceId,
      sessionId:
        session && session.workspaceId === args.workspaceId ? session.id : undefined,
      updatedAt: Date.now(),
    };

    ctx.db
      .prepare(
        `
          INSERT INTO user_settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(WORKSPACE_LAST_VIEWED_TARGET_KEY, JSON.stringify(nextTarget));

    return nextTarget;
  }
);
```

Implementation note: avoid the duplicated `SELECT` shown above in the plan snippet when you code it; read once into a variable and parse once.

- [ ] **Step 5: Add a validation test for missing workspace and mismatched session**

```ts
it("drops an out-of-workspace session id while preserving the workspace target", async () => {
  const dir = join(tmpdir(), `workspace-target-mismatch-${Date.now()}`);
  await mkdir(dir);

  const openResult = await dispatch(
    {
      kind: "command",
      id: "open-workspace-target-mismatch",
      op: "workspace.open",
      args: { path: dir },
    },
    ctx
  );

  const workspaceId = (openResult.data as { id: string }).id;

  const result = await dispatch(
    {
      kind: "command",
      id: "set-last-viewed-target-mismatch",
      op: "workspace.lastViewedTarget.set",
      args: {
        workspaceId,
        sessionId: "sess-missing",
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    workspaceId,
    sessionId: undefined,
  });
});
```

- [ ] **Step 6: Run the server command tests to verify they pass**

Run: `pnpm exec vitest run packages/server/src/__tests__/workspace-commands.test.ts`

Expected: PASS with the new last-viewed-target tests included

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/domain/types.ts packages/core/src/index.ts packages/server/src/commands/workspace-activity.ts packages/server/src/__tests__/workspace-commands.test.ts
git commit -m "feat: add workspace last viewed target commands"
```

### Task 2: Hydrate the saved workspace during bootstrap

**Files:**
- Modify: `packages/web/src/hooks/use-bootstrap.ts`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write the failing bootstrap hydration test**

```ts
it("hydrates the saved last-viewed workspace before exposing the workspace list as ready", async () => {
  const store = createStore();
  const sendCommand = createWsSendCommandMock(async (op) => {
    if (op === "workspace.list") {
      return [
        {
          id: "ws-1",
          path: "/tmp/ws-1",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
        },
        {
          id: "ws-2",
          path: "/tmp/ws-2",
          targetRuntime: "native",
          openedAt: 2,
          lastActiveAt: 2,
          uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
        },
      ];
    }

    if (op === "workspace.lastViewedTarget.get") {
      return {
        workspaceId: "ws-2",
        updatedAt: 10,
      };
    }

    return undefined;
  });

  wsState.client = {
    ...wsState.client!,
    sendCommand,
  };

  renderProviders(store);

  await vi.waitFor(() => {
    expect(store.get(workspacesLoadStateAtom)).toBe("ready");
  });

  expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
});
```

- [ ] **Step 2: Run the lifecycle test to verify it fails**

Run: `pnpm exec vitest run packages/web/src/app/providers.lifecycle.test.tsx --testNamePattern "hydrates the saved last-viewed workspace before exposing the workspace list as ready"`

Expected: FAIL because `activeWorkspaceIdAtom` still resolves to the first workspace

- [ ] **Step 3: Update `useBootstrap` to fetch and apply the saved target during workspace bootstrap**

```ts
const [listResult, targetResult] = await Promise.all([
  dispatch<Workspace[]>("workspace.list", {}),
  dispatch<WorkspaceLastViewedTarget | null>("workspace.lastViewedTarget.get", {}),
]);

if (!listResult.ok) {
  setWorkspacesLoadState("error");
  setWorkspacesLoadError(listResult.error?.message ?? "Failed to fetch workspace list");
  return;
}

const nextWorkspaces = Array.isArray(listResult.data) ? listResult.data : [];
const wsMap: Record<string, Workspace> = {};
for (const workspace of nextWorkspaces) {
  wsMap[workspace.id] = workspace;
}

setWorkspaces(wsMap);
setWorkspaceOrder(nextWorkspaces.map((workspace) => workspace.id));

const savedTarget = targetResult.ok ? targetResult.data : null;
if (savedTarget?.workspaceId && wsMap[savedTarget.workspaceId]) {
  setActiveWorkspaceId(savedTarget.workspaceId);
}

setWorkspacesLoadState("ready");
setWorkspacesLoadError(null);
```

Also add `setActiveWorkspaceId` to the hook and only apply the saved workspace before the ready state is published, so `/workspace` does not flash through the first workspace.

- [ ] **Step 4: Add fallback tests for missing targets and missing workspaces**

```ts
it("ignores a saved target when the workspace no longer exists", async () => {
  const store = createStore();
  const sendCommand = createWsSendCommandMock(async (op) => {
    if (op === "workspace.list") {
      return [
        {
          id: "ws-1",
          path: "/tmp/ws-1",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
        },
      ];
    }

    if (op === "workspace.lastViewedTarget.get") {
      return {
        workspaceId: "ws-missing",
        updatedAt: 10,
      };
    }

    return undefined;
  });

  wsState.client = {
    ...wsState.client!,
    sendCommand,
  };

  renderProviders(store);

  await vi.waitFor(() => {
    expect(store.get(workspacesLoadStateAtom)).toBe("ready");
  });

  expect(store.get(activeWorkspaceIdAtom)).toBeNull();
});
```

- [ ] **Step 5: Run the lifecycle test file to verify it passes**

Run: `pnpm exec vitest run packages/web/src/app/providers.lifecycle.test.tsx`

Expected: PASS with the new bootstrap hydration coverage

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/hooks/use-bootstrap.ts packages/web/src/app/providers.lifecycle.test.tsx
git commit -m "feat: hydrate last viewed workspace during bootstrap"
```

### Task 3: Persist desktop workspace and session focus changes

**Files:**
- Modify: `packages/web/src/features/topbar/components/tab.tsx`
- Modify: `packages/web/src/features/topbar/components/tab.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/features/notifications/focus-session.ts`
- Modify: `packages/web/src/features/notifications/focus-session.test.ts`

- [ ] **Step 1: Write the failing desktop tab persistence test**

```ts
it("persists the global last-viewed workspace target when a tab is clicked", async () => {
  const workspace = createWorkspace("ws-2", "/tmp/two");
  const sendCommand = vi.fn().mockResolvedValue({
    workspaceId: "ws-2",
    updatedAt: 10,
  });
  const store = createStore();

  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand } as never);

  renderWorkspaceTab(store, workspace, { value: "ws-1" });

  fireEvent.click(screen.getByRole("tab", { name: /two/i }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2" },
      undefined
    );
  });
});
```

- [ ] **Step 2: Run the tab test to verify it fails**

Run: `pnpm exec vitest run packages/web/src/features/topbar/components/tab.test.tsx --testNamePattern "persists the global last-viewed workspace target when a tab is clicked"`

Expected: FAIL because the component currently never dispatches the new command

- [ ] **Step 3: Update `WorkspaceTab` to persist the workspace-only target**

```ts
const dispatch = useAtomValue(dispatchCommandAtom);

const handleClick = () => {
  setActiveWorkspace(workspace.id);
  void dispatch("workspace.lastViewedTarget.set", {
    workspaceId: workspace.id,
  });
};
```

- [ ] **Step 4: Add the failing desktop session-card persistence test**

```ts
it("persists the global last-viewed target when the session card body is clicked", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "workspace.uiState.set") {
      return {
        id: "ws-1",
        path: "/tmp/ws-1",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          activeSessionId: "sess_123456",
        },
      };
    }

    if (op === "workspace.lastViewedTarget.set") {
      return {
        workspaceId: "ws-1",
        sessionId: "sess_123456",
        updatedAt: 10,
      };
    }

    return undefined;
  });

  // existing renderSessionCard setup...

  fireEvent.click(screen.getByTestId("session-card-click-target"));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      {
        workspaceId: "ws-1",
        sessionId: "sess_123456",
      },
      undefined
    );
  });
});
```

- [ ] **Step 5: Run the session-card test to verify it fails**

Run: `pnpm exec vitest run packages/web/src/features/agent-panes/components/session-card.test.tsx --testNamePattern "persists the global last-viewed target when the session card body is clicked"`

Expected: FAIL because `workspace.lastViewedTarget.set` is not dispatched

- [ ] **Step 6: Update `SessionCard` to persist the global target without disturbing current `uiState` writes**

```ts
const dispatch = useAtomValue(dispatchCommandAtom);

const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
  // existing guard clauses...

  void dispatch("workspace.lastViewedTarget.set", {
    workspaceId: session.workspaceId,
    sessionId: session.id,
  });
  void persistUiState({ activeSessionId: session.id });
};
```

- [ ] **Step 7: Extend notification focus to persist the target**

```ts
export interface FocusSessionOptions {
  workspaceId: string;
  sessionId: string;
  setPendingFocus: (sessionId: string | null) => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  persistLastViewedTarget?: (target: { workspaceId: string; sessionId: string }) => void;
  navigate?: (path: string) => void;
}

export function focusSession(opts: FocusSessionOptions): void {
  const {
    workspaceId,
    sessionId,
    setPendingFocus,
    setActiveWorkspaceId,
    persistLastViewedTarget,
    navigate,
  } = opts;

  persistLastViewedTarget?.({ workspaceId, sessionId });
  setActiveWorkspaceId(workspaceId);
  setPendingFocus(sessionId);
  // existing navigation logic...
}
```

Update the tests so they assert `persistLastViewedTarget` is called and existing navigation behavior remains unchanged.

- [ ] **Step 8: Run the three focused desktop/unit test files**

Run: `pnpm exec vitest run packages/web/src/features/topbar/components/tab.test.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/features/notifications/focus-session.test.ts`

Expected: PASS with the new persistence coverage

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/features/topbar/components/tab.tsx packages/web/src/features/topbar/components/tab.test.tsx packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/features/notifications/focus-session.ts packages/web/src/features/notifications/focus-session.test.ts
git commit -m "feat: persist desktop workspace and session focus"
```

### Task 4: Persist and restore mobile workspace/session focus

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Write the failing mobile restore test**

```ts
it("prefers the saved global session target when the mobile workspace restores", async () => {
  const store = createStore();
  seedReadyWorkspaceState(store, {
    "ws-1": {
      id: "ws-1",
      path: "/tmp/ws-1",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
        activeSessionId: "sess-1",
      },
    },
  });
  store.set(activeWorkspaceIdAtom, "ws-1");
  store.set(sessionsAtom, {
    "sess-1": createSession({ id: "sess-1", terminalId: "term-1", providerId: "claude" }),
    "sess-2": createSession({ id: "sess-2", terminalId: "term-2", providerId: "codex" }),
  });

  window.localStorage.clear();

  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "workspace.lastViewedTarget.get") {
      return {
        workspaceId: "ws-1",
        sessionId: "sess-2",
        updatedAt: 10,
      };
    }
    return undefined;
  });

  store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);

  renderMobileShell(store);

  await waitFor(() => {
    expect(screen.getByText("sess-2")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the mobile shell test to verify it fails**

Run: `pnpm exec vitest run packages/web/src/shells/mobile-shell/index.test.tsx --testNamePattern "prefers the saved global session target when the mobile workspace restores"`

Expected: FAIL because mobile currently restores only `workspace.uiState.activeSessionId` / recent-session fallback

- [ ] **Step 3: Add a small shared helper inside `use-workspace-screen-model.ts` for selecting the preferred mobile session**

```ts
function resolvePreferredMobileSessionId(
  orderedSessions: Session[],
  globalTargetSessionId: string | null,
  workspaceUiStateSessionId: string | null
) {
  if (globalTargetSessionId && orderedSessions.some((session) => session.id === globalTargetSessionId)) {
    return globalTargetSessionId;
  }

  if (workspaceUiStateSessionId && orderedSessions.some((session) => session.id === workspaceUiStateSessionId)) {
    return workspaceUiStateSessionId;
  }

  const mostRecentSession = [...orderedSessions].sort(
    (left, right) => right.lastActiveAt - left.lastActiveAt
  )[0];

  return mostRecentSession?.id ?? orderedSessions[0]?.id ?? null;
}
```

Then update the existing mobile restore effect to prefer the saved global target session for the active workspace.

- [ ] **Step 4: Persist workspace-only or workspace+session targets from mobile entry points**

```ts
// use-workspace-launch-actions.ts
if (result.ok && result.data?.id) {
  void dispatch("workspace.lastViewedTarget.set", {
    workspaceId: result.data.id,
  });
  setActiveWorkspaceId(result.data.id);
  // existing optimistic workspace updates...
}
```

```ts
// mobile-workspace-drawer.tsx
const dispatch = useAtomValue(dispatchCommandAtom);

onClick={() => {
  void dispatch("workspace.lastViewedTarget.set", {
    workspaceId: workspace.id,
  });
  setActiveWorkspaceId(workspace.id);
  navigate("/workspace");
  onClose();
}}
```

```ts
// mobile-agent-sheet.tsx
const dispatch = useAtomValue(dispatchCommandAtom);

onSelect={(id) => {
  if (mode === "sessions") {
    if (activeWorkspaceId) {
      void dispatch("workspace.lastViewedTarget.set", {
        workspaceId: activeWorkspaceId,
        sessionId: id,
      });
    }
    onSelectSession(id);
    closeSheet();
    return;
  }

  return launch(id as "claude" | "codex");
}}
```

- [ ] **Step 5: Add mobile tests for workspace switch and session switch persistence**

```ts
it("persists a workspace-only target when the mobile drawer switches workspace", async () => {
  const sendCommand = vi.fn().mockResolvedValue({
    workspaceId: "ws-2",
    updatedAt: 10,
  });

  // existing mobile shell render setup...

  await user.click(screen.getByRole("button", { name: /switch to workspace beta/i }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2" },
      undefined
    );
  });
});
```

- [ ] **Step 6: Run the mobile shell test file to verify it passes**

Run: `pnpm exec vitest run packages/web/src/shells/mobile-shell/index.test.tsx`

Expected: PASS with restore and writeback coverage

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx packages/web/src/features/workspace/actions/use-workspace-screen-model.ts packages/web/src/shells/mobile-shell/index.test.tsx
git commit -m "feat: persist and restore mobile workspace targets"
```

### Task 5: Add end-to-end refresh regression coverage

**Files:**
- Modify: `e2e/specs/workspace/route-history.spec.ts`
- Modify: `e2e/specs/sessions/hydrate-refresh.spec.ts`

- [ ] **Step 1: Write the failing desktop E2E restore assertion**

```ts
test("refresh restores the previously selected workspace tab", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

  await page.locator(".topbar-tab").nth(1).click();
  await expect(page.locator(".topbar-tab.active")).toContainText("older-workspace");

  await page.reload();

  await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".topbar-tab.active")).toContainText("older-workspace");
});
```

- [ ] **Step 2: Run the desktop E2E spec to verify it fails**

Run: `pnpm exec playwright test e2e/specs/workspace/route-history.spec.ts --grep "refresh restores the previously selected workspace tab"`

Expected: FAIL because refresh returns to the first workspace

- [ ] **Step 3: Write the failing mobile E2E restore assertion**

```ts
test("mobile restores the globally saved session target after refresh", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();

  await page.addInitScript(() => {
    window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  });

  await page.goto("/workspace");
  await expect(page.getByTestId("workspace-resolving-shell")).toHaveCount(0, { timeout: 20000 });

  await expect(page.getByText("sess-mobile-2")).toBeVisible();
  await page.reload();
  await expect(page.getByText("sess-mobile-2")).toBeVisible();

  await context.close();
});
```

- [ ] **Step 4: Run the mobile E2E spec to verify it fails**

Run: `pnpm exec playwright test e2e/specs/sessions/hydrate-refresh.spec.ts --grep "mobile restores the globally saved session target after refresh"`

Expected: FAIL because mobile restore still relies only on local in-memory active workspace state

- [ ] **Step 5: Implement any test fixture seeding needed for the new target key**

```ts
db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)")
  .run(
    "workspace.lastViewedTarget",
    JSON.stringify({
      workspaceId: "ws-target",
      sessionId: "sess-mobile-2",
      updatedAt: Date.now(),
    })
  );
```

Use this only in the E2E fixtures that need deterministic restore behavior.

- [ ] **Step 6: Run both E2E specs to verify they pass**

Run: `pnpm exec playwright test e2e/specs/workspace/route-history.spec.ts e2e/specs/sessions/hydrate-refresh.spec.ts`

Expected: PASS with desktop workspace restore and mobile session restore coverage

- [ ] **Step 7: Commit**

```bash
git add e2e/specs/workspace/route-history.spec.ts e2e/specs/sessions/hydrate-refresh.spec.ts
git commit -m "test: cover workspace target restore across refresh"
```

## Self-Review

- Spec coverage:
  - global server-backed target in `user_settings`: Task 1
  - bootstrap restore before first-workspace fallback: Task 2
  - desktop restores workspace tab only: Tasks 2, 3, 5
  - mobile restores workspace then session: Tasks 2, 4, 5
  - explicit write triggers only: Tasks 3 and 4
  - no schema migration: Task 1 uses existing `user_settings`
- Placeholder scan:
  - No `TODO` / `TBD` placeholders remain.
  - Each task includes concrete files, commands, and expected results.
- Type consistency:
  - Shared type name is `WorkspaceLastViewedTarget`.
  - Command names are `workspace.lastViewedTarget.get` and `workspace.lastViewedTarget.set`.
  - The saved payload shape is consistently `{ workspaceId, sessionId?, updatedAt }`.
