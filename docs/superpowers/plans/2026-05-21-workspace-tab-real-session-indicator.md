# Workspace Tab Real Session Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake desktop workspace tab status dot with a real pane-aware session mini map that shows one solid square per pane, uses theme-backed colors for `running / starting / idle / empty`, and keeps workspace tabs aligned with the existing session bootstrap flow.

**Architecture:** Add a pure topbar mini-map model that projects pane trees into square positions, then layer a presentational component on top of it. Wire `WorkspaceTab` to the existing `useWorkspaceSessions(workspace, { disabled: isActive })` bootstrap path so active tabs use the live runtime pane layout already in memory while inactive tabs hydrate sessions and repaired layouts without introducing a second `session.list` implementation.

**Tech Stack:** React 19, Jotai, TypeScript, Vitest, Testing Library, global CSS tokens in `packages/web/src/styles/tokens.css`, shared component styling in `packages/web/src/styles/components.css`

---

## File Structure

- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map-model.ts`
  Responsibility: Pure state/layout projection from pane trees plus session snapshots into renderable mini-map cells.

- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map-model.test.ts`
  Responsibility: Unit coverage for layout projection, state mapping, and empty fallback behavior.

- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map.tsx`
  Responsibility: Render the projected mini-map cells as fixed-size solid squares with no interaction.

- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx`
  Responsibility: Verify square count, per-cell state classes, and decorative-only semantics.

- Modify: `packages/web/src/features/topbar/components/tab.tsx`
  Responsibility: Remove the fake status dot, reuse `useWorkspaceSessions` for inactive bootstrap, and render the real mini map after the workspace name.

- Modify: `packages/web/src/features/topbar/components/tab.test.tsx`
  Responsibility: Cover active/inactive layout sources, fake-dot removal, inactive one-shot bootstrap, and tab-level mini-map rendering.

- Modify: `packages/web/src/styles/tokens.css`
  Responsibility: Define theme-backed mini-map color tokens.

- Modify: `packages/web/src/styles/components.css`
  Responsibility: Add tab mini-map layout and cell styling rules in the final active topbar override block so duplicate historical selectors do not shadow them.

---

### Task 1: Build the Pure Mini-Map Model

**Files:**
- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map-model.ts`
- Test: `packages/web/src/features/topbar/components/workspace-session-mini-map-model.test.ts`

- [ ] **Step 1: Write the failing model tests**

```ts
import type { Session, WorkspacePaneNode } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSessionMiniMapCells,
  type WorkspaceSessionMiniMapCell,
} from "./workspace-session-mini-map-model";

function createSession(
  id: string,
  state: Session["state"],
  workspaceId = "ws-1"
): Session {
  return {
    id,
    workspaceId,
    terminalId: `term-${id}`,
    providerId: "codex",
    state,
    capability: "full",
    startedAt: 1,
    lastActiveAt: 1,
  };
}

describe("workspace-session-mini-map-model", () => {
  it("projects a single running leaf into the center of the mini map", () => {
    const layout: WorkspacePaneNode = { id: "root", type: "leaf", sessionId: "sess-1" };
    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "running"),
    });

    expect(cells).toEqual<WorkspaceSessionMiniMapCell[]>([
      expect.objectContaining({
        paneId: "root",
        sessionId: "sess-1",
        state: "running",
        x: 0.5,
        y: 0.5,
      }),
    ]);
  });

  it("keeps horizontal and vertical pane relationships while defaulting missing ratios to 0.5", () => {
    const layout = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess-1" },
        {
          id: "right-split",
          type: "split",
          direction: "vertical",
          children: [
            { id: "top-right", type: "leaf", sessionId: "sess-2" },
            { id: "bottom-right", type: "leaf" },
          ],
        },
      ],
    } satisfies WorkspacePaneNode & { ratio?: number };

    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "idle"),
      "sess-2": createSession("sess-2", "starting"),
    });

    expect(cells).toEqual([
      expect.objectContaining({ paneId: "left", state: "idle", x: 0.25, y: 0.5 }),
      expect.objectContaining({ paneId: "top-right", state: "starting", x: 0.75, y: 0.25 }),
      expect.objectContaining({ paneId: "bottom-right", state: "empty", x: 0.75, y: 0.75 }),
    ]);
  });

  it("treats draft, ended, and missing sessions as empty panes", () => {
    const layout: WorkspacePaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "draft-pane", type: "leaf", sessionId: "sess-draft" },
        { id: "ended-pane", type: "leaf", sessionId: "sess-ended" },
      ],
    };

    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-draft": createSession("sess-draft", "draft"),
      "sess-ended": createSession("sess-ended", "ended"),
    });

    expect(cells.map((cell) => [cell.paneId, cell.state])).toEqual([
      ["draft-pane", "empty"],
      ["ended-pane", "empty"],
    ]);
  });

  it("falls back to a single empty root pane when no layout exists", () => {
    expect(buildWorkspaceSessionMiniMapCells(undefined, {})).toEqual([
      expect.objectContaining({
        paneId: "root",
        sessionId: null,
        state: "empty",
        x: 0.5,
        y: 0.5,
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run the new model tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts
```

Expected: FAIL with a module resolution error for `workspace-session-mini-map-model`.

- [ ] **Step 3: Implement the pure layout and state projection utility**

```ts
import type { Session, WorkspacePaneNode } from "@coder-studio/core";

export type WorkspaceSessionMiniMapState = "running" | "starting" | "idle" | "empty";

export interface WorkspaceSessionMiniMapCell {
  readonly paneId: string;
  readonly sessionId: string | null;
  readonly state: WorkspaceSessionMiniMapState;
  readonly x: number;
  readonly y: number;
}

interface PaneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type WorkspacePaneNodeLike = WorkspacePaneNode & {
  readonly ratio?: number;
  readonly children?: WorkspacePaneNodeLike[];
};

export function buildWorkspaceSessionMiniMapCells(
  layout: WorkspacePaneNodeLike | null | undefined,
  sessionsById: Record<string, Session>
): WorkspaceSessionMiniMapCell[] {
  const root: WorkspacePaneNodeLike = layout ?? { id: "root", type: "leaf" };
  return collectCells(root, sessionsById, { x: 0, y: 0, width: 1, height: 1 });
}

function collectCells(
  node: WorkspacePaneNodeLike,
  sessionsById: Record<string, Session>,
  bounds: PaneBounds
): WorkspaceSessionMiniMapCell[] {
  if (node.type !== "split" || !node.children?.length) {
    return [
      {
        paneId: node.id,
        sessionId: node.sessionId ?? null,
        state: resolveCellState(node.sessionId ? sessionsById[node.sessionId] : undefined),
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
    ];
  }

  const [firstChild, secondChild] = node.children;
  if (!firstChild || !secondChild) {
    return collectCells({ ...node, type: "leaf", children: undefined }, sessionsById, bounds);
  }

  const ratio =
    typeof node.ratio === "number" && node.ratio > 0 && node.ratio < 1 ? node.ratio : 0.5;

  if (node.direction === "vertical") {
    return [
      ...collectCells(firstChild, sessionsById, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height * ratio,
      }),
      ...collectCells(secondChild, sessionsById, {
        x: bounds.x,
        y: bounds.y + bounds.height * ratio,
        width: bounds.width,
        height: bounds.height * (1 - ratio),
      }),
    ];
  }

  return [
    ...collectCells(firstChild, sessionsById, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width * ratio,
      height: bounds.height,
    }),
    ...collectCells(secondChild, sessionsById, {
      x: bounds.x + bounds.width * ratio,
      y: bounds.y,
      width: bounds.width * (1 - ratio),
      height: bounds.height,
    }),
  ];
}

function resolveCellState(session: Session | undefined): WorkspaceSessionMiniMapState {
  switch (session?.state) {
    case "running":
      return "running";
    case "starting":
      return "starting";
    case "idle":
      return "idle";
    default:
      return "empty";
  }
}
```

- [ ] **Step 4: Run the model tests again and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts
```

Expected: PASS for all four `workspace-session-mini-map-model` tests.

- [ ] **Step 5: Commit the model utility**

```bash
git add packages/web/src/features/topbar/components/workspace-session-mini-map-model.ts packages/web/src/features/topbar/components/workspace-session-mini-map-model.test.ts
git commit -m "feat: add workspace tab session mini-map model"
```

### Task 2: Build the Presentational Mini-Map Component

**Files:**
- Create: `packages/web/src/features/topbar/components/workspace-session-mini-map.tsx`
- Test: `packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx`
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing component tests**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";

describe("WorkspaceSessionMiniMap", () => {
  it("renders one decorative square per cell with a state-specific class", () => {
    const { container } = render(
      <WorkspaceSessionMiniMap
        cells={[
          { paneId: "left", sessionId: "sess-1", state: "running", x: 0.25, y: 0.5 },
          { paneId: "right", sessionId: null, state: "empty", x: 0.75, y: 0.5 },
        ]}
      />
    );

    expect(screen.getByTestId("workspace-session-mini-map")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".workspace-session-mini-map__cell")).toHaveLength(2);
    expect(container.querySelector(".workspace-session-mini-map__cell--running")).not.toBeNull();
    expect(container.querySelector(".workspace-session-mini-map__cell--empty")).not.toBeNull();
  });

  it("does not expose interactive roles", () => {
    render(
      <WorkspaceSessionMiniMap
        cells={[{ paneId: "root", sessionId: "sess-1", state: "idle", x: 0.5, y: 0.5 }]}
      />
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the component tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map.test.tsx
```

Expected: FAIL with a module resolution error for `workspace-session-mini-map`.

- [ ] **Step 3: Implement the component plus token-backed styling**

```tsx
import type { CSSProperties } from "react";
import type { WorkspaceSessionMiniMapCell } from "./workspace-session-mini-map-model";

interface WorkspaceSessionMiniMapProps {
  readonly cells: WorkspaceSessionMiniMapCell[];
}

export function WorkspaceSessionMiniMap({ cells }: WorkspaceSessionMiniMapProps) {
  return (
    <span
      aria-hidden="true"
      className="workspace-session-mini-map"
      data-testid="workspace-session-mini-map"
    >
      {cells.map((cell) => (
        <span
          key={cell.paneId}
          className={`workspace-session-mini-map__cell workspace-session-mini-map__cell--${cell.state}`}
          style={
            {
              "--workspace-session-map-cell-x": `${cell.x * 100}%`,
              "--workspace-session-map-cell-y": `${cell.y * 100}%`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}
```

```css
/* packages/web/src/styles/tokens.css */
:root {
  --workspace-session-map-running: var(--state-success-text);
  --workspace-session-map-starting: var(--state-warning-text);
  --workspace-session-map-idle: color-mix(in srgb, var(--text-tertiary) 90%, var(--accent-blue) 10%);
  --workspace-session-map-empty: color-mix(in srgb, var(--text-tertiary) 56%, var(--bg-panel) 44%);
}
```

```css
/* packages/web/src/styles/components.css */
.workspace-session-mini-map {
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 12px;
  flex: 0 0 auto;
  margin-left: var(--sp-2);
}

.workspace-session-mini-map__cell {
  position: absolute;
  left: var(--workspace-session-map-cell-x);
  top: var(--workspace-session-map-cell-y);
  width: 4px;
  height: 4px;
  border-radius: 1px;
  transform: translate(-50%, -50%);
  background: var(--workspace-session-map-empty);
}

.workspace-session-mini-map__cell--running {
  background: var(--workspace-session-map-running);
}

.workspace-session-mini-map__cell--starting {
  background: var(--workspace-session-map-starting);
}

.workspace-session-mini-map__cell--idle {
  background: var(--workspace-session-map-idle);
}

.workspace-session-mini-map__cell--empty {
  background: var(--workspace-session-map-empty);
}
```

- [ ] **Step 4: Run the model and component tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts src/features/topbar/components/workspace-session-mini-map.test.tsx
```

Expected: PASS for both topbar mini-map test files.

- [ ] **Step 5: Commit the component and styling**

```bash
git add packages/web/src/features/topbar/components/workspace-session-mini-map.tsx packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx packages/web/src/styles/tokens.css packages/web/src/styles/components.css
git commit -m "feat: add workspace tab session mini-map component"
```

### Task 3: Integrate the Real Mini Map into `WorkspaceTab`

**Files:**
- Modify: `packages/web/src/features/topbar/components/tab.tsx`
- Modify: `packages/web/src/features/topbar/components/tab.test.tsx`

- [ ] **Step 1: Extend `WorkspaceTab` tests to cover the real indicator**

```tsx
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import { sessionsAtom } from "../../../atoms/sessions";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";

it("renders the runtime pane layout for the active workspace instead of the stale persisted layout", () => {
  const workspace = {
    ...createWorkspace("ws-2", "/tmp/two"),
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
      paneLayout: { id: "persisted-root", type: "leaf", sessionId: "sess-persisted" },
    },
  };
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(paneLayoutAtomFamily("ws-2"), {
    id: "runtime-root",
    type: "split",
    direction: "horizontal",
    children: [
      { id: "left", type: "leaf", sessionId: "sess-running" },
      { id: "right", type: "leaf" },
    ],
  });
  store.set(sessionsAtom, {
    "sess-running": {
      id: "sess-running",
      workspaceId: "ws-2",
      terminalId: "term-1",
      providerId: "codex",
      state: "running",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    },
  });

  const { container } = renderWorkspaceTab(store, workspace, { isActive: true, value: "ws-2" });

  expect(container.querySelector(".topbar-dot")).toBeNull();
  expect(container.querySelectorAll(".workspace-session-mini-map__cell")).toHaveLength(2);
  expect(container.querySelector(".workspace-session-mini-map__cell--running")).not.toBeNull();
  expect(container.querySelector(".workspace-session-mini-map__cell--empty")).not.toBeNull();
});

it("bootstraps inactive workspaces once through session.list and repairs ended panes to empty", async () => {
  const workspace = {
    ...createWorkspace("ws-3", "/tmp/three"),
    uiState: {
      leftPanelWidth: 280,
      bottomPanelHeight: 200,
      focusMode: false,
      paneLayout: {
        id: "persisted-root",
        type: "split",
        direction: "vertical",
        children: [
          { id: "top", type: "leaf", sessionId: "sess-starting" },
          { id: "bottom", type: "leaf", sessionId: "sess-ended" },
        ],
      },
    },
  };
  const sendCommand = vi.fn(async (op: string, args?: { workspaceId: string }) => {
    if (op !== "session.list") {
      return undefined;
    }

    expect(args).toEqual({ workspaceId: "ws-3" });
    return [
      {
        id: "sess-starting",
        workspaceId: "ws-3",
        terminalId: "term-2",
        providerId: "codex",
        state: "starting",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
      },
      {
        id: "sess-ended",
        workspaceId: "ws-3",
        terminalId: "term-3",
        providerId: "codex",
        state: "ended",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
        endedAt: 2,
      },
    ];
  });
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand } as never);

  const { container, rerender } = renderWorkspaceTab(store, workspace, { isActive: false, value: "ws-1" });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith("session.list", { workspaceId: "ws-3" }, undefined);
  });

  expect(container.querySelectorAll(".workspace-session-mini-map__cell")).toHaveLength(2);
  expect(container.querySelector(".workspace-session-mini-map__cell--starting")).not.toBeNull();
  expect(container.querySelector(".workspace-session-mini-map__cell--empty")).not.toBeNull();

  rerender(
    <Provider store={store}>
      <Tabs aria-label="Workspaces" onValueChange={vi.fn()} value="ws-1">
        <TabList className="topbar-tablist">
          <WorkspaceTab workspace={workspace} isActive={false} />
        </TabList>
      </Tabs>
    </Provider>
  );

  expect(sendCommand.mock.calls.filter(([op]) => op === "session.list")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tab tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/tab.test.tsx
```

Expected: FAIL because `WorkspaceTab` still renders `.topbar-dot` and does not bootstrap inactive workspace sessions.

- [ ] **Step 3: Implement the tab integration**

```tsx
import { useWorkspaceSessions } from "../../agent-panes/actions/use-workspace-sessions";
import { buildWorkspaceSessionMiniMapCells } from "./workspace-session-mini-map-model";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";

export const WorkspaceTab: FC<WorkspaceTabProps> = ({ workspace, isActive }) => {
  const { paneLayout, sessions } = useWorkspaceSessions(workspace, { disabled: isActive });
  const miniMapCells = buildWorkspaceSessionMiniMapCells(
    paneLayout,
    Object.fromEntries(sessions.map((session) => [session.id, session]))
  );

  return (
    <div className={`topbar-tab-shell ${isActive ? "active" : ""}`} role="presentation">
      <Tab className="topbar-tab" onClick={handleClick} value={workspace.id}>
        <Tooltip content={workspace.path || workspace.id}>
          <span className="topbar-tab-name">{displayName}</span>
        </Tooltip>
        <WorkspaceSessionMiniMap cells={miniMapCells} />
        <Badge count={workspace.unreadCount ?? 0} max={9} />
      </Tab>
      <IconButton
        className="topbar-close"
        aria-label={t("action.close_workspace")}
        icon={<X size={14} />}
        onClick={handleClose}
        size="sm"
      />
    </div>
  );
};
```

- [ ] **Step 4: Run the topbar component tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts src/features/topbar/components/workspace-session-mini-map.test.tsx src/features/topbar/components/tab.test.tsx
```

Expected: PASS for the mini-map model, mini-map component, and `WorkspaceTab` suites.

- [ ] **Step 5: Commit the tab integration**

```bash
git add packages/web/src/features/topbar/components/tab.tsx packages/web/src/features/topbar/components/tab.test.tsx
git commit -m "feat: show real session mini-map in workspace tabs"
```

### Task 4: Fold the Mini-Map Styles into the Final Topbar Override Block

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing style-token assertions**

```ts
it("keeps workspace mini-map cells on shared state tokens in the final topbar override block", () => {
  const miniMap = getLastRuleBlock(".workspace-session-mini-map");
  const miniMapCell = getLastRuleBlock(".workspace-session-mini-map__cell");
  const runningCell = getLastRuleBlock(".workspace-session-mini-map__cell--running");
  const startingCell = getLastRuleBlock(".workspace-session-mini-map__cell--starting");
  const idleCell = getLastRuleBlock(".workspace-session-mini-map__cell--idle");
  const emptyCell = getLastRuleBlock(".workspace-session-mini-map__cell--empty");

  expect(miniMap).toContain("margin-left: var(--sp-2)");
  expect(miniMapCell).toContain("background: var(--workspace-session-map-empty)");
  expect(runningCell).toContain("background: var(--workspace-session-map-running)");
  expect(startingCell).toContain("background: var(--workspace-session-map-starting)");
  expect(idleCell).toContain("background: var(--workspace-session-map-idle)");
  expect(emptyCell).toContain("background: var(--workspace-session-map-empty)");
});
```

- [ ] **Step 2: Run the style theme tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: FAIL because the mini-map selectors do not yet exist in the final topbar override block.

- [ ] **Step 3: Add the mini-map rules to the final topbar override block**

```css
.workspace-session-mini-map {
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 12px;
  flex: 0 0 auto;
  margin-left: var(--sp-2);
}

.workspace-session-mini-map__cell {
  position: absolute;
  left: var(--workspace-session-map-cell-x);
  top: var(--workspace-session-map-cell-y);
  width: 4px;
  height: 4px;
  border-radius: 1px;
  transform: translate(-50%, -50%);
  background: var(--workspace-session-map-empty);
}

.workspace-session-mini-map__cell--running {
  background: var(--workspace-session-map-running);
}

.workspace-session-mini-map__cell--starting {
  background: var(--workspace-session-map-starting);
}

.workspace-session-mini-map__cell--idle {
  background: var(--workspace-session-map-idle);
}

.workspace-session-mini-map__cell--empty {
  background: var(--workspace-session-map-empty);
}
```

- [ ] **Step 4: Run the component, tab, and style theme tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts src/features/topbar/components/workspace-session-mini-map.test.tsx src/features/topbar/components/tab.test.tsx src/styles/components.theme.test.ts
```

Expected: PASS for the mini-map model, mini-map component, `WorkspaceTab`, and shared style theme assertions.

- [ ] **Step 5: Commit the style integration**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "test: cover workspace tab mini-map theme tokens"
```

### Task 5: Final Verification and Cleanup

**Files:**
- Verify only: `packages/web/src/features/topbar/components/*`
- Verify only: `packages/web/src/features/agent-panes/actions/use-workspace-sessions.ts`
- Verify only: `packages/web/src/styles/components.css`
- Verify only: `packages/web/src/styles/tokens.css`
- Verify only: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run the focused topbar test suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/workspace-session-mini-map-model.test.ts src/features/topbar/components/workspace-session-mini-map.test.tsx src/features/topbar/components/tab.test.tsx src/styles/components.theme.test.ts
```

Expected: PASS for all focused topbar suites with no failing assertions.

- [ ] **Step 2: Run package type-checking for the web app**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run Biome checks on the touched files**

Run:

```bash
pnpm exec biome check packages/web/src/features/topbar/components/workspace-session-mini-map-model.ts packages/web/src/features/topbar/components/workspace-session-mini-map-model.test.ts packages/web/src/features/topbar/components/workspace-session-mini-map.tsx packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx packages/web/src/features/topbar/components/tab.tsx packages/web/src/features/topbar/components/tab.test.tsx packages/web/src/styles/components.css packages/web/src/styles/tokens.css packages/web/src/styles/components.theme.test.ts
```

Expected: PASS with no diagnostics.

- [ ] **Step 4: Review the final diff for scope**

Run:

```bash
git diff -- packages/web/src/features/topbar/components/tab.tsx packages/web/src/features/topbar/components/tab.test.tsx packages/web/src/styles/components.css packages/web/src/styles/tokens.css packages/web/src/styles/components.theme.test.ts
```

Expected: The diff only shows the fake-dot removal, mini-map rendering, theme tokens, `WorkspaceTab` bootstrap wiring, and the final-block style assertions described in the spec.

- [ ] **Step 5: Commit any verification fixups and the finished feature**

```bash
git add packages/web/src/features/topbar/components/tab.tsx packages/web/src/features/topbar/components/tab.test.tsx packages/web/src/styles/components.css packages/web/src/styles/tokens.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat: replace fake workspace tab dot with real session indicator"
```

---

## Self-Review

### Spec Coverage

- Fake dot removal: Task 3
- Real pane-aware mini map after workspace name: Tasks 2 and 3
- One solid square per pane including empty panes: Tasks 1 and 2
- Theme-backed `running / starting / idle / empty` colors: Tasks 2 and 4
- Active workspace runtime layout vs inactive persisted layout: Task 3
- Non-active workspace session bootstrap through existing `session.list` flow: Task 3
- No tooltip / no interaction / no animation: Task 2 plus Task 3 assertions
- Final-block style placement so later topbar overrides do not shadow the mini map: Task 4
- Focused test coverage and verification: Task 5

No uncovered spec requirement remains.

### Placeholder Scan

- No `TBD`, `TODO`, or “similar to previous task” shortcuts remain.
- Every task has exact file paths, commands, and concrete code snippets.
- Every code-bearing step includes the exact code to add or modify.

### Type Consistency

- Mini-map cell states are consistently named `running / starting / idle / empty`.
- The pure builder is consistently named `buildWorkspaceSessionMiniMapCells`.
- `WorkspaceTab` consistently reuses `useWorkspaceSessions(workspace, { disabled: isActive })` for inactive bootstrap.

No type or naming mismatch remains between tasks.
