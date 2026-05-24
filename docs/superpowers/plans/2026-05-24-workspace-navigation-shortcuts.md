# Workspace Navigation Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop keyboard shortcuts for spatial session navigation with `Ctrl+Arrow` and workspace tab navigation with `Ctrl+Shift+ArrowLeft/ArrowRight`.

**Architecture:** Extend the existing shortcut registry so the new bindings are first-class and visible in settings. Add a desktop workspace navigation hook that resolves configured bindings, uses a pure pane-neighbor helper to find adjacent session targets from the server-backed pane layout tree, and reuses existing workspace/session persistence actions for state updates.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library, shared shortcut settings UI, existing workspace/session persistence hooks, and the server-backed agent pane layout tree.

**Spec reference:** `docs/superpowers/specs/2026-05-24-workspace-navigation-shortcuts-design.md`

---

## File Structure

**Create:**
- `packages/web/src/lib/shortcuts.test.ts` — focused unit coverage for parsing, matching, and formatting explicit `Ctrl+Arrow*` bindings
- `packages/web/src/features/agent-panes/pane-navigation.ts` — pure helpers that derive normalized leaf rectangles and directional neighboring sessions from a `PaneNode`
- `packages/web/src/features/agent-panes/pane-navigation.test.ts` — geometry and directional selection coverage for nested pane layouts
- `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts` — desktop-scoped keydown handler wiring effective shortcut bindings to session/workspace navigation actions
- `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx` — hook-level integration coverage for session/workspace shortcut behavior

**Modify:**
- `packages/web/src/lib/shortcuts.ts` — register new shortcut actions and support explicit `Ctrl` plus arrow-key parsing/formatting/matching
- `packages/web/src/features/settings/components/shortcuts-settings.test.tsx` — ensure the new bindings appear in settings and render with expected text
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` — mount the navigation shortcut hook alongside existing desktop workspace listeners

**Existing files reused without structural changes:**
- `packages/web/src/features/workspace/actions/use-select-workspace-target.ts`
- `packages/web/src/features/workspace/actions/use-persist-workspace-last-viewed-target.ts`
- `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.ts`
- `packages/web/src/features/agent-panes/actions/use-workspace-sessions.ts`
- `packages/web/src/features/agent-panes/atoms/pane-layout.ts`

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/lib/shortcuts.test.ts src/features/settings/components/shortcuts-settings.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-navigation.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx src/features/workspace/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/lib/shortcuts.test.ts src/features/settings/components/shortcuts-settings.test.tsx src/features/agent-panes/pane-navigation.test.ts src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx src/features/workspace/index.test.tsx`

---

### Task 1: Extend Shortcut Registry Coverage

**Files:**
- Create: `packages/web/src/lib/shortcuts.test.ts`
- Modify: `packages/web/src/lib/shortcuts.ts`
- Modify: `packages/web/src/features/settings/components/shortcuts-settings.test.tsx`

- [ ] **Step 1: Write the failing shortcut utility tests**

Create `packages/web/src/lib/shortcuts.test.ts` with:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  matchesShortcut,
  parseShortcut,
} from "./shortcuts";

describe("shortcuts", () => {
  it("parses explicit ctrl arrow bindings", () => {
    expect(parseShortcut("Ctrl+Shift+ArrowLeft")).toEqual({
      modifiers: ["Ctrl", "Shift"],
      key: "ArrowLeft",
    });
  });

  it("matches ctrl arrow bindings without treating bare arrows as a match", () => {
    expect(
      matchesShortcut(
        new KeyboardEvent("keydown", { key: "ArrowLeft", ctrlKey: true }),
        "Ctrl+ArrowLeft"
      )
    ).toBe(true);
    expect(
      matchesShortcut(new KeyboardEvent("keydown", { key: "ArrowLeft" }), "Ctrl+ArrowLeft")
    ).toBe(false);
  });

  it("formats arrow bindings for display", () => {
    vi.stubGlobal("navigator", { platform: "Linux x86_64" });
    expect(formatShortcut("Ctrl+Shift+ArrowRight")).toBe("Ctrl+⇧+→");
    vi.unstubAllGlobals();
  });

  it("registers workspace navigation shortcut definitions", () => {
    expect(DEFAULT_SHORTCUTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "session.navigate.left", defaultBinding: "Ctrl+ArrowLeft" }),
        expect.objectContaining({
          id: "workspace.navigate.next",
          defaultBinding: "Ctrl+Shift+ArrowRight",
        }),
      ])
    );
  });
});
```

- [ ] **Step 2: Write the failing settings rendering test**

Add this case to `packages/web/src/features/settings/components/shortcuts-settings.test.tsx`:

```ts
it("renders the new workspace navigation shortcuts in the settings list", async () => {
  renderShortcutsSettings();

  expect(await screen.findByText("命令面板")).toBeInTheDocument();
  expect(screen.getByText("切换到左侧会话")).toBeInTheDocument();
  expect(screen.getByText("切换到右侧工作区")).toBeInTheDocument();
  expect(screen.getByText("Ctrl+←")).toBeInTheDocument();
  expect(screen.getByText("Ctrl+⇧+→")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the targeted tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/lib/shortcuts.test.ts \
  src/features/settings/components/shortcuts-settings.test.tsx
```

Expected:
- FAIL because `shortcuts.ts` does not yet define the navigation actions or format arrow keys

- [ ] **Step 4: Implement the minimal shortcut registry changes**

Update `packages/web/src/lib/shortcuts.ts` so it:

- adds these definitions inside `DEFAULT_SHORTCUTS` under the `workspace` category:

```ts
{
  id: "session.navigate.left",
  name: "切换到左侧会话",
  description: "切换到当前工作区左侧的会话面板",
  defaultBinding: "Ctrl+ArrowLeft",
  category: "workspace",
},
{
  id: "session.navigate.right",
  name: "切换到右侧会话",
  description: "切换到当前工作区右侧的会话面板",
  defaultBinding: "Ctrl+ArrowRight",
  category: "workspace",
},
{
  id: "session.navigate.up",
  name: "切换到上方会话",
  description: "切换到当前工作区上方的会话面板",
  defaultBinding: "Ctrl+ArrowUp",
  category: "workspace",
},
{
  id: "session.navigate.down",
  name: "切换到下方会话",
  description: "切换到当前工作区下方的会话面板",
  defaultBinding: "Ctrl+ArrowDown",
  category: "workspace",
},
{
  id: "workspace.navigate.previous",
  name: "切换到左侧工作区",
  description: "切换到上一个工作区标签",
  defaultBinding: "Ctrl+Shift+ArrowLeft",
  category: "workspace",
},
{
  id: "workspace.navigate.next",
  name: "切换到右侧工作区",
  description: "切换到下一个工作区标签",
  defaultBinding: "Ctrl+Shift+ArrowRight",
  category: "workspace",
},
```

- extends `formatShortcut` with arrow replacements:

```ts
const formatted = binding
  .replace("ArrowLeft", "←")
  .replace("ArrowRight", "→")
  .replace("ArrowUp", "↑")
  .replace("ArrowDown", "↓");
```

- supports explicit modifier matching in `matchesShortcut`:

```ts
const ctrlPressed = event.ctrlKey;
const metaPressed = event.metaKey;

for (const modifier of modifiers) {
  if (modifier === "Mod" && !(isMac ? metaPressed : ctrlPressed)) return false;
  if (modifier === "Ctrl" && !ctrlPressed) return false;
  if (modifier === "Meta" && !metaPressed) return false;
  if (modifier === "Shift" && !shiftPressed) return false;
  if (modifier === "Alt" && !altPressed) return false;
}
```

- keeps `parseShortcut` unchanged except for preserving arrow-key names as the `key`

- [ ] **Step 5: Run the targeted tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/lib/shortcuts.test.ts \
  src/features/settings/components/shortcuts-settings.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit**

Run:

```bash
git add \
  packages/web/src/lib/shortcuts.ts \
  packages/web/src/lib/shortcuts.test.ts \
  packages/web/src/features/settings/components/shortcuts-settings.test.tsx
git commit -m "feat: register workspace navigation shortcuts"
```

---

### Task 2: Add Spatial Session Neighbor Resolution

**Files:**
- Create: `packages/web/src/features/agent-panes/pane-navigation.ts`
- Create: `packages/web/src/features/agent-panes/pane-navigation.test.ts`

- [ ] **Step 1: Write the failing pane-navigation tests**

Create `packages/web/src/features/agent-panes/pane-navigation.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { PaneNode } from "./atoms/pane-layout";
import { findAdjacentSessionId } from "./pane-navigation";

const twoByTwoLayout: PaneNode = {
  id: "root",
  type: "split",
  direction: "vertical",
  ratio: 0.5,
  children: [
    {
      id: "top",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "top-left", type: "leaf", sessionId: "sess_1" },
        { id: "top-right", type: "leaf", sessionId: "sess_2" },
      ],
    },
    {
      id: "bottom",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "bottom-left", type: "leaf", sessionId: "sess_3" },
        { id: "bottom-right", type: "leaf", sessionId: "sess_4" },
      ],
    },
  ],
};

describe("pane-navigation", () => {
  it("finds horizontal neighbors in a simple split", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_left" },
        { id: "right", type: "leaf", sessionId: "sess_right" },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess_left", "right")).toBe("sess_right");
    expect(findAdjacentSessionId(layout, "sess_right", "left")).toBe("sess_left");
  });

  it("returns null when no candidate exists in the requested direction", () => {
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_1", "up")).toBeNull();
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_4", "right")).toBeNull();
  });

  it("follows visible geometry in a two-by-two layout", () => {
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_1", "right")).toBe("sess_2");
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_1", "down")).toBe("sess_3");
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_4", "left")).toBe("sess_3");
    expect(findAdjacentSessionId(twoByTwoLayout, "sess_4", "up")).toBe("sess_2");
  });

  it("ignores draft leaves when finding the next session", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        {
          id: "right",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [{ id: "draft", type: "leaf" }, { id: "lower", type: "leaf", sessionId: "sess_2" }],
        },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess_1", "right")).toBe("sess_2");
  });
});
```

- [ ] **Step 2: Run the pane-navigation test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-navigation.test.ts
```

Expected:
- FAIL because `pane-navigation.ts` does not exist yet

- [ ] **Step 3: Implement the minimal pane-navigation helper**

Create `packages/web/src/features/agent-panes/pane-navigation.ts` with:

```ts
import type { PaneNode } from "./atoms/pane-layout";

export type PaneDirection = "left" | "right" | "up" | "down";

interface PaneRect {
  id: string;
  sessionId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

function collectPaneRects(
  node: PaneNode,
  left = 0,
  top = 0,
  width = 1,
  height = 1
): PaneRect[] {
  if (node.type === "leaf") {
    if (!node.sessionId) {
      return [];
    }

    const right = left + width;
    const bottom = top + height;
    return [
      {
        id: node.id,
        sessionId: node.sessionId,
        left,
        right,
        top,
        bottom,
        centerX: left + width / 2,
        centerY: top + height / 2,
      },
    ];
  }

  const [first, second] = node.children ?? [];
  if (!first || !second) {
    return [];
  }

  const ratio = node.ratio ?? 0.5;

  if (node.direction === "vertical") {
    const firstHeight = height * ratio;
    const secondHeight = height - firstHeight;
    return [
      ...collectPaneRects(first, left, top, width, firstHeight),
      ...collectPaneRects(second, left, top + firstHeight, width, secondHeight),
    ];
  }

  const firstWidth = width * ratio;
  const secondWidth = width - firstWidth;
  return [
    ...collectPaneRects(first, left, top, firstWidth, height),
    ...collectPaneRects(second, left + firstWidth, top, secondWidth, height),
  ];
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.min(endA, endB) > Math.max(startA, startB);
}

export function findAdjacentSessionId(
  layout: PaneNode,
  activeSessionId: string,
  direction: PaneDirection
): string | null {
  const panes = collectPaneRects(layout);
  const current = panes.find((pane) => pane.sessionId === activeSessionId);
  if (!current) {
    return null;
  }

  const candidates = panes.filter((pane) => {
    if (pane.sessionId === activeSessionId) {
      return false;
    }

    if (direction === "left") return pane.right <= current.left;
    if (direction === "right") return pane.left >= current.right;
    if (direction === "up") return pane.bottom <= current.top;
    return pane.top >= current.bottom;
  });

  if (candidates.length === 0) {
    return null;
  }

  const ranked = candidates.map((pane) => {
    const overlaps =
      direction === "left" || direction === "right"
        ? rangesOverlap(pane.top, pane.bottom, current.top, current.bottom)
        : rangesOverlap(pane.left, pane.right, current.left, current.right);

    const edgeDistance =
      direction === "left"
        ? current.left - pane.right
        : direction === "right"
          ? pane.left - current.right
          : direction === "up"
            ? current.top - pane.bottom
            : pane.top - current.bottom;

    const crossAxisDelta =
      direction === "left" || direction === "right"
        ? Math.abs(pane.centerY - current.centerY)
        : Math.abs(pane.centerX - current.centerX);

    return { pane, overlaps, edgeDistance, crossAxisDelta };
  });

  ranked.sort((a, b) => {
    if (a.overlaps !== b.overlaps) {
      return a.overlaps ? -1 : 1;
    }
    if (a.edgeDistance !== b.edgeDistance) {
      return a.edgeDistance - b.edgeDistance;
    }
    return a.crossAxisDelta - b.crossAxisDelta;
  });

  return ranked[0]?.pane.sessionId ?? null;
}
```

- [ ] **Step 4: Run the pane-navigation test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-navigation.test.ts
```

Expected:
- PASS

- [ ] **Step 5: Commit**

Run:

```bash
git add \
  packages/web/src/features/agent-panes/pane-navigation.ts \
  packages/web/src/features/agent-panes/pane-navigation.test.ts
git commit -m "feat: add spatial pane navigation helper"
```

---

### Task 3: Wire Desktop Navigation Shortcuts

**Files:**
- Create: `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts`
- Create: `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`

- [ ] **Step 1: Write the failing hook tests**

Create `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx` with:

```tsx
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { customShortcutsAtom } from "../../../lib/shortcuts";
import { wsClientAtom } from "../../../atoms/connection";
import { activeWorkspaceIdAtom, workspaceOrderAtom, workspacesAtom } from "../../../atoms/workspaces";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { useWorkspaceNavigationShortcuts } from "./use-workspace-navigation-shortcuts";

function Harness() {
  useWorkspaceNavigationShortcuts("ws-1");
  return <div data-testid="workspace-shortcuts" />;
}

describe("useWorkspaceNavigationShortcuts", () => {
  it("moves to the adjacent session and persists last viewed target", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "workspace.lastViewedTarget.set") {
        return { ...(args as object), updatedAt: 10 };
      }
      if (op === "workspace.uiState.set") {
        return {
          id: "ws-1",
          path: "/tmp/one",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: (args as { uiState: object }).uiState,
        };
      }
      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);
    store.set(customShortcutsAtom, {});
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspaceOrderAtom, ["ws-1", "ws-2"]);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/tmp/one",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false, activeSessionId: "sess_1" },
      },
      "ws-2": {
        id: "ws-2",
        path: "/tmp/two",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
      },
    });
    store.set(paneLayoutAtomFamily("ws-1"), {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    });

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });

    await waitFor(() => {
      expect(store.get(lastViewedTargetAtom)).toMatchObject({
        workspaceId: "ws-1",
        sessionId: "sess_2",
      });
    });
  });

  it("switches to the next workspace on ctrl shift right", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ workspaceId: "ws-2", updatedAt: 10 });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);
    store.set(customShortcutsAtom, {});
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspaceOrderAtom, ["ws-1", "ws-2"]);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/tmp/one",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
      },
      "ws-2": {
        id: "ws-2",
        path: "/tmp/two",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
      },
    });
    store.set(paneLayoutAtomFamily("ws-1"), { id: "root", type: "leaf", sessionId: "sess_1" });

    render(
      <Provider store={store}>
        <Harness />
      </Provider>
    );

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    });
  });
});
```

- [ ] **Step 2: Add the failing desktop workspace integration assertion**

Add this case to `packages/web/src/features/workspace/index.test.tsx`:

```ts
it("uses workspace navigation shortcuts to switch the active workspace", async () => {
  const sendCommand = vi.fn().mockResolvedValue({ workspaceId: "ws-b", updatedAt: 10 });
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);
  store.set(workspacesAtom, {
    "ws-a": {
      id: "ws-a",
      path: "/tmp/a",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
    },
    "ws-b": {
      id: "ws-b",
      path: "/tmp/b",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
    },
  });
  store.set(workspaceOrderAtom, ["ws-a", "ws-b"]);
  store.set(activeWorkspaceIdAtom, "ws-a");

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route path="/workspace" element={<WorkspaceDesktopView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true, shiftKey: true });

  await waitFor(() => {
    expect(store.get(activeWorkspaceIdAtom)).toBe("ws-b");
  });
});
```

- [ ] **Step 3: Run the runtime shortcut tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- FAIL because the navigation hook is not implemented or mounted yet

- [ ] **Step 4: Implement the desktop navigation hook**

Create `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts` with:

```ts
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { activeWorkspaceAtom, orderedWorkspaceIdsAtom } from "../../../atoms/workspaces";
import { customShortcutsAtom, getEffectiveBinding, matchesShortcut } from "../../../lib/shortcuts";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { findAdjacentSessionId, type PaneDirection } from "../../agent-panes/pane-navigation";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";
import { useSelectWorkspaceTarget } from "./use-select-workspace-target";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

const SESSION_DIRECTION_BY_SHORTCUT: Record<string, PaneDirection> = {
  "session.navigate.left": "left",
  "session.navigate.right": "right",
  "session.navigate.up": "up",
  "session.navigate.down": "down",
};

export function useWorkspaceNavigationShortcuts(workspaceId: string) {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const workspaceOrder = useAtomValue(orderedWorkspaceIdsAtom);
  const customBindings = useAtomValue(customShortcutsAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();
  const selectWorkspaceTarget = useSelectWorkspaceTarget();
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);

  useEffect(() => {
    if (!workspaceId || !activeWorkspace || activeWorkspace.id !== workspaceId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const [shortcutId, direction] of Object.entries(SESSION_DIRECTION_BY_SHORTCUT)) {
        const binding = getEffectiveBinding(shortcutId, customBindings);
        if (!binding || !matchesShortcut(event, binding)) {
          continue;
        }

        const activeSessionId = activeWorkspace.uiState.activeSessionId;
        if (!activeSessionId) {
          return;
        }

        const nextSessionId = findAdjacentSessionId(paneLayout, activeSessionId, direction);
        if (!nextSessionId) {
          event.preventDefault();
          return;
        }

        event.preventDefault();
        void persistLastViewedTarget({ workspaceId, sessionId: nextSessionId });
        void persistUiState({ activeSessionId: nextSessionId });
        return;
      }

      const previousBinding = getEffectiveBinding("workspace.navigate.previous", customBindings);
      const nextBinding = getEffectiveBinding("workspace.navigate.next", customBindings);
      const currentIndex = workspaceOrder.indexOf(workspaceId);

      if (previousBinding && matchesShortcut(event, previousBinding) && currentIndex > 0) {
        event.preventDefault();
        void selectWorkspaceTarget(workspaceOrder[currentIndex - 1]!);
        return;
      }

      if (nextBinding && matchesShortcut(event, nextBinding) && currentIndex >= 0) {
        const nextWorkspaceId = workspaceOrder[currentIndex + 1];
        if (!nextWorkspaceId) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        void selectWorkspaceTarget(nextWorkspaceId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeWorkspace,
    customBindings,
    paneLayout,
    persistLastViewedTarget,
    persistUiState,
    selectWorkspaceTarget,
    workspaceId,
    workspaceOrder,
  ]);
}
```

- [ ] **Step 5: Mount the hook in the desktop workspace view**

Update `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`:

```ts
import { useWorkspaceNavigationShortcuts } from "../../actions/use-workspace-navigation-shortcuts";
```

Inside `WorkspaceDesktopScene`, after `useWorkspaceScreenModel()`:

```ts
  useWorkspaceNavigationShortcuts(workspace?.id ?? "__workspace_empty__");
```

- [ ] **Step 6: Run the runtime shortcut tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS

- [ ] **Step 7: Commit**

Run:

```bash
git add \
  packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts \
  packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  packages/web/src/features/workspace/index.test.tsx
git commit -m "feat: wire desktop workspace navigation shortcuts"
```

---

### Task 4: Run Final Focused Verification

**Files:**
- No file changes

- [ ] **Step 1: Run the focused verification bundle**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/lib/shortcuts.test.ts \
  src/features/settings/components/shortcuts-settings.test.tsx \
  src/features/agent-panes/pane-navigation.test.ts \
  src/features/workspace/actions/use-workspace-navigation-shortcuts.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS

- [ ] **Step 2: Review output for regressions**

Confirm the run shows:

- shortcut utility tests passing
- settings shortcut rendering passing
- pane-navigation geometry passing
- workspace navigation shortcut hook passing
- desktop workspace integration passing

- [ ] **Step 3: Commit the plan artifact**

Run:

```bash
git add docs/superpowers/plans/2026-05-24-workspace-navigation-shortcuts.md
git commit -m "docs: add workspace navigation shortcuts implementation plan"
```

---

## Self-Review

### Spec coverage

- shortcut registry and settings visibility: covered in Task 1
- spatial session navigation based on pane geometry: covered in Task 2
- desktop workspace runtime shortcut handling: covered in Task 3
- session state persistence and workspace switching semantics: covered in Task 3
- focused verification: covered in Task 4

### Placeholder scan

The plan avoids `TODO`, `TBD`, and “write tests for the above” style placeholders. Every task includes file paths, concrete test snippets, implementation snippets, and exact commands.

### Type consistency

- `findAdjacentSessionId(layout, activeSessionId, direction)` is introduced in Task 2 and consumed with the same signature in Task 3
- `useWorkspaceNavigationShortcuts(workspaceId)` is defined in Task 3 and mounted with the same single-argument signature in `workspace-desktop-view.tsx`
- shortcut IDs used in tests and runtime match the IDs introduced in Task 1
