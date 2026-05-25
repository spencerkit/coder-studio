# Session Pane Drag Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add desktop-only session pane drag-and-drop so a session pane can be dragged by a header handle and dropped onto another pane to swap sessions or insert left/right/top/bottom around the target.

**Architecture:** Keep the existing binary split tree and server-backed `workspace.uiState.paneLayout`. Implement pure tree mutations first, then expose drag-specific pane actions, then add a workspace-scoped drag controller that uses pane `DOMRect` hit testing instead of `event.target`, and finally wire the controller into `AgentPanes`, `SessionCard`, and `DraftLauncher` with overlay feedback. `paneId` remains the stable layout identity and `center` drop swaps or fills `sessionId` content without changing `paneId`.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, Playwright, existing `agent-panes` feature CSS in `components.css`

**Spec reference:** `docs/superpowers/specs/2026-05-24-session-pane-drag-reorder-design.md`

---

## File Structure

**New files:**
- `packages/web/src/features/agent-panes/actions/pane-drag-types.ts`
- `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts`
- `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.test.tsx`
- `e2e/specs/sessions/pane-drag-reorder.spec.ts`

**Modified files:**
- `packages/web/src/features/agent-panes/pane-layout-tree.ts`
- `packages/web/src/features/agent-panes/pane-layout-tree.test.ts`
- `packages/web/src/features/agent-panes/actions/use-pane-actions.ts`
- `packages/web/src/features/agent-panes/index.tsx`
- `packages/web/src/features/agent-panes/index.test.tsx`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx`
- `packages/web/src/styles/components.css`

**No changes in this plan:**
- `packages/web/src/features/agent-panes/views/shared/pane-layout.tsx`
- mobile pane interactions
- cross-workspace drag/drop
- split ratio persistence format
- backend APIs or workspace data contracts

## Shared Implementation Rules

- Drag starts only from a dedicated handle rendered inside `SessionCard` header actions.
- Draft panes are never drag sources.
- Session panes accept `left`, `right`, `top`, `bottom`, and `center`.
- Draft panes accept only `center`.
- `center` over a session pane swaps `sessionId` values only.
- `center` over a draft pane moves the source session into the draft leaf and removes the source leaf from its old path.
- Edge insertions always remove the source first, then wrap the target leaf in a fresh `split` with `ratio: 0.5`.
- `paneId` is always used to resolve source and target leaves.

### Task 1: Add Tree Drag Mutations And Unit Tests

**Files:**
- Modify: `packages/web/src/features/agent-panes/pane-layout-tree.ts`
- Modify: `packages/web/src/features/agent-panes/pane-layout-tree.test.ts`

- [ ] **Step 1: Write the failing tree tests for swap, draft move, edge insert, and no-op cases**

Add these focused cases to `packages/web/src/features/agent-panes/pane-layout-tree.test.ts`:

```ts
import {
  insertPaneAtEdge,
  moveSessionToDraftPane,
  swapPaneSessionsByPaneId,
} from "./pane-layout-tree";

it("swaps session ids between two session panes without changing pane ids", () => {
  const layout: PaneNode = {
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf", sessionId: "sess_2" },
    ],
  };

  expect(swapPaneSessionsByPaneId(layout, "left", "right")).toEqual({
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_2" },
      { id: "right", type: "leaf", sessionId: "sess_1" },
    ],
  });
});

it("moves a session into a draft leaf and collapses the old source branch", () => {
  const layout: PaneNode = {
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      {
        id: "left-split",
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          { id: "left-top", type: "leaf", sessionId: "sess_1" },
          { id: "left-bottom", type: "leaf", sessionId: "sess_2" },
        ],
      },
      { id: "right", type: "leaf" },
    ],
  };

  expect(moveSessionToDraftPane(layout, "left-bottom", "right")).toEqual({
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left-top", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf", sessionId: "sess_2" },
    ],
  });
});

it("wraps the target leaf with a horizontal split on left insert", () => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);

  const layout: PaneNode = {
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf", sessionId: "sess_2" },
    ],
  };

  expect(insertPaneAtEdge(layout, "left", "right", "left")).toEqual({
    id: "split-right-left-1700000000000",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf", sessionId: "sess_2" },
    ],
  });
});

it("returns the original tree when attempting to drag onto the same pane", () => {
  const layout: PaneNode = {
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf", sessionId: "sess_2" },
    ],
  };

  expect(insertPaneAtEdge(layout, "left", "left", "left")).toBe(layout);
  expect(swapPaneSessionsByPaneId(layout, "left", "left")).toBe(layout);
});

it("rejects draft edge insertion and preserves the input layout", () => {
  const layout: PaneNode = {
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf" },
    ],
  };

  expect(insertPaneAtEdge(layout, "left", "right", "right")).toBe(layout);
});
```

- [ ] **Step 2: Run the tree tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-layout-tree.test.ts
```

Expected: FAIL with missing exports such as `swapPaneSessionsByPaneId` and `insertPaneAtEdge`.

- [ ] **Step 3: Implement the pure helper layer in `pane-layout-tree.ts`**

Add deterministic helper signatures and the minimum recursive helpers needed for extract, rewrite, and wrap:

```ts
type PaneDropPlacement = "left" | "right" | "top" | "bottom" | "center";

interface ExtractLeafResult {
  nextTree: PaneNode;
  extractedLeaf: PaneNode | null;
}

function findLeafByPaneId(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.id === paneId ? node : null;
  }

  for (const child of node.children ?? []) {
    const match = findLeafByPaneId(child, paneId);
    if (match) {
      return match;
    }
  }

  return null;
}

function removeLeafByPaneId(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") {
    return node.id === paneId ? null : node;
  }

  const nextChildren = (node.children ?? [])
    .map((child) => removeLeafByPaneId(child, paneId))
    .filter((child): child is PaneNode => child !== null);

  if (nextChildren.length === node.children?.length) {
    return node;
  }

  if (nextChildren.length === 0) {
    return null;
  }

  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

function replaceLeafByPaneId(
  node: PaneNode,
  paneId: string,
  factory: (target: PaneNode) => PaneNode
): PaneNode {
  if (node.type === "leaf") {
    return node.id === paneId ? factory(node) : node;
  }

  let changed = false;
  const nextChildren = (node.children ?? []).map((child) => {
    const nextChild = replaceLeafByPaneId(child, paneId, factory);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  return changed ? { ...node, children: nextChildren } : node;
}

function createDragSplitId(parentId: string, targetPaneId: string, placement: Exclude<PaneDropPlacement, "center">): string {
  return `split-${targetPaneId}-${placement}-${Date.now()}`;
}
```

Then add the drag mutations:

```ts
export function swapPaneSessionsByPaneId(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target?.sessionId) {
    return node;
  }

  const withSource = replaceLeafByPaneId(node, sourcePaneId, (leaf) => ({
    ...leaf,
    sessionId: target.sessionId,
  }));

  return replaceLeafByPaneId(withSource, targetPaneId, (leaf) => ({
    ...leaf,
    sessionId: source.sessionId!,
  }));
}

export function moveSessionToDraftPane(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target || target.sessionId) {
    return node;
  }

  const stripped = removeLeafByPaneId(node, sourcePaneId) ?? { id: node.id, type: "leaf" };
  return assignSessionToPane(stripped, targetPaneId, source.sessionId);
}

export function insertPaneAtEdge(
  node: PaneNode,
  sourcePaneId: string,
  targetPaneId: string,
  placement: Exclude<PaneDropPlacement, "center">
): PaneNode {
  if (sourcePaneId === targetPaneId) {
    return node;
  }

  const source = findLeafByPaneId(node, sourcePaneId);
  const target = findLeafByPaneId(node, targetPaneId);
  if (!source?.sessionId || !target || !target.sessionId) {
    return node;
  }

  const stripped = removeLeafByPaneId(node, sourcePaneId) ?? { id: node.id, type: "leaf" };
  const incomingLeaf: PaneNode = {
    id: source.id,
    type: "leaf",
    sessionId: source.sessionId,
  };

  return replaceLeafByPaneId(stripped, targetPaneId, (leaf) => {
    const splitDirection = placement === "left" || placement === "right" ? "horizontal" : "vertical";
    const splitId = createDragSplitId(stripped.id, leaf.id, placement);
    const children =
      placement === "left" || placement === "top"
        ? [incomingLeaf, leaf]
        : [leaf, incomingLeaf];

    return {
      id: splitId,
      type: "split",
      direction: splitDirection,
      ratio: 0.5,
      children,
    };
  });
}
```

- [ ] **Step 4: Run the tree tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-layout-tree.test.ts
```

Expected: PASS with all existing pane layout tests plus the new drag mutation cases.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/agent-panes/pane-layout-tree.ts packages/web/src/features/agent-panes/pane-layout-tree.test.ts
git commit -m "feat: add pane drag tree mutations"
```

### Task 2: Expose Drag-Specific Pane Actions

**Files:**
- Create: `packages/web/src/features/agent-panes/actions/pane-drag-types.ts`
- Modify: `packages/web/src/features/agent-panes/actions/use-pane-actions.ts`
- Modify: `packages/web/src/features/agent-panes/index.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`

- [ ] **Step 1: Write the failing integration tests for drag actions**

Extend `packages/web/src/features/agent-panes/index.test.tsx` with mocks that expose drag callbacks from `SessionCard` and `DraftLauncher`:

```ts
type MockSessionCardProps = {
  sessionId: string;
  paneId?: string;
  onPaneDrop?: (intent: PaneDropIntent) => void;
};

type MockDraftLauncherProps = {
  paneId?: string;
  onPaneDrop?: (intent: PaneDropIntent) => void;
};

const mockDraftLauncher = vi.fn(({ paneId, onPaneDrop }: MockDraftLauncherProps) => (
  <div data-testid={`draft-${paneId ?? "root"}`}>
    <button
      type="button"
      onClick={() =>
        onPaneDrop?.({
          sourcePaneId: "left",
          targetPaneId: paneId ?? "root",
          placement: "center",
          targetType: "draft",
        })
      }
    >
      move-to-draft-{paneId ?? "root"}
    </button>
  </div>
));
```

Add action coverage:

```ts
it("swaps pane sessions when a center drop targets another session pane", async () => {
  const { store } = createAgentPaneStore({
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
      <AgentPanes />
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "drop-center-sess_1" }));

  await waitFor(() => {
    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_2" },
        { id: "right", type: "leaf", sessionId: "sess_1" },
      ],
    });
  });
});

it("moves a session into a draft pane on draft center drop", async () => {
  const { store } = createAgentPaneStore({
    id: "root",
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [
      { id: "left", type: "leaf", sessionId: "sess_1" },
      { id: "right", type: "leaf" },
    ],
  });

  render(
    <Provider store={store}>
      <AgentPanes />
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "move-to-draft-right" }));

  await waitFor(() => {
    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "right",
      type: "leaf",
      sessionId: "sess_1",
    });
  });
});
```

- [ ] **Step 2: Run the agent-panes integration tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/index.test.tsx
```

Expected: FAIL because `PaneDropIntent` and drag-specific callbacks are not defined yet.

- [ ] **Step 3: Add shared drag intent types and extend `usePaneActions()`**

Create `packages/web/src/features/agent-panes/actions/pane-drag-types.ts`:

```ts
export type PaneDropPlacement = "left" | "right" | "top" | "bottom" | "center";
export type PaneDropTargetType = "session" | "draft";

export interface PaneDropIntent {
  sourcePaneId: string;
  targetPaneId: string;
  placement: PaneDropPlacement;
  targetType: PaneDropTargetType;
}
```

Update `use-pane-actions.ts` to import the new tree helpers and expose drag actions:

```ts
import type { PaneDropPlacement } from "./pane-drag-types";
import {
  insertPaneAtEdge,
  moveSessionToDraftPane,
  swapPaneSessionsByPaneId,
} from "../pane-layout-tree";

const swapPaneSessions = useCallback(
  (sourcePaneId: string, targetPaneId: string) => {
    applyLayout((current) => swapPaneSessionsByPaneId(current, sourcePaneId, targetPaneId));
  },
  [applyLayout]
);

const moveSessionToDraft = useCallback(
  (sourcePaneId: string, targetPaneId: string) => {
    applyLayout((current) => moveSessionToDraftPane(current, sourcePaneId, targetPaneId));
  },
  [applyLayout]
);

const insertSessionPaneAtEdge = useCallback(
  (
    sourcePaneId: string,
    targetPaneId: string,
    placement: Exclude<PaneDropPlacement, "center">
  ) => {
    applyLayout((current) => insertPaneAtEdge(current, sourcePaneId, targetPaneId, placement));
  },
  [applyLayout]
);
```

Return these from the hook:

```ts
return {
  appendSession,
  appendSessionToMobileColumn,
  assignSession,
  closeDraftPane,
  closeSessionPane,
  insertSessionPaneAtEdge,
  moveSessionToDraft,
  removeSessionPane,
  replaceSession,
  replaceWithSession,
  splitDraftPane,
  splitSessionPane,
  swapPaneSessions,
};
```

- [ ] **Step 4: Wire a simple drop-intent dispatch path in `AgentPanes` for test coverage**

Before building the full controller, add a thin handler in `index.tsx` so the mocked component tests can assert action selection. Keep this as a local helper that Task 3 reuses from the pointer-driven controller:

```ts
const handlePaneDrop = useCallback(
  (intent: PaneDropIntent) => {
    if (intent.placement === "center") {
      if (intent.targetType === "draft") {
        paneActions.moveSessionToDraft(intent.sourcePaneId, intent.targetPaneId);
        return;
      }

      paneActions.swapPaneSessions(intent.sourcePaneId, intent.targetPaneId);
      return;
    }

    paneActions.insertSessionPaneAtEdge(intent.sourcePaneId, intent.targetPaneId, intent.placement);
  },
  [paneActions]
);
```

Pass it to leaf renderers:

```ts
<SessionCard
  paneId={node.id}
  sessionId={node.sessionId}
  onPaneDrop={handlePaneDrop}
  ...
/>

<DraftLauncher
  paneId={node.id}
  onPaneDrop={handlePaneDrop}
  ...
/>
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/index.test.tsx
```

Expected: PASS with the new drag-action dispatch coverage and no regressions in split/close persistence tests.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/agent-panes/actions/pane-drag-types.ts packages/web/src/features/agent-panes/actions/use-pane-actions.ts packages/web/src/features/agent-panes/index.tsx packages/web/src/features/agent-panes/index.test.tsx
git commit -m "feat: add pane drag action dispatch"
```

### Task 3: Build The Drag Controller And Hit Testing

**Files:**
- Create: `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts`
- Create: `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.test.tsx`
- Modify: `packages/web/src/features/agent-panes/index.tsx`

- [ ] **Step 1: Write failing controller tests for placement calculation and drop intent dispatch**

Create `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.test.tsx` with a minimal harness:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePaneDragController } from "./use-pane-drag-controller";

describe("usePaneDragController", () => {
  it("returns left placement when the pointer is inside the left edge band", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => usePaneDragController({ onDrop }));

    act(() => {
      result.current.registerPane("target", {
        type: "session",
        element: {
          getBoundingClientRect: () =>
            ({
              left: 100,
              top: 100,
              right: 500,
              bottom: 500,
              width: 400,
              height: 400,
            }) as DOMRect,
        } as HTMLElement,
      });
      result.current.startDrag({
        paneId: "source",
        sessionId: "sess_1",
        title: "Session 1",
        providerLabel: "Claude",
      });
      result.current.handlePointerMove({ clientX: 120, clientY: 250 } as PointerEvent);
    });

    expect(result.current.state.hoverTargetPaneId).toBe("target");
    expect(result.current.state.hoverPlacement).toBe("left");
  });

  it("treats a draft pane as center-only and dispatches a draft center intent on pointer up", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => usePaneDragController({ onDrop }));

    act(() => {
      result.current.registerPane("draft", {
        type: "draft",
        element: {
          getBoundingClientRect: () =>
            ({
              left: 100,
              top: 100,
              right: 500,
              bottom: 500,
              width: 400,
              height: 400,
            }) as DOMRect,
        } as HTMLElement,
      });
      result.current.startDrag({
        paneId: "source",
        sessionId: "sess_1",
        title: "Session 1",
        providerLabel: "Claude",
      });
      result.current.handlePointerMove({ clientX: 250, clientY: 250 } as PointerEvent);
      result.current.handlePointerUp();
    });

    expect(onDrop).toHaveBeenCalledWith({
      sourcePaneId: "source",
      targetPaneId: "draft",
      placement: "center",
      targetType: "draft",
    });
  });
});
```

- [ ] **Step 2: Run the controller test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/actions/use-pane-drag-controller.test.tsx
```

Expected: FAIL because the hook file does not exist yet.

- [ ] **Step 3: Implement the controller hook with pane registry and global pointer listeners**

Create `packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaneDropIntent, PaneDropPlacement, PaneDropTargetType } from "./pane-drag-types";

interface RegisteredPane {
  type: PaneDropTargetType;
  element: HTMLElement;
}

interface DragSourceSnapshot {
  paneId: string;
  sessionId: string;
  title: string;
  providerLabel: string;
}

interface PaneDragState {
  isDragging: boolean;
  source: DragSourceSnapshot | null;
  hoverTargetPaneId: string | null;
  hoverPlacement: PaneDropPlacement | null;
  previewX: number;
  previewY: number;
}

const EDGE_RATIO = 0.22;
const EDGE_MIN = 48;
const EDGE_MAX = 96;
```

Implement the public API:

```ts
export function usePaneDragController({ onDrop }: { onDrop: (intent: PaneDropIntent) => void }) {
  const paneRegistry = useRef(new Map<string, RegisteredPane>());
  const [state, setState] = useState<PaneDragState>({
    isDragging: false,
    source: null,
    hoverTargetPaneId: null,
    hoverPlacement: null,
    previewX: 0,
    previewY: 0,
  });

  const registerPane = useCallback((paneId: string, entry: RegisteredPane | null) => {
    if (!entry) {
      paneRegistry.current.delete(paneId);
      return;
    }
    paneRegistry.current.set(paneId, entry);
  }, []);

  const startDrag = useCallback((source: DragSourceSnapshot) => {
    document.body.classList.add("is-dragging-pane");
    setState({
      isDragging: true,
      source,
      hoverTargetPaneId: null,
      hoverPlacement: null,
      previewX: 0,
      previewY: 0,
    });
  }, []);

  const clearDrag = useCallback(() => {
    document.body.classList.remove("is-dragging-pane");
    setState({
      isDragging: false,
      source: null,
      hoverTargetPaneId: null,
      hoverPlacement: null,
      previewX: 0,
      previewY: 0,
    });
  }, []);
```

Add hit testing:

```ts
  const resolvePlacement = useCallback(
    (paneId: string, pane: RegisteredPane, clientX: number, clientY: number): PaneDropPlacement | null => {
      const rect = pane.element.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }

      if (state.source?.paneId === paneId) {
        return null;
      }

      if (pane.type === "draft") {
        return "center";
      }

      const edgeX = Math.max(EDGE_MIN, Math.min(EDGE_MAX, rect.width * EDGE_RATIO));
      const edgeY = Math.max(EDGE_MIN, Math.min(EDGE_MAX, rect.height * EDGE_RATIO));

      if (clientX <= rect.left + edgeX) return "left";
      if (clientX >= rect.right - edgeX) return "right";
      if (clientY <= rect.top + edgeY) return "top";
      if (clientY >= rect.bottom - edgeY) return "bottom";
      return "center";
    },
    [state.source?.paneId]
  );
```

And event handlers:

```ts
  const handlePointerMove = useCallback((event: PointerEvent) => {
    setState((current) => {
      if (!current.isDragging) {
        return current;
      }

      let hoverTargetPaneId: string | null = null;
      let hoverPlacement: PaneDropPlacement | null = null;
      for (const [paneId, pane] of paneRegistry.current.entries()) {
        const placement = resolvePlacement(paneId, pane, event.clientX, event.clientY);
        if (!placement) {
          continue;
        }
        hoverTargetPaneId = paneId;
        hoverPlacement = placement;
        break;
      }

      return {
        ...current,
        hoverTargetPaneId,
        hoverPlacement,
        previewX: event.clientX,
        previewY: event.clientY,
      };
    });
  }, [resolvePlacement]);

  const handlePointerUp = useCallback(() => {
    setState((current) => {
      if (
        current.isDragging &&
        current.source &&
        current.hoverTargetPaneId &&
        current.hoverPlacement
      ) {
        const target = paneRegistry.current.get(current.hoverTargetPaneId);
        if (target) {
          onDrop({
            sourcePaneId: current.source.paneId,
            targetPaneId: current.hoverTargetPaneId,
            placement: current.hoverPlacement,
            targetType: target.type,
          });
        }
      }
      return current;
    });
    clearDrag();
  }, [clearDrag, onDrop]);

  useEffect(() => {
    if (!state.isDragging) {
      return;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp, state.isDragging]);
```

Return the controller API:

```ts
  return {
    state,
    clearDrag,
    handlePointerMove,
    handlePointerUp,
    registerPane,
    startDrag,
  };
}
```

- [ ] **Step 4: Integrate the hook into `AgentPanes` and thread the controller props down**

Update `index.tsx`:

```ts
const dragController = usePaneDragController({ onDrop: handlePaneDrop });
```

Pass pane registration and drag state into `PaneNodeRenderer`:

```ts
<PaneNodeRenderer
  ...
  dragController={dragController}
/>
```

Expand renderer props:

```ts
interface PaneNodeRendererProps {
  ...
  dragController: ReturnType<typeof usePaneDragController>;
}
```

Prepare per-leaf data:

```ts
const hoverPlacement =
  dragController.state.hoverTargetPaneId === node.id ? dragController.state.hoverPlacement : null;
const isDragging = dragController.state.isDragging;
```

- [ ] **Step 5: Run the controller and integration tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/actions/use-pane-drag-controller.test.tsx src/features/agent-panes/index.test.tsx
```

Expected: PASS with correct placement resolution and drop intent dispatch.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/agent-panes/actions/pane-drag-types.ts packages/web/src/features/agent-panes/actions/use-pane-drag-controller.ts packages/web/src/features/agent-panes/actions/use-pane-drag-controller.test.tsx packages/web/src/features/agent-panes/index.tsx packages/web/src/features/agent-panes/index.test.tsx
git commit -m "feat: add pane drag controller"
```

### Task 4: Wire Drag Handle, Drop Surfaces, And Overlay UI

**Files:**
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx`
- Modify: `packages/web/src/features/agent-panes/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing UI tests for drag handle and overlay behavior**

Add focused assertions to `session-card.test.tsx`:

```ts
it("renders a pane drag handle button in the header actions", () => {
  const { store } = createSessionStore({
    terminalId: "term-live",
    state: "running",
    endedAt: undefined,
  });

  render(
    <Provider store={store}>
      <SessionCard
        paneId="pane-1"
        sessionId="sess_123456"
        onPaneDragStart={vi.fn()}
      />
    </Provider>
  );

  expect(screen.getByRole("button", { name: "Drag pane" })).toBeInTheDocument();
});

it("starts pane drag only from the drag handle", () => {
  const { store } = createSessionStore({
    terminalId: "term-live",
    state: "running",
    endedAt: undefined,
  });
  const onPaneDragStart = vi.fn();

  render(
    <Provider store={store}>
      <SessionCard
        paneId="pane-1"
        sessionId="sess_123456"
        onPaneDragStart={onPaneDragStart}
      />
    </Provider>
  );

  fireEvent.pointerDown(screen.getByRole("button", { name: "Drag pane" }));
  fireEvent.pointerDown(screen.getByText("SESSION-56"));

  expect(onPaneDragStart).toHaveBeenCalledTimes(1);
  expect(onPaneDragStart).toHaveBeenCalledWith(
    expect.objectContaining({
      paneId: "pane-1",
      sessionId: "sess_123456",
      providerLabel: "Codex",
    })
  );
});
```

Add coverage to `draft-launcher.test.tsx`:

```ts
it("renders a draft drop label when pane drag hover is active", () => {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, {
    sendCommand: vi.fn(),
    subscribe: vi.fn(() => () => {}),
  } as never);

  render(
    <Provider store={store}>
      <DraftLauncher
        workspaceId="ws-123"
        paneId="pane-1"
        dragState={{
          isDragging: true,
          isActiveDropTarget: true,
          hoverPlacement: "center",
        }}
      />
    </Provider>
  );

  expect(screen.getByText("Move here")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/features/agent-panes/views/shared/draft-launcher.test.tsx
```

Expected: FAIL because the new props and drag UI do not exist.

- [ ] **Step 3: Add the drag handle and leaf wrappers**

Update `session-card.tsx` props:

```ts
import { GripVertical } from "lucide-react";
import type { PaneDropPlacement } from "../../actions/pane-drag-types";

interface SessionCardProps {
  paneId?: string;
  onPaneDragStart?: (source: {
    paneId: string;
    sessionId: string;
    title: string;
    providerLabel: string;
  }) => void;
  dragState?: {
    isDragging: boolean;
    isActiveDropTarget: boolean;
    hoverPlacement: PaneDropPlacement | null;
  };
}
```

Add the drag handle before split/close buttons:

```tsx
<Tooltip content="Drag pane">
  <IconButton
    aria-label="Drag pane"
    className="session-action-btn session-action-btn-drag"
    icon={<GripVertical size={13} />}
    onPointerDown={(event) => {
      event.stopPropagation();
      if (!paneId) {
        return;
      }
      onPaneDragStart?.({
        paneId,
        sessionId: session.id,
        title: sessionTitle,
        providerLabel,
      });
    }}
    size="sm"
  />
</Tooltip>
```

Wrap the card body with drag classes and overlay:

```tsx
<div
  ref={cardRef}
  className={`session-card agent-pane${isActiveSession ? " session-card--active" : ""}${highlight ? " session-card--focus-pulse" : ""}${isRunning ? " session-card--running" : ""}${dragState?.isDragging ? " session-card--dragging" : ""}${dragState?.isActiveDropTarget ? " session-card--drop-target" : ""}`}
  data-pane-id={paneId}
  data-session-id={sessionId}
  onClick={handleCardClick}
>
  {dragState?.isDragging ? (
    <div className={`pane-drop-overlay pane-drop-overlay--${dragState.hoverPlacement ?? "idle"}`}>
      <div className="pane-drop-overlay__center">Swap</div>
    </div>
  ) : null}
```

Update `draft-launcher.tsx`:

```ts
interface DraftLauncherProps {
  dragState?: {
    isDragging: boolean;
    isActiveDropTarget: boolean;
    hoverPlacement: "center" | null;
  };
}
```

Render draft overlay:

```tsx
<div
  className={`session-card agent-pane${dragState?.isDragging ? " draft-launcher--dragging" : ""}${dragState?.isActiveDropTarget ? " draft-launcher--drop-target" : ""}`}
  data-pane-id={paneId}
>
  {dragState?.isDragging ? (
    <div className="pane-drop-overlay pane-drop-overlay--draft">
      <div className="pane-drop-overlay__center">Move here</div>
    </div>
  ) : null}
```

- [ ] **Step 4: Create a dedicated leaf component and wire drag state from `AgentPanes`**

In `index.tsx`, add a dedicated `PaneLeaf` component so `useRef` and `useEffect` stay outside the recursive branch-switching logic in `PaneNodeRenderer`:

```tsx
interface PaneLeafProps {
  node: Extract<PaneNode, { type: "leaf" }>;
  workspaceId: string;
  dragController: ReturnType<typeof usePaneDragController>;
  onAssignSession: (paneId: string, sessionId: string) => void;
  onCloseDraftPane: (paneId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onCloseSessionCommand: (
    sessionId: string,
    paneDisposition?: "draft" | "remove"
  ) => Promise<boolean | void>;
  onPaneDrop: (intent: PaneDropIntent) => void;
  onReplaceWithSession: (sessionId: string) => void;
  onSplitDraftPane: (paneId: string, direction: "horizontal" | "vertical") => void;
  onSplitSession: (sessionId: string, direction: "horizontal" | "vertical") => void;
}

const PaneLeaf: FC<PaneLeafProps> = ({
  node,
  workspaceId,
  dragController,
  onAssignSession,
  onCloseDraftPane,
  onCloseSession,
  onCloseSessionCommand,
  onPaneDrop,
  onReplaceWithSession,
  onSplitDraftPane,
  onSplitSession,
}) => {
  const leafRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!leafRef.current) {
      return;
    }

    dragController.registerPane(node.id, {
      type: node.sessionId ? "session" : "draft",
      element: leafRef.current,
    });

    return () => {
      dragController.registerPane(node.id, null);
    };
  }, [dragController, node.id, node.sessionId]);

  return <div ref={leafRef} className="agent-pane-leaf" data-pane-id={node.id} />;
};
```

Render `PaneLeaf` from `PaneNodeRenderer` instead of calling hooks directly in the `node.type === "leaf"` branch. Inside `PaneLeaf`, render `SessionCard` or `DraftLauncher` with the registered wrapper:

```tsx
<div ref={leafRef} className="agent-pane-leaf" data-pane-id={node.id}>
  <SessionCard
    paneId={node.id}
    onPaneDragStart={dragController.startDrag}
    dragState={{
      isDragging: dragController.state.isDragging,
      isActiveDropTarget: dragController.state.hoverTargetPaneId === node.id,
      hoverPlacement:
        dragController.state.hoverTargetPaneId === node.id
          ? dragController.state.hoverPlacement
          : null,
    }}
    ...
  />
</div>
```

Do the equivalent for `DraftLauncher`, but coerce `hoverPlacement` to `"center"` only.

- [ ] **Step 5: Add the drag overlay and body-state CSS**

Append styles to `packages/web/src/styles/components.css`:

```css
body.is-dragging-pane {
  cursor: grabbing;
  user-select: none;
}

.agent-pane-leaf {
  position: relative;
  min-width: 0;
  min-height: 0;
}

.session-action-btn-drag {
  cursor: grab;
}

body.is-dragging-pane .session-action-btn-drag {
  cursor: grabbing;
}

.pane-drop-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  border: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  z-index: 3;
}

.pane-drop-overlay--left::before,
.pane-drop-overlay--right::before,
.pane-drop-overlay--top::before,
.pane-drop-overlay--bottom::before,
.pane-drop-overlay--center::before,
.pane-drop-overlay--draft::before {
  content: "";
  position: absolute;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}

.pane-drop-overlay--left::before {
  inset: 0 auto 0 0;
  width: 24%;
}

.pane-drop-overlay--right::before {
  inset: 0 0 0 auto;
  width: 24%;
}

.pane-drop-overlay--top::before {
  inset: 0 0 auto 0;
  height: 24%;
}

.pane-drop-overlay--bottom::before {
  inset: auto 0 0 0;
  height: 24%;
}

.pane-drop-overlay--center::before,
.pane-drop-overlay--draft::before {
  inset: 22%;
}

.pane-drop-overlay__center {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  padding: 4px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: 11px;
}
```

- [ ] **Step 6: Run the component and integration tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/features/agent-panes/views/shared/draft-launcher.test.tsx src/features/agent-panes/index.test.tsx
```

Expected: PASS with drag handle, draft overlay, and leaf wiring covered.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx packages/web/src/features/agent-panes/index.tsx packages/web/src/styles/components.css
git commit -m "feat: wire pane drag ui"
```

### Task 5: Add End-To-End Desktop Drag Coverage

**Files:**
- Create: `e2e/specs/sessions/pane-drag-reorder.spec.ts`

- [ ] **Step 1: Add the end-to-end desktop drag scenarios**

Create `e2e/specs/sessions/pane-drag-reorder.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { launchClaudeSession, openWorkspace, waitForSessionReady } from "../helpers/workspace-session";

test.describe("session pane drag reorder", () => {
  test("swaps two session panes by dropping on center", async ({ page }) => {
    await openWorkspace(page);
    const firstPane = await launchClaudeSession(page);
    await waitForSessionReady(page);

    await page.getByRole("button", { name: "Split horizontal" }).first().click();
    await page.locator(".agent-provider-card-codex").first().click();

    const panes = page.locator(".session-card.agent-pane[data-session-id]");
    await expect(panes).toHaveCount(2, { timeout: 20000 });

    const beforeIds = await panes.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-session-id"))
    );

    const sourceHandle = panes.nth(0).getByRole("button", { name: "Drag pane" });
    const sourceBox = await sourceHandle.boundingBox();
    const target = panes.nth(1);
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error("Missing pane drag geometry");
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
    await page.mouse.up();

    await expect
      .poll(async () =>
        page.locator(".session-card.agent-pane[data-session-id]").evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-session-id"))
        )
      )
      .toEqual([beforeIds[1], beforeIds[0]]);
  });

  test("moves a session into a draft pane by dropping on the draft center", async ({ page }) => {
    await openWorkspace(page);
    const firstPane = await launchClaudeSession(page);
    await waitForSessionReady(page);

    await page.getByRole("button", { name: "Split horizontal" }).first().click();
    const sourcePane = page.locator(".session-card.agent-pane[data-session-id]").first();
    const draftPane = page.locator(".agent-draft-launcher").first();
    const sourceHandle = sourcePane.getByRole("button", { name: "Drag pane" });
    const sourceBox = await sourceHandle.boundingBox();
    const draftBox = await draftPane.boundingBox();
    if (!sourceBox || !draftBox) {
      throw new Error("Missing draft pane box");
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + draftBox.height / 2);
    await page.mouse.up();

    await expect(page.locator(".agent-draft-launcher")).toHaveCount(0);
    await expect(page.locator(".session-card.agent-pane[data-session-id]")).toHaveCount(1);
  });
});
```

- [ ] **Step 2: Run the focused verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/pane-layout-tree.test.ts src/features/agent-panes/actions/use-pane-drag-controller.test.tsx src/features/agent-panes/components/session-card.test.tsx src/features/agent-panes/views/shared/draft-launcher.test.tsx src/features/agent-panes/index.test.tsx
pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/sessions/pane-drag-reorder.spec.ts
```

Expected: PASS for both the focused unit/integration suite and the new Playwright spec.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/features/agent-panes/index.test.tsx e2e/specs/sessions/pane-drag-reorder.spec.ts
git commit -m "test: cover pane drag reorder"
```

## Final Verification

- [ ] **Step 1: Run formatting or lint only if the touched files need it**

Run:

```bash
pnpm exec biome check packages/web/src/features/agent-panes packages/web/src/styles/components.css e2e/specs/sessions/pane-drag-reorder.spec.ts
```

Expected: PASS with zero diagnostics for the changed files.

- [ ] **Step 2: Run the full web package test suite for fresh evidence**

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected: PASS for the full `@coder-studio/web` Vitest suite.

- [ ] **Step 3: Run typecheck for the web package**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 4: Run the focused end-to-end pane drag spec again**

Run:

```bash
pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/sessions/pane-drag-reorder.spec.ts
```

Expected: PASS with both desktop drag scenarios green.

- [ ] **Step 5: Review spec coverage before declaring completion**

Check these against the final diff:

```txt
[ ] Session pane drag handle exists and starts drag
[ ] Session pane supports left/right/top/bottom/center drop
[ ] Draft pane supports center-only drop
[ ] Center on session swaps sessionId only
[ ] Center on draft moves session and collapses source branch
[ ] Edge insert wraps target with fresh split and ratio 0.5
[ ] Invalid drops are no-ops
[ ] Desktop-only behavior does not alter mobile-specific files
[ ] Layout changes still persist via workspace.uiState.set
```

- [ ] **Step 6: Final commit**

```bash
git add packages/web/src/features/agent-panes packages/web/src/styles/components.css e2e/specs/sessions/pane-drag-reorder.spec.ts
git commit -m "feat: add session pane drag reorder"
```
