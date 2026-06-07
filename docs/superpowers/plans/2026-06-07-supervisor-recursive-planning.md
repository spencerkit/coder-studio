# Supervisor Recursive Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build lazy recursive Supervisor planning so only the active branch is decomposed until an AI-executable leaf passes a type-aware ready check.

**Architecture:** Extend the existing Supervisor target memory with a tree-shaped `planTree` while keeping legacy `items` compatibility. Add a focused server-side plan-tree helper for tree traversal/mutation, extend `SupervisorEvaluator` with `ready_check`, `decompose_child`, and `executable_task` modes, then wire `SupervisorManager` so guidance injection is gated by recursive readiness. The web details view renders the tree and current active path from the same memory, with the existing flat progress list as fallback.

**Tech Stack:** TypeScript, pnpm, Vitest, React 19, Jotai, existing `@coder-studio/core` shared domain types, existing server Supervisor manager/evaluator/target-store.

---

## Current Context

Approved spec: `docs/superpowers/specs/2026-06-07-supervisor-recursive-planning-design.md`

Primary files:

- Core types: `packages/core/src/domain/supervisor.ts`
- Target memory persistence and normalization: `packages/server/src/supervisor/target-store.ts`
- Evaluator prompt/parser/runner: `packages/server/src/supervisor/evaluator.ts`
- Runtime orchestration: `packages/server/src/supervisor/manager.ts`
- Server tests: `packages/server/src/supervisor/*.test.ts`
- Web details UI: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`
- Web locales: `packages/web/src/locales/en.json`, `packages/web/src/locales/zh.json`
- Web CSS: `packages/web/src/styles/components.css`

The worktree may already contain unrelated git panel changes. Do not stage or revert those files.

## File Structure

- Modify `packages/core/src/domain/supervisor.ts`
  - Add plan tree domain types.
  - Add `planTree`, `activeNodeId`, `activeLeafPath`, `maxDepth`, and `planRevision` to `SupervisorTargetMemory`.
  - Preserve existing `items`, `activeItemId`, and `decompositionGenerated` fields.

- Modify `packages/server/src/supervisor/target-store.ts`
  - Normalize persisted `planTree`.
  - Populate default tree fields for new and reset targets.
  - Convert legacy `items` into a synthetic plan root during load.
  - Keep legacy fields present for existing UI/tests.

- Create `packages/server/src/supervisor/plan-tree.ts`
  - Pure helper functions for plan tree traversal and mutation.
  - No provider, repo, terminal, or WebSocket dependencies.

- Create `packages/server/src/supervisor/plan-tree.test.ts`
  - Unit tests for active path resolution, child attachment, ready-check persistence, and rollup.

- Modify `packages/server/src/supervisor/evaluator.ts`
  - Extend evaluator mode union.
  - Add result interfaces and parser branches.
  - Add prompts for `ready_check`, `decompose_child`, and `executable_task`.

- Modify `packages/server/src/supervisor/evaluator.test.ts`
  - Parser and prompt coverage for the new evaluator modes.

- Modify `packages/server/src/supervisor/manager.ts`
  - Call `prepareExecutableNode` before the existing evaluate/inject path.
  - Save tree changes to target memory after each plan mutation.
  - Use executable guidance generated for the active leaf.
  - Preserve current retry/error/cancel behavior.

- Modify `packages/server/src/supervisor/manager.test.ts`
  - Focused tests for recursive ready gate, sibling laziness, max-depth fallback, and leaf advancement.

- Modify `packages/server/src/__tests__/supervisor-manager.test.ts`
  - Keep integration test memory fixtures compatible with required `maxDepth` and `planRevision` fields.

- Modify `packages/server/src/supervisor/context-builder.test.ts`
  - Keep context builder memory fixtures compatible with required tree metadata fields.

- Modify `packages/server/src/supervisor/evaluator.windows.test.ts`
  - Keep Windows evaluator context fixtures compatible with required tree metadata fields.

- Modify `packages/server/src/__tests__/supervisor-integration.test.ts`
  - Keep supervisor integration fixtures compatible with required tree metadata fields.

- Modify `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`
  - Derive active item from `planTree` when available; fallback to legacy `items`.

- Modify `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`
  - Render plan tree and current leaf path when `planTree` exists.
  - Keep existing flat list fallback.

- Modify `packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
  - Add tree rendering and fallback coverage.

- Modify `packages/web/src/locales/en.json`, `packages/web/src/locales/zh.json`
  - Add labels for plan tree, active path, ready check, task type, and max depth fallback.

- Modify `packages/web/src/styles/components.css`
  - Add restrained tree/focus panel styles.

---

## Task 1: Core Plan Tree Types

**Files:**
- Modify: `packages/core/src/domain/supervisor.ts`
- Test: `packages/core/src/domain/types.test.ts`

- [ ] **Step 1: Add a compile-time type coverage test**

Add this type import near the top of `packages/core/src/domain/types.test.ts`, after the Vitest import:

```ts
import type { SupervisorTargetMemory } from "./supervisor";
```

Append this test case inside `packages/core/src/domain/types.test.ts`:

```ts
it("allows supervisor target memory to hold a recursive plan tree", () => {
  const memory: SupervisorTargetMemory = {
    targetId: "tgt-1",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [],
    activeItemId: undefined,
    planTree: {
      id: "root",
      title: "Write a 1M word novel",
      objective: "Produce the full novel through small executable writing tasks",
      deliverable: "Completed novel",
      acceptanceCriteria: ["The novel is complete"],
      status: "in_progress",
      taskType: "writing",
      depth: 0,
      children: [
        {
          id: "volume-1",
          parentId: "root",
          title: "Volume 1",
          objective: "Draft the first volume",
          deliverable: "Volume 1 draft",
          acceptanceCriteria: ["Volume 1 has a complete arc"],
          status: "in_progress",
          taskType: "writing",
          depth: 1,
          children: [],
          readyCheck: {
            granularity: "too_large",
            reason: "A full volume is too broad for one execution step",
            recommendedUnit: "scene_card",
            qualityRisk: "large_scope_quality_loss",
            missingInputs: ["scene conflict"],
            confidence: "high",
            checkedAt: 10,
          },
        },
      ],
    },
    activeNodeId: "volume-1",
    activeLeafPath: ["root", "volume-1"],
    maxDepth: 6,
    planRevision: 1,
    stalledCount: 0,
    updatedAt: 10,
  };

  expect(memory.planTree?.children[0]?.readyCheck?.granularity).toBe("too_large");
  expect(memory.activeLeafPath).toEqual(["root", "volume-1"]);
});
```

- [ ] **Step 2: Run the focused core test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/types.test.ts
```

Expected: FAIL with TypeScript errors for missing plan tree types/properties.

- [ ] **Step 3: Add plan tree domain types**

In `packages/core/src/domain/supervisor.ts`, add these types near the existing `SupervisorWorkItem` types:

```ts
export type SupervisorPlanNodeStatus = "pending" | "in_progress" | "done" | "blocked";
export type SupervisorTaskType = "coding" | "writing" | "research" | "design" | "generic";
export type SupervisorGranularity = "too_large" | "ready" | "too_small";

export interface SupervisorPlanNodeReadyCheck {
  granularity: SupervisorGranularity;
  reason: string;
  recommendedUnit?: string;
  qualityRisk?: string;
  missingInputs?: string[];
  confidence?: "low" | "medium" | "high";
  checkedAt: number;
}

export interface SupervisorPlanNodeExecution {
  executable: boolean;
  guidance?: string;
  lastInjectedAt?: number;
}

export interface SupervisorPlanNode {
  id: string;
  parentId?: string;
  title: string;
  objective: string;
  deliverable: string;
  acceptanceCriteria: string[];
  status: SupervisorPlanNodeStatus;
  taskType: SupervisorTaskType;
  depth: number;
  children: SupervisorPlanNode[];
  readyCheck?: SupervisorPlanNodeReadyCheck;
  execution?: SupervisorPlanNodeExecution;
}

export const DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH = 6;
```

- [ ] **Step 4: Extend `SupervisorTargetMemory`**

Update `SupervisorTargetMemory` in `packages/core/src/domain/supervisor.ts`:

```ts
export interface SupervisorTargetMemory {
  targetId: string;
  decompositionGenerated: boolean;
  decompositionMode?: SupervisorDecompositionMode;
  items: SupervisorWorkItem[];
  activeItemId?: string;
  planTree?: SupervisorPlanNode;
  activeNodeId?: string;
  activeLeafPath?: string[];
  maxDepth: number;
  planRevision: number;
  progressSummary?: string;
  lastGuidance?: string;
  stalledCount: number;
  updatedAt: number;
}
```

- [ ] **Step 5: Run the focused core test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/types.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/supervisor.ts packages/core/src/domain/types.test.ts
git commit -m "feat(core): add supervisor plan tree types"
```

---

## Task 2: Target Store Tree Normalization

**Files:**
- Modify: `packages/server/src/supervisor/target-store.ts`
- Modify: `packages/server/src/supervisor/target-store.test.ts`

- [ ] **Step 1: Add default memory test coverage**

Update the expectations in `packages/server/src/supervisor/target-store.test.ts` cases that assert default memory. Each expected default memory object should include:

```ts
planTree: undefined,
activeNodeId: undefined,
activeLeafPath: undefined,
maxDepth: 6,
planRevision: 0,
```

Add this new test near the legacy plan memory test:

```ts
it("normalizes legacy items into a synthetic plan tree", async () => {
  await createTargetFiles(workspacePath, {
    targetId: "tgt-tree",
    sessionId: "sess-1",
    workspaceId: "ws-1",
    objective: "Ship feature",
    createdAt: 1,
  });

  await saveTargetMemory(workspacePath, "tgt-tree", {
    targetId: "tgt-tree",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [
      {
        id: "stage-1",
        kind: "stage",
        title: "Inspect behavior",
        objective: "Understand current behavior",
        deliverable: "Behavior notes",
        acceptanceCriteria: ["Behavior is documented"],
        status: "in_progress",
      },
    ],
    activeItemId: "stage-1",
    stalledCount: 0,
    updatedAt: 2,
    maxDepth: 6,
    planRevision: 0,
  });

  const memory = await loadTargetMemory(workspacePath, "tgt-tree");

  expect(memory.planTree).toEqual(
    expect.objectContaining({
      id: "tgt-tree-root",
      title: "Supervisor target",
      status: "in_progress",
      taskType: "generic",
      depth: 0,
    })
  );
  expect(memory.planTree?.children).toEqual([
    expect.objectContaining({
      id: "stage-1",
      parentId: "tgt-tree-root",
      title: "Inspect behavior",
      status: "in_progress",
      taskType: "generic",
      depth: 1,
      children: [],
    }),
  ]);
  expect(memory.activeNodeId).toBe("stage-1");
  expect(memory.activeLeafPath).toEqual(["tgt-tree-root", "stage-1"]);
});
```

- [ ] **Step 2: Run the target-store test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/target-store.test.ts
```

Expected: FAIL because target memory lacks tree defaults and legacy tree normalization.

- [ ] **Step 3: Update imports and type guards**

In `packages/server/src/supervisor/target-store.ts`, add imports:

```ts
  DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH,
  type SupervisorGranularity,
  type SupervisorPlanNode,
  type SupervisorPlanNodeReadyCheck,
  type SupervisorPlanNodeStatus,
  type SupervisorTaskType,
```

Add helper readers:

```ts
function readTaskType(value: unknown): SupervisorTaskType {
  return value === "coding" ||
    value === "writing" ||
    value === "research" ||
    value === "design" ||
    value === "generic"
    ? value
    : "generic";
}

function readPlanNodeStatus(value: unknown): SupervisorPlanNodeStatus {
  return value === "in_progress" || value === "done" || value === "pending" || value === "blocked"
    ? value
    : "pending";
}

function readGranularity(value: unknown): SupervisorGranularity | undefined {
  return value === "too_large" || value === "ready" || value === "too_small" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.flatMap<string>((entry) => {
    const text = readNonEmptyString(entry);
    return text ? [text] : [];
  });
  return values.length > 0 ? values : undefined;
}
```

- [ ] **Step 4: Add plan node normalization helpers**

Add these helpers in `target-store.ts` after `normalizeItem`:

```ts
function normalizeReadyCheck(raw: unknown): SupervisorPlanNodeReadyCheck | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const granularity = readGranularity(raw.granularity);
  const reason = readNonEmptyString(raw.reason);
  if (!granularity || !reason) {
    return undefined;
  }
  const confidence =
    raw.confidence === "low" || raw.confidence === "medium" || raw.confidence === "high"
      ? raw.confidence
      : undefined;
  return {
    granularity,
    reason,
    recommendedUnit: readNonEmptyString(raw.recommendedUnit),
    qualityRisk: readNonEmptyString(raw.qualityRisk),
    missingInputs: readStringArray(raw.missingInputs),
    confidence,
    checkedAt: readTimestamp(raw.checkedAt, 0),
  };
}

function normalizePlanNode(
  raw: unknown,
  fallback: { id: string; title: string; parentId?: string; depth: number }
): SupervisorPlanNode | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = readNonEmptyString(raw.id) ?? fallback.id;
  const title = readNonEmptyString(raw.title) ?? fallback.title;
  const acceptanceCriteria = readStringArray(raw.acceptanceCriteria) ?? [`${title} is complete`];
  const depth = readNonNegativeInteger(raw.depth, fallback.depth);
  const parentId = readNonEmptyString(raw.parentId) ?? fallback.parentId;
  const children = Array.isArray(raw.children)
    ? raw.children.flatMap<SupervisorPlanNode>((child, index) => {
        const normalized = normalizePlanNode(child, {
          id: `${id}-${index + 1}`,
          title: `Child ${index + 1}`,
          parentId: id,
          depth: depth + 1,
        });
        return normalized ? [normalized] : [];
      })
    : [];

  return {
    id,
    ...(parentId ? { parentId } : {}),
    title,
    objective: readNonEmptyString(raw.objective) ?? title,
    deliverable: readNonEmptyString(raw.deliverable) ?? `${title} completed`,
    acceptanceCriteria,
    status: readPlanNodeStatus(raw.status),
    taskType: readTaskType(raw.taskType),
    depth,
    children,
    readyCheck: normalizeReadyCheck(raw.readyCheck),
    execution: isRecord(raw.execution)
      ? {
          executable: raw.execution.executable === true,
          guidance: readNonEmptyString(raw.execution.guidance),
          lastInjectedAt: readOptionalTimestamp(raw.execution.lastInjectedAt),
        }
      : undefined,
  };
}

function buildPlanRootFromItems(
  targetId: string,
  items: SupervisorWorkItem[],
  activeItemId: string | undefined
): Pick<SupervisorTargetMemory, "planTree" | "activeNodeId" | "activeLeafPath"> {
  if (items.length === 0) {
    return { planTree: undefined, activeNodeId: undefined, activeLeafPath: undefined };
  }
  const rootId = `${targetId}-root`;
  const children: SupervisorPlanNode[] = items.map((item) => ({
    id: item.id,
    parentId: rootId,
    title: item.title,
    objective: item.objective,
    deliverable: item.deliverable,
    acceptanceCriteria: item.acceptanceCriteria,
    status: item.status,
    taskType: "generic",
    depth: 1,
    children: [],
  }));
  const activeNodeId =
    activeItemId && children.some((item) => item.id === activeItemId)
      ? activeItemId
      : children.find((item) => item.status === "in_progress")?.id ??
        children.find((item) => item.status === "pending")?.id ??
        children[0]?.id;
  return {
    planTree: {
      id: rootId,
      title: "Supervisor target",
      objective: "Complete the supervised target",
      deliverable: "Completed target",
      acceptanceCriteria: ["Target objective is complete"],
      status: children.every((item) => item.status === "done") ? "done" : "in_progress",
      taskType: "generic",
      depth: 0,
      children,
    },
    activeNodeId,
    activeLeafPath: activeNodeId ? [rootId, activeNodeId] : [rootId],
  };
}
```

- [ ] **Step 5: Extend memory defaults and normalization**

Update `buildTargetMemory` to return:

```ts
function buildTargetMemory(targetId: string, createdAt: number): SupervisorTargetMemory {
  return {
    targetId,
    decompositionGenerated: false,
    decompositionMode: undefined,
    items: [],
    activeItemId: undefined,
    planTree: undefined,
    activeNodeId: undefined,
    activeLeafPath: undefined,
    maxDepth: DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH,
    planRevision: 0,
    progressSummary: undefined,
    lastGuidance: undefined,
    stalledCount: 0,
    updatedAt: createdAt,
  };
}
```

In `normalizeTargetMemory`, after `items` and `activeItemId` are resolved, normalize tree fields:

```ts
  const activeItemId = resolveActiveItemId(items, raw.activeItemId ?? raw.activeStepId);
  const normalizedTree = normalizePlanNode(raw.planTree, {
    id: `${targetId}-root`,
    title: "Supervisor target",
    depth: 0,
  });
  const treeState =
    normalizedTree && normalizedTree.children.length > 0
      ? {
          planTree: normalizedTree,
          activeNodeId: readNonEmptyString(raw.activeNodeId) ?? activeItemId,
          activeLeafPath: readStringArray(raw.activeLeafPath),
        }
      : buildPlanRootFromItems(readNonEmptyString(raw.targetId) ?? targetId, items, activeItemId);
```

Return `treeState` fields in the memory object:

```ts
    activeItemId,
    planTree: treeState.planTree,
    activeNodeId: treeState.activeNodeId,
    activeLeafPath: treeState.activeLeafPath,
    maxDepth: readNonNegativeInteger(raw.maxDepth, DEFAULT_SUPERVISOR_PLAN_MAX_DEPTH),
    planRevision: readNonNegativeInteger(raw.planRevision, treeState.planTree ? 1 : 0),
```

- [ ] **Step 6: Run target-store tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/target-store.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/supervisor/target-store.ts packages/server/src/supervisor/target-store.test.ts
git commit -m "feat(server): normalize supervisor plan tree memory"
```

---

## Task 3: Pure Plan Tree Helper

**Files:**
- Create: `packages/server/src/supervisor/plan-tree.ts`
- Create: `packages/server/src/supervisor/plan-tree.test.ts`

- [ ] **Step 1: Write plan tree tests**

Create `packages/server/src/supervisor/plan-tree.test.ts`:

```ts
import type { SupervisorPlanNode, SupervisorTargetMemory } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  attachChildNodes,
  ensurePlanTreeFromItems,
  findNodePath,
  getActiveLeafPath,
  markActiveLeafDone,
  resolveActiveNode,
  saveReadyCheckOnNode,
} from "./plan-tree.js";

function node(input: Partial<SupervisorPlanNode> & Pick<SupervisorPlanNode, "id" | "title">): SupervisorPlanNode {
  return {
    id: input.id,
    parentId: input.parentId,
    title: input.title,
    objective: input.objective ?? input.title,
    deliverable: input.deliverable ?? `${input.title} done`,
    acceptanceCriteria: input.acceptanceCriteria ?? [`${input.title} is complete`],
    status: input.status ?? "pending",
    taskType: input.taskType ?? "generic",
    depth: input.depth ?? 0,
    children: input.children ?? [],
    readyCheck: input.readyCheck,
    execution: input.execution,
  };
}

function memory(): SupervisorTargetMemory {
  return {
    targetId: "tgt-1",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [],
    planTree: node({
      id: "root",
      title: "Root",
      status: "in_progress",
      children: [
        node({ id: "a", parentId: "root", title: "A", status: "in_progress", depth: 1 }),
        node({ id: "b", parentId: "root", title: "B", status: "pending", depth: 1 }),
      ],
    }),
    activeNodeId: "a",
    activeLeafPath: ["root", "a"],
    maxDepth: 6,
    planRevision: 1,
    stalledCount: 0,
    updatedAt: 1,
  };
}

describe("plan-tree helpers", () => {
  it("creates a synthetic tree from legacy work items", () => {
    const next = ensurePlanTreeFromItems(
      {
        targetId: "tgt-legacy",
        decompositionGenerated: true,
        decompositionMode: "stage",
        items: [
          {
            id: "stage-1",
            kind: "stage",
            title: "Inspect behavior",
            objective: "Understand current behavior",
            deliverable: "Behavior notes",
            acceptanceCriteria: ["Behavior is documented"],
            status: "in_progress",
          },
          {
            id: "stage-2",
            kind: "stage",
            title: "Implement fix",
            objective: "Make the change",
            deliverable: "Working fix",
            acceptanceCriteria: ["Focused tests pass"],
            status: "pending",
          },
        ],
        activeItemId: "stage-1",
        maxDepth: 6,
        planRevision: 0,
        stalledCount: 0,
        updatedAt: 1,
      },
      10
    );

    expect(next.planTree?.id).toBe("tgt-legacy-root");
    expect(next.planTree?.children.map((item) => item.id)).toEqual(["stage-1", "stage-2"]);
    expect(next.planTree?.children[0]?.parentId).toBe("tgt-legacy-root");
    expect(next.activeNodeId).toBe("stage-1");
    expect(next.activeLeafPath).toEqual(["tgt-legacy-root", "stage-1"]);
    expect(next.planRevision).toBe(1);
  });

  it("finds a node path by id", () => {
    expect(findNodePath(memory().planTree!, "a")?.map((item) => item.id)).toEqual(["root", "a"]);
  });

  it("resolves the active node from memory", () => {
    expect(resolveActiveNode(memory())?.id).toBe("a");
  });

  it("attaches children only to the active parent and updates active path", () => {
    const next = attachChildNodes(memory(), "a", [
      node({ id: "a-1", title: "A1", status: "in_progress", taskType: "writing" }),
      node({ id: "a-2", title: "A2", status: "pending", taskType: "writing" }),
    ], 10);

    expect(next.planTree?.children[0]?.children.map((item) => item.id)).toEqual(["a-1", "a-2"]);
    expect(next.planTree?.children[1]?.children).toEqual([]);
    expect(next.activeNodeId).toBe("a-1");
    expect(next.activeLeafPath).toEqual(["root", "a", "a-1"]);
    expect(next.planRevision).toBe(2);
  });

  it("stores ready check on a node without replacing siblings", () => {
    const next = saveReadyCheckOnNode(
      memory(),
      "a",
      {
        granularity: "too_large",
        reason: "A is too broad",
        checkedAt: 7,
      },
      8
    );

    expect(next.planTree?.children[0]?.readyCheck?.reason).toBe("A is too broad");
    expect(next.planTree?.children[1]?.readyCheck).toBeUndefined();
  });

  it("marks active leaf done and advances to the next sibling", () => {
    const next = markActiveLeafDone(memory(), "a", 9);

    expect(next.planTree?.children[0]?.status).toBe("done");
    expect(next.planTree?.children[1]?.status).toBe("in_progress");
    expect(next.activeNodeId).toBe("b");
    expect(getActiveLeafPath(next).map((item) => item.id)).toEqual(["root", "b"]);
    expect(next.planRevision).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/plan-tree.test.ts
```

Expected: FAIL because `plan-tree.ts` does not exist.

- [ ] **Step 3: Create `plan-tree.ts`**

Create `packages/server/src/supervisor/plan-tree.ts`:

```ts
import type {
  SupervisorPlanNode,
  SupervisorPlanNodeReadyCheck,
  SupervisorTargetMemory,
} from "@coder-studio/core";

type NodeMapper = (node: SupervisorPlanNode) => SupervisorPlanNode;

export function findNodePath(
  root: SupervisorPlanNode | undefined,
  nodeId: string
): SupervisorPlanNode[] | null {
  if (!root) {
    return null;
  }
  if (root.id === nodeId) {
    return [root];
  }
  for (const child of root.children) {
    const path = findNodePath(child, nodeId);
    if (path) {
      return [root, ...path];
    }
  }
  return null;
}

export function getActiveLeafPath(memory: SupervisorTargetMemory): SupervisorPlanNode[] {
  const root = memory.planTree;
  if (!root) {
    return [];
  }
  const byActive = memory.activeNodeId ? findNodePath(root, memory.activeNodeId) : null;
  if (byActive) {
    return byActive;
  }
  const first = findFirstRunnablePath(root);
  return first ?? [root];
}

export function resolveActiveNode(memory: SupervisorTargetMemory): SupervisorPlanNode | null {
  const path = getActiveLeafPath(memory);
  return path[path.length - 1] ?? null;
}

export function ensurePlanTreeFromItems(
  memory: SupervisorTargetMemory,
  updatedAt: number
): SupervisorTargetMemory {
  if (memory.planTree || memory.items.length === 0) {
    return memory;
  }
  const rootId = `${memory.targetId}-root`;
  const children: SupervisorPlanNode[] = memory.items.map((item) => ({
    id: item.id,
    parentId: rootId,
    title: item.title,
    objective: item.objective,
    deliverable: item.deliverable,
    acceptanceCriteria: item.acceptanceCriteria,
    status: item.status,
    taskType: "generic",
    depth: 1,
    children: [],
  }));
  const activeNodeId =
    memory.activeItemId && children.some((item) => item.id === memory.activeItemId)
      ? memory.activeItemId
      : children.find((item) => item.status === "in_progress")?.id ??
        children.find((item) => item.status === "pending")?.id ??
        children[0]?.id;
  return {
    ...memory,
    planTree: {
      id: rootId,
      title: "Supervisor target",
      objective: "Complete the supervised target",
      deliverable: "Completed target",
      acceptanceCriteria: ["Target objective is complete"],
      status: children.every((item) => item.status === "done") ? "done" : "in_progress",
      taskType: "generic",
      depth: 0,
      children,
    },
    activeNodeId,
    activeLeafPath: activeNodeId ? [rootId, activeNodeId] : [rootId],
    planRevision: memory.planRevision + 1,
    updatedAt,
  };
}

export function attachChildNodes(
  memory: SupervisorTargetMemory,
  parentId: string,
  children: SupervisorPlanNode[],
  updatedAt: number
): SupervisorTargetMemory {
  const parentPath = findNodePath(memory.planTree, parentId);
  const parentDepth = parentPath?.[parentPath.length - 1]?.depth ?? 0;
  const normalizedChildren = children.map((child, index) => ({
    ...child,
    parentId,
    depth: parentDepth + 1,
    status: index === 0 ? "in_progress" : child.status === "done" ? "done" : "pending",
    children: child.children ?? [],
  }));
  const activeNodeId =
    normalizedChildren.find((child) => child.status === "in_progress")?.id ??
    normalizedChildren.find((child) => child.status === "pending")?.id ??
    normalizedChildren[0]?.id;
  const nextRoot = mapNode(memory.planTree, parentId, (node) => ({
    ...node,
    status: "in_progress",
    children: normalizedChildren,
  }));
  const activeLeafPath =
    nextRoot && activeNodeId ? findNodePath(nextRoot, activeNodeId)?.map((node) => node.id) : undefined;
  return {
    ...memory,
    planTree: nextRoot,
    activeNodeId,
    activeLeafPath,
    planRevision: memory.planRevision + 1,
    updatedAt,
  };
}

export function saveReadyCheckOnNode(
  memory: SupervisorTargetMemory,
  nodeId: string,
  readyCheck: SupervisorPlanNodeReadyCheck,
  updatedAt: number
): SupervisorTargetMemory {
  return {
    ...memory,
    planTree: mapNode(memory.planTree, nodeId, (node) => ({ ...node, readyCheck })),
    updatedAt,
  };
}

export function saveExecutionOnNode(
  memory: SupervisorTargetMemory,
  nodeId: string,
  guidance: string,
  updatedAt: number
): SupervisorTargetMemory {
  return {
    ...memory,
    planTree: mapNode(memory.planTree, nodeId, (node) => ({
      ...node,
      execution: { executable: true, guidance, lastInjectedAt: updatedAt },
    })),
    lastGuidance: guidance,
    updatedAt,
  };
}

export function markActiveLeafDone(
  memory: SupervisorTargetMemory,
  nodeId: string,
  updatedAt: number
): SupervisorTargetMemory {
  let root = mapNode(memory.planTree, nodeId, (node) => ({ ...node, status: "done" }));
  root = rollupDone(root);
  const nextPath = root ? findFirstRunnablePath(root) : null;
  const nextActiveId = nextPath?.[nextPath.length - 1]?.id;
  if (root && nextActiveId) {
    root = mapNode(root, nextActiveId, (node) =>
      node.status === "pending" ? { ...node, status: "in_progress" } : node
    );
  }
  return {
    ...memory,
    planTree: root,
    activeNodeId: nextActiveId,
    activeLeafPath: nextPath?.map((node) => node.id),
    planRevision: memory.planRevision + 1,
    updatedAt,
  };
}

function mapNode(
  node: SupervisorPlanNode | undefined,
  nodeId: string,
  mapper: NodeMapper
): SupervisorPlanNode | undefined {
  if (!node) {
    return undefined;
  }
  if (node.id === nodeId) {
    return mapper(node);
  }
  return {
    ...node,
    children: node.children.map((child) => mapNode(child, nodeId, mapper) ?? child),
  };
}

function findFirstRunnablePath(node: SupervisorPlanNode): SupervisorPlanNode[] | null {
  if (node.children.length === 0 && node.status !== "done" && node.status !== "blocked") {
    return [node];
  }
  for (const child of node.children) {
    if (child.status === "done" || child.status === "blocked") {
      continue;
    }
    const childPath = findFirstRunnablePath(child);
    if (childPath) {
      return [node, ...childPath];
    }
  }
  return null;
}

function rollupDone(node: SupervisorPlanNode | undefined): SupervisorPlanNode | undefined {
  if (!node) {
    return undefined;
  }
  const children = node.children.map((child) => rollupDone(child) ?? child);
  const allChildrenDone = children.length > 0 && children.every((child) => child.status === "done");
  return {
    ...node,
    children,
    status: allChildrenDone ? "done" : node.status,
  };
}
```

- [ ] **Step 4: Run the plan-tree tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/plan-tree.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/supervisor/plan-tree.ts packages/server/src/supervisor/plan-tree.test.ts
git commit -m "feat(server): add supervisor plan tree helpers"
```

---

## Task 4: Evaluator Modes And Parser

**Files:**
- Modify: `packages/server/src/supervisor/evaluator.ts`
- Modify: `packages/server/src/supervisor/evaluator.test.ts`

- [ ] **Step 1: Add parser tests for new modes**

Append these tests to `packages/server/src/supervisor/evaluator.test.ts` before the abort/process tests:

```ts
it("parses a ready_check result", async () => {
  const evaluator = makeEvaluator(
    JSON.stringify({
      mode: "ready_check",
      nodeId: "volume-1",
      taskType: "writing",
      granularity: "too_large",
      reason: "A full volume is too broad",
      recommendedUnit: "scene_card",
      qualityRisk: "large_scope_quality_loss",
      missingInputs: ["scene conflict"],
      confidence: "high",
    }),
    "claude"
  );

  await expect(evaluator.evaluate(makeSupervisor("claude"), makeContext(), { mode: "ready_check" })).resolves.toEqual({
    mode: "ready_check",
    nodeId: "volume-1",
    taskType: "writing",
    granularity: "too_large",
    reason: "A full volume is too broad",
    recommendedUnit: "scene_card",
    qualityRisk: "large_scope_quality_loss",
    missingInputs: ["scene conflict"],
    confidence: "high",
  });
});

it("rejects ready_check results without granularity", async () => {
  const evaluator = makeEvaluator(
    JSON.stringify({
      mode: "ready_check",
      nodeId: "volume-1",
      taskType: "writing",
      reason: "Missing granularity",
    }),
    "claude"
  );

  await expect(
    evaluator.evaluate(makeSupervisor("claude"), makeContext(), { mode: "ready_check" })
  ).rejects.toThrow(/ready_check result is missing a valid granularity/i);
});

it("parses a decompose_child result", async () => {
  const evaluator = makeEvaluator(
    JSON.stringify({
      mode: "decompose_child",
      parentNodeId: "volume-1",
      children: [
        {
          id: "scene-card-1",
          title: "Create scene card",
          objective: "Prepare scene 1",
          deliverable: "Scene card",
          acceptanceCriteria: ["Conflict is explicit"],
          taskType: "writing",
          status: "in_progress",
        },
      ],
      activeNodeId: "scene-card-1",
      progressSummary: "Split volume into a scene card",
    }),
    "claude"
  );

  const result = await evaluator.evaluate(makeSupervisor("claude"), makeContext(), {
    mode: "decompose_child",
  });

  expect(result).toEqual(
    expect.objectContaining({
      mode: "decompose_child",
      parentNodeId: "volume-1",
      activeNodeId: "scene-card-1",
    })
  );
  expect(result.children?.[0]?.taskType).toBe("writing");
});

it("parses an executable_task result", async () => {
  const evaluator = makeEvaluator(
    JSON.stringify({
      mode: "executable_task",
      nodeId: "scene-card-1",
      guidance: "Create a 500-800 word scene card before drafting prose.",
      fallback: true,
    }),
    "claude"
  );

  await expect(
    evaluator.evaluate(makeSupervisor("claude"), makeContext(), { mode: "executable_task" })
  ).resolves.toEqual({
    mode: "executable_task",
    nodeId: "scene-card-1",
    guidance: "Create a 500-800 word scene card before drafting prose.",
    fallback: true,
  });
});
```

Add this prompt coverage test in the same file near the existing prompt tests:

```ts
it("builds prompts for recursive planning evaluator modes", async () => {
  for (const [mode, expected] of [
    ["ready_check", "You are a task-granularity supervisor."],
    ["decompose_child", "You are a lazy recursive planning supervisor."],
    ["executable_task", "You are a supervisor preparing one concrete instruction for an AI execution agent."],
  ] as const) {
    const logger = createLogger();
    const evaluator = new SupervisorEvaluator({
      providerRegistry: [createProvider("codex", "")],
      providerConfigRepo: createProviderConfigRepo(),
      timeoutMs: 5000,
      logger,
    });

    await expect(
      evaluator.evaluate(makeSupervisor("codex"), makeContext(), { mode })
    ).rejects.toThrow();

    const prompt = (logger.warn.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt;
    expect(prompt).toContain(expected);
    expect(prompt).toContain("Return JSON only.");
    expect(prompt).toContain("Current target memory:");
    expect(prompt).toContain("Current terminal snapshot:");
  }
});
```

- [ ] **Step 2: Run evaluator tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/evaluator.test.ts
```

Expected: FAIL because `EvaluateOptions.mode` and parser do not support the new modes.

- [ ] **Step 3: Extend evaluator result interfaces**

In `packages/server/src/supervisor/evaluator.ts`, import:

```ts
  type SupervisorGranularity,
  type SupervisorPlanNode,
  type SupervisorTaskType,
```

Add interfaces after `SupervisorStopResult`:

```ts
export interface SupervisorReadyCheckResult {
  mode: "ready_check";
  nodeId: string;
  taskType: SupervisorTaskType;
  granularity: SupervisorGranularity;
  reason: string;
  recommendedUnit?: string;
  qualityRisk?: string;
  missingInputs?: string[];
  confidence?: "low" | "medium" | "high";
}

export interface SupervisorDecomposeChildResult {
  mode: "decompose_child";
  parentNodeId: string;
  children: SupervisorPlanNode[];
  activeNodeId?: string;
  progressSummary?: string;
}

export interface SupervisorExecutableTaskResult {
  mode: "executable_task";
  nodeId: string;
  guidance: string;
  fallback?: boolean;
}
```

Change `SupervisorEvaluationResult` to include these interfaces. Change `EvaluateOptions.mode` and `buildPrompt` requested mode to:

```ts
type SupervisorEvaluatorMode =
  | "decompose"
  | "evaluate"
  | "ready_check"
  | "decompose_child"
  | "executable_task";
```

- [ ] **Step 4: Add parser helpers**

Add helpers near parser code:

```ts
function readTaskType(value: unknown): SupervisorTaskType {
  return value === "coding" ||
    value === "writing" ||
    value === "research" ||
    value === "design" ||
    value === "generic"
    ? value
    : "generic";
}

function readGranularity(value: unknown): SupervisorGranularity | undefined {
  return value === "too_large" || value === "ready" || value === "too_small" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.flatMap<string>((entry) =>
    typeof entry === "string" && entry.trim() ? [entry.trim()] : []
  );
  return values.length > 0 ? values : undefined;
}

function parsePlanNode(value: unknown, fallbackParentId: string): SupervisorPlanNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const node = value as Record<string, unknown>;
  if (
    typeof node.id !== "string" ||
    typeof node.title !== "string" ||
    typeof node.objective !== "string" ||
    typeof node.deliverable !== "string" ||
    !Array.isArray(node.acceptanceCriteria) ||
    node.acceptanceCriteria.some((entry) => typeof entry !== "string")
  ) {
    return null;
  }
  const status =
    node.status === "done" || node.status === "blocked" || node.status === "in_progress"
      ? node.status
      : "pending";
  return {
    id: node.id,
    parentId: typeof node.parentId === "string" ? node.parentId : fallbackParentId,
    title: node.title,
    objective: node.objective,
    deliverable: node.deliverable,
    acceptanceCriteria: node.acceptanceCriteria as string[],
    status,
    taskType: readTaskType(node.taskType),
    depth: typeof node.depth === "number" && Number.isSafeInteger(node.depth) ? node.depth : 0,
    children: [],
  };
}
```

- [ ] **Step 5: Add parser branches**

In `parseSupervisorEvaluationResult`, after `record` is created and before the old `requestedMode === "decompose"` branch, add branches for the new modes:

```ts
  if (requestedMode === "ready_check") {
    if (payloadMode !== "ready_check") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid ready_check payload");
    }
    const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    const granularity = readGranularity(record.granularity);
    if (!nodeId || !reason || !granularity) {
      throw createSupervisorEvalFailedError(
        "Supervisor ready_check result is missing a valid granularity"
      );
    }
    const confidence =
      record.confidence === "low" || record.confidence === "medium" || record.confidence === "high"
        ? record.confidence
        : undefined;
    return {
      mode: "ready_check",
      nodeId,
      taskType: readTaskType(record.taskType),
      granularity,
      reason,
      recommendedUnit:
        typeof record.recommendedUnit === "string" && record.recommendedUnit.trim()
          ? record.recommendedUnit.trim()
          : undefined,
      qualityRisk:
        typeof record.qualityRisk === "string" && record.qualityRisk.trim()
          ? record.qualityRisk.trim()
          : undefined,
      missingInputs: readStringArray(record.missingInputs),
      confidence,
    };
  }

  if (requestedMode === "decompose_child") {
    if (payloadMode !== "decompose_child") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid decompose_child payload");
    }
    const parentNodeId =
      typeof record.parentNodeId === "string" && record.parentNodeId.trim()
        ? record.parentNodeId.trim()
        : "";
    const children = Array.isArray(record.children)
      ? record.children.flatMap<SupervisorPlanNode>((value) => {
          const child = parsePlanNode(value, parentNodeId);
          return child ? [child] : [];
        })
      : [];
    if (!parentNodeId || children.length === 0) {
      throw createSupervisorEvalFailedError(
        "Supervisor decompose_child result must include a parentNodeId and children"
      );
    }
    return {
      mode: "decompose_child",
      parentNodeId,
      children,
      activeNodeId:
        typeof record.activeNodeId === "string" && record.activeNodeId.trim()
          ? record.activeNodeId.trim()
          : undefined,
      progressSummary:
        typeof record.progressSummary === "string" && record.progressSummary.trim()
          ? record.progressSummary.trim()
          : undefined,
    };
  }

  if (requestedMode === "executable_task") {
    if (payloadMode !== "executable_task") {
      throw createSupervisorEvalFailedError("Supervisor returned invalid executable_task payload");
    }
    const nodeId = typeof record.nodeId === "string" ? record.nodeId.trim() : "";
    const guidance = typeof record.guidance === "string" ? record.guidance.trim() : "";
    if (!nodeId || !guidance) {
      throw createSupervisorEvalFailedError(
        "Supervisor executable_task result must include nodeId and guidance"
      );
    }
    return {
      mode: "executable_task",
      nodeId,
      guidance: guidance.slice(0, guidanceMaxChars),
      fallback: record.fallback === true,
    };
  }
```

- [ ] **Step 6: Add prompt branches**

In `buildPrompt`, add this line to the existing evaluate prompt's `"Evaluation policy:"` section:

```ts
    "- When targetMemory.planTree exists, use itemUpdates with the active plan node id to mark the active leaf done; the manager will advance activeNodeId from the tree.",
```

Then add branches before the existing evaluate branch.

For `ready_check`, include:

```ts
  if (mode === "ready_check") {
    return [
      "You are a task-granularity supervisor.",
      "Decide whether the current active plan node is ready to be handed to an AI execution agent.",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      'Use granularity "too_large" when the node is too broad for one high-quality execution step.',
      'Use granularity "ready" when the node has a clear deliverable, bounded scope, and observable acceptance criteria.',
      'Use granularity "too_small" when the node is so tiny that execution would lose coherence or quality.',
      "For writing work, prefer scene cards, character cards, chapter outlines, and 1500-3000 word scene drafts as ready units.",
      "For coding work, prefer one verifiable behavior, one failing test to passing, or one small module boundary as ready units.",
      "",
      "Output schema:",
      "{",
      '  "mode": "ready_check",',
      '  "nodeId": string,',
      '  "taskType": "coding" | "writing" | "research" | "design" | "generic",',
      '  "granularity": "too_large" | "ready" | "too_small",',
      '  "reason": string,',
      '  "recommendedUnit": optional string,',
      '  "qualityRisk": optional string,',
      '  "missingInputs": optional string[],',
      '  "confidence": optional "low" | "medium" | "high"',
      "}",
      "",
      "Current objective:",
      context.objective,
      "",
      "Current target memory:",
      JSON.stringify(context.targetMemory, null, 2),
      "",
      "Current terminal snapshot:",
      context.terminalExcerpt || "(no output yet)",
    ].join("\n");
  }
```

For `decompose_child`, include:

```ts
  if (mode === "decompose_child") {
    return [
      "You are a lazy recursive planning supervisor.",
      "Split only the current active plan node into smaller child nodes.",
      "Do not split sibling nodes or future branches.",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "Produce 2-7 children unless the current node naturally has only one safe preparatory child.",
      'The first executable child should usually have status "in_progress"; later siblings should be "pending".',
      "Each child must have a bounded deliverable and observable acceptance criteria.",
      "Use stable ids derived from the parent id and child purpose.",
      "",
      "Output schema:",
      "{",
      '  "mode": "decompose_child",',
      '  "parentNodeId": string,',
      '  "children": [',
      "    {",
      '      "id": string,',
      '      "parentId": optional string,',
      '      "title": string,',
      '      "objective": string,',
      '      "deliverable": string,',
      '      "acceptanceCriteria": string[],',
      '      "status": "pending" | "in_progress" | "done" | "blocked",',
      '      "taskType": "coding" | "writing" | "research" | "design" | "generic"',
      "    }",
      "  ],",
      '  "activeNodeId": optional string,',
      '  "progressSummary": optional string',
      "}",
      "",
      "Current objective:",
      context.objective,
      "",
      "Current target memory:",
      JSON.stringify(context.targetMemory, null, 2),
      "",
      "Current terminal snapshot:",
      context.terminalExcerpt || "(no output yet)",
    ].join("\n");
  }
```

For `executable_task`, include:

```ts
  if (mode === "executable_task") {
    return [
      "You are a supervisor preparing one concrete instruction for an AI execution agent.",
      "Generate guidance for the current active leaf node only.",
      "Return JSON only.",
      "No prose before or after the JSON.",
      "",
      "The guidance must be specific enough for the execution agent to start immediately.",
      "Include the expected deliverable and acceptance criteria in the guidance.",
      "Do not ask the agent to complete broad sibling work or future branches.",
      "When the node is still too large because maxDepth has been reached, convert it into a preparatory or range-limited task and set fallback to true.",
      "For writing fallback examples: scene card, character card, chapter outline, or one bounded scene draft.",
      "For coding fallback examples: write one failing test, inspect one module boundary, or implement one small behavior.",
      "",
      "Output schema:",
      "{",
      '  "mode": "executable_task",',
      '  "nodeId": string,',
      '  "guidance": string,',
      '  "fallback": optional boolean',
      "}",
      "",
      "Current objective:",
      context.objective,
      "",
      "Current target memory:",
      JSON.stringify(context.targetMemory, null, 2),
      "",
      "Current terminal snapshot:",
      context.terminalExcerpt || "(no output yet)",
    ].join("\n");
  }
```

- [ ] **Step 7: Run evaluator tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/evaluator.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/supervisor/evaluator.ts packages/server/src/supervisor/evaluator.test.ts
git commit -m "feat(server): add supervisor readiness evaluator modes"
```

---

## Task 5: Manager Recursive Preparation Flow

**Files:**
- Modify: `packages/server/src/supervisor/manager.ts`
- Modify: `packages/server/src/supervisor/manager.test.ts`

- [ ] **Step 1: Add manager test for recursive ready preparation**

In `packages/server/src/supervisor/manager.test.ts`, add a provider factory that returns different payloads per evaluator call:

```ts
function createSequenceProvider(payloads: unknown[]): ProviderDefinition {
  let index = 0;
  return {
    ...createProvider(),
    headless: {
      supportedScenarios: ["supervisor_eval"],
      buildCommand: vi.fn(() => {
        const payload = payloads[Math.min(index, payloads.length - 1)];
        index += 1;
        return {
          argv: [
            "node",
            "-e",
            `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`,
          ],
          cwd: process.cwd(),
          env: {},
        };
      }),
    },
  } as unknown as ProviderDefinition;
}
```

Add this test:

```ts
it("recursively decomposes only the active branch before injecting executable guidance", async () => {
  deps.providerRegistry = [
    createSequenceProvider([
      {
        mode: "decompose",
        decompositionMode: "stage",
        items: [
          {
            id: "volume-1",
            kind: "stage",
            title: "Volume 1",
            objective: "Draft the first volume",
            deliverable: "A full first volume",
            acceptanceCriteria: ["Volume 1 has a complete arc"],
            status: "in_progress",
          },
          {
            id: "volume-2",
            kind: "stage",
            title: "Volume 2",
            objective: "Draft the second volume",
            deliverable: "A full second volume",
            acceptanceCriteria: ["Volume 2 has a complete arc"],
            status: "pending",
          },
        ],
        activeItemId: "volume-1",
      },
      {
        mode: "ready_check",
        nodeId: "volume-1",
        taskType: "writing",
        granularity: "too_large",
        reason: "A full volume is too broad",
      },
      {
        mode: "decompose_child",
        parentNodeId: "volume-1",
        children: [
          {
            id: "scene-card-1",
            title: "Create first scene card",
            objective: "Prepare the first scene",
            deliverable: "A 500-800 word scene card",
            acceptanceCriteria: ["Conflict is explicit"],
            taskType: "writing",
            status: "in_progress",
          },
        ],
        activeNodeId: "scene-card-1",
      },
      {
        mode: "ready_check",
        nodeId: "scene-card-1",
        taskType: "writing",
        granularity: "ready",
        reason: "A scene card is an executable writing task",
      },
      {
        mode: "executable_task",
        nodeId: "scene-card-1",
        guidance: "Create a 500-800 word scene card for the first scene.",
      },
      {
        mode: "evaluate",
        status: "continue",
        reason: "The scene card still needs to be written",
        guidance: "Create a 500-800 word scene card for the first scene.",
      },
    ]),
  ];
  deps.targetStore.loadTargetMemory.mockResolvedValue({
    targetId: "tgt-1",
    decompositionGenerated: false,
    items: [],
    stalledCount: 0,
    maxDepth: 6,
    planRevision: 0,
    updatedAt: 1,
  });

  const manager = new SupervisorManager(
    deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
  );
  const supervisor = await manager.create({
    sessionId: "sess-1",
    workspaceId: "ws-1",
    objective: "Write a 1M word novel",
    evaluatorProviderId: "claude",
  });

  await manager.runEvaluation(supervisor.id, "turn_completed");

  const savedMemory = deps.targetStore.saveTargetMemory.mock.calls.at(-1)?.[2];
  expect(savedMemory?.planTree?.children[0]?.children[0]?.id).toBe("scene-card-1");
  expect(savedMemory?.planTree?.children[1]?.children).toEqual([]);
  expect(savedMemory?.activeNodeId).toBe("scene-card-1");
  expect(deps.terminalMgr.write).toHaveBeenCalledWith(
    "term-1",
    expect.stringContaining("Create a 500-800 word scene card")
  );
});
```

- [ ] **Step 2: Add manager test for maxDepth fallback**

Add:

```ts
it("uses fallback executable guidance when maxDepth is reached and node is still too large", async () => {
  deps.providerRegistry = [
    createSequenceProvider([
      {
        mode: "ready_check",
        nodeId: "scene-1",
        taskType: "writing",
        granularity: "too_large",
        reason: "The scene still lacks enough structure",
      },
      {
        mode: "executable_task",
        nodeId: "scene-1",
        guidance: "Create a scene card before drafting the full scene.",
        fallback: true,
      },
      {
        mode: "evaluate",
        status: "continue",
        reason: "The scene card still needs to be created",
        guidance: "Create a scene card before drafting the full scene.",
      },
    ]),
  ];
  deps.targetStore.loadTargetMemory.mockResolvedValue({
    targetId: "tgt-1",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [],
    planTree: {
      id: "root",
      title: "Novel",
      objective: "Write the novel",
      deliverable: "Novel",
      acceptanceCriteria: ["Novel is complete"],
      status: "in_progress",
      taskType: "writing",
      depth: 0,
      children: [
        {
          id: "scene-1",
          parentId: "root",
          title: "Scene 1",
          objective: "Draft scene 1",
          deliverable: "Scene 1 draft",
          acceptanceCriteria: ["Scene 1 is coherent"],
          status: "in_progress",
          taskType: "writing",
          depth: 6,
          children: [],
        },
      ],
    },
    activeNodeId: "scene-1",
    activeLeafPath: ["root", "scene-1"],
    maxDepth: 6,
    planRevision: 1,
    stalledCount: 0,
    updatedAt: 1,
  });

  const manager = new SupervisorManager(
    deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
  );
  const supervisor = await manager.create({
    sessionId: "sess-1",
    workspaceId: "ws-1",
    objective: "Write a 1M word novel",
    evaluatorProviderId: "claude",
  });

  await manager.runEvaluation(supervisor.id, "turn_completed");

  expect(deps.terminalMgr.write).toHaveBeenCalledWith(
    "term-1",
    expect.stringContaining("Create a scene card before drafting")
  );
});
```

- [ ] **Step 3: Add manager test for leaf advancement**

Add:

```ts
it("advances the active plan leaf when evaluation marks it done", async () => {
  deps.providerRegistry = [
    createSequenceProvider([
      {
        mode: "ready_check",
        nodeId: "scene-1",
        taskType: "writing",
        granularity: "ready",
        reason: "Scene 1 is bounded",
      },
      {
        mode: "executable_task",
        nodeId: "scene-1",
        guidance: "Draft scene 1 with a clear conflict and outcome.",
      },
      {
        mode: "evaluate",
        status: "continue",
        reason: "Scene 1 is complete, continue to scene 2",
        guidance: "Draft scene 2 with the same constraints.",
        itemUpdates: [{ id: "scene-1", status: "done" }],
      },
    ]),
  ];
  deps.targetStore.loadTargetMemory.mockResolvedValue({
    targetId: "tgt-1",
    decompositionGenerated: true,
    decompositionMode: "stage",
    items: [],
    planTree: {
      id: "root",
      title: "Novel",
      objective: "Write the novel",
      deliverable: "Novel",
      acceptanceCriteria: ["Novel is complete"],
      status: "in_progress",
      taskType: "writing",
      depth: 0,
      children: [
        {
          id: "scene-1",
          parentId: "root",
          title: "Scene 1",
          objective: "Draft scene 1",
          deliverable: "Scene 1 draft",
          acceptanceCriteria: ["Scene 1 is coherent"],
          status: "in_progress",
          taskType: "writing",
          depth: 1,
          children: [],
        },
        {
          id: "scene-2",
          parentId: "root",
          title: "Scene 2",
          objective: "Draft scene 2",
          deliverable: "Scene 2 draft",
          acceptanceCriteria: ["Scene 2 is coherent"],
          status: "pending",
          taskType: "writing",
          depth: 1,
          children: [],
        },
      ],
    },
    activeNodeId: "scene-1",
    activeLeafPath: ["root", "scene-1"],
    maxDepth: 6,
    planRevision: 1,
    stalledCount: 0,
    updatedAt: 1,
  });

  const manager = new SupervisorManager(
    deps as unknown as ConstructorParameters<typeof SupervisorManager>[0]
  );
  const supervisor = await manager.create({
    sessionId: "sess-1",
    workspaceId: "ws-1",
    objective: "Write a 1M word novel",
    evaluatorProviderId: "claude",
  });

  await manager.runEvaluation(supervisor.id, "turn_completed");

  const savedMemory = deps.targetStore.saveTargetMemory.mock.calls.at(-1)?.[2];
  expect(savedMemory?.planTree?.children[0]?.status).toBe("done");
  expect(savedMemory?.planTree?.children[1]?.status).toBe("in_progress");
  expect(savedMemory?.activeNodeId).toBe("scene-2");
  expect(savedMemory?.activeLeafPath).toEqual(["root", "scene-2"]);
});
```

- [ ] **Step 4: Run manager tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/manager.test.ts
```

Expected: FAIL because manager does not run ready checks or child decomposition before injection.

- [ ] **Step 5: Import plan-tree helpers**

In `packages/server/src/supervisor/manager.ts`, import:

```ts
import {
  attachChildNodes,
  ensurePlanTreeFromItems,
  markActiveLeafDone,
  resolveActiveNode,
  saveExecutionOnNode,
  saveReadyCheckOnNode,
} from "./plan-tree.js";
```

Also import result types:

```ts
  type SupervisorDecomposeChildResult,
  type SupervisorExecutableTaskResult,
  type SupervisorReadyCheckResult,
```

- [ ] **Step 6: Add type guards**

Add near existing type guards:

```ts
function isReadyCheckResult(
  result: SupervisorEvaluationResult | { mode?: string }
): result is SupervisorReadyCheckResult {
  return result.mode === "ready_check";
}

function isDecomposeChildResult(
  result: SupervisorEvaluationResult | { mode?: string }
): result is SupervisorDecomposeChildResult {
  return result.mode === "decompose_child";
}

function isExecutableTaskResult(
  result: SupervisorEvaluationResult | { mode?: string }
): result is SupervisorExecutableTaskResult {
  return result.mode === "executable_task";
}
```

- [ ] **Step 7: Add `prepareExecutableNode`**

Add this private method to `SupervisorManager` before `executeCycleWithRetry`:

```ts
private async prepareExecutableNode(
  supervisor: Supervisor,
  context: SupervisorEvaluationContext,
  targetId: string,
  signal?: AbortSignal
): Promise<{ context: SupervisorEvaluationContext; guidance: string | undefined }> {
  let currentMemory = context.targetMemory;
  let currentContext = context;

  for (let guard = 0; guard < currentMemory.maxDepth + 2; guard += 1) {
    const activeNode = resolveActiveNode(currentMemory);
    if (!activeNode) {
      return { context: currentContext, guidance: undefined };
    }

    const ready = await this.evaluator.evaluate(supervisor, currentContext, {
      signal,
      mode: "ready_check",
    });
    if (!isReadyCheckResult(ready)) {
      throw new Error("Supervisor ready_check pass did not return a ready_check result");
    }

    currentMemory = saveReadyCheckOnNode(
      currentMemory,
      activeNode.id,
      { ...ready, checkedAt: Date.now() },
      Date.now()
    );
    await this.savePreparedMemory(
      supervisor.id,
      currentContext.workspacePath,
      targetId,
      currentMemory
    );
    currentContext = { ...currentContext, targetMemory: currentMemory };

    if (ready.granularity === "ready" || activeNode.depth >= currentMemory.maxDepth) {
      const executable = await this.evaluator.evaluate(supervisor, currentContext, {
        signal,
        mode: "executable_task",
      });
      if (!isExecutableTaskResult(executable)) {
        throw new Error("Supervisor executable_task pass did not return executable guidance");
      }
      currentMemory = saveExecutionOnNode(
        currentMemory,
        activeNode.id,
        executable.guidance,
        Date.now()
      );
      await this.savePreparedMemory(
        supervisor.id,
        currentContext.workspacePath,
        targetId,
        currentMemory
      );
      return {
        context: { ...currentContext, targetMemory: currentMemory },
        guidance: executable.guidance,
      };
    }

    if (ready.granularity === "too_small") {
      return { context: { ...currentContext, targetMemory: currentMemory }, guidance: undefined };
    }

    const decomposed = await this.evaluator.evaluate(supervisor, currentContext, {
      signal,
      mode: "decompose_child",
    });
    if (!isDecomposeChildResult(decomposed)) {
      throw new Error("Supervisor decompose_child pass did not return children");
    }
    currentMemory = attachChildNodes(currentMemory, activeNode.id, decomposed.children, Date.now());
    if (decomposed.progressSummary) {
      currentMemory = {
        ...currentMemory,
        progressSummary: decomposed.progressSummary,
      };
    }
    await this.savePreparedMemory(
      supervisor.id,
      currentContext.workspacePath,
      targetId,
      currentMemory
    );
    currentContext = { ...currentContext, targetMemory: currentMemory };
  }

  throw new Error("Supervisor recursive planning exceeded its maxDepth guard");
}
```

Add this helper:

```ts
private async savePreparedMemory(
  supervisorId: string,
  workspacePath: string,
  targetId: string,
  memory: SupervisorTargetMemory
): Promise<void> {
  await this.deps.targetStore.saveTargetMemory(workspacePath, targetId, memory);
  const currentSupervisor = this.supervisors.get(supervisorId);
  if (currentSupervisor?.targetId === targetId) {
    this.storeSnapshot({ ...currentSupervisor, currentTargetMemory: memory });
  }
}
```

- [ ] **Step 8: Wire preparation into `executeCycleWithRetry`**

In `executeCycleWithRetry`, after the existing initial `decompose` pass builds the new `currentMemory` object and before it is saved, add:

```ts
          currentMemory = ensurePlanTreeFromItems(currentMemory, Date.now());
```

The decompose branch should then save a memory object that has both legacy `items` and `planTree`.

After the existing initial `decompose` pass has saved `currentMemory` and refreshed `context`, call:

```ts
const prepared = await this.prepareExecutableNode(supervisor, context, started.targetId, signal);
context = prepared.context;
currentMemory = prepared.context.targetMemory;
```

Then after the existing evaluate result is parsed and verified as non-`decompose`, choose the injection text like this:

```ts
const guidanceForInjection =
  prepared.guidance?.trim() || (!isEvaluateStopResult(evaluation) ? evaluation.guidance : undefined);
```

Replace the current no-guidance guard with:

```ts
        if (!guidanceForInjection?.trim()) {
          return {
            evaluation,
            injected: false,
            targetMemory: nextTargetMemory,
            attemptCount: attemptIndex + 1,
          };
        }
```

Replace the injector call message with:

```ts
        const injection = await this.injector.inject(
          injectingSupervisor,
          {
            message: guidanceForInjection,
          },
          [],
          { signal }
        );
```

Leave the existing `evaluation` object unchanged for cycle records. The returned `targetMemory` should still call `applyEvaluationToTargetMemory(currentMemory, evaluation, injection.injected ? injection.text : undefined, Date.now())`, so injected prepared guidance becomes `lastGuidance` through `injection.text`.

In `applyEvaluationToTargetMemory`, after the current continue-result memory object is assembled, advance the active tree leaf when evaluator evidence marks that leaf done:

```ts
    const nextMemory: SupervisorTargetMemory = {
      ...memory,
      decompositionGenerated: memory.decompositionGenerated,
      decompositionMode: memory.decompositionMode,
      items,
      activeItemId: evaluation.activeItemId ?? memory.activeItemId,
      progressSummary,
      lastGuidance,
      stalledCount,
      updatedAt,
    };

    const activeNodeId = memory.activeNodeId;
    const activeNodeDone =
      activeNodeId &&
      evaluation.itemUpdates?.some((item) => item.id === activeNodeId && item.status === "done");

    return activeNodeDone ? markActiveLeafDone(nextMemory, activeNodeId, updatedAt) : nextMemory;
```

This keeps the legacy `items` update behavior while allowing recursive child ids such as `scene-card-1` to advance independently of top-level legacy items.

- [ ] **Step 9: Run manager tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/manager.test.ts
```

Expected: PASS.

- [ ] **Step 10: Run focused supervisor test suite**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/evaluator.test.ts src/supervisor/manager.test.ts src/supervisor/target-store.test.ts src/supervisor/plan-tree.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/server/src/supervisor/manager.ts packages/server/src/supervisor/manager.test.ts
git commit -m "feat(server): gate supervisor guidance with recursive planning"
```

---

## Task 6: Compatibility Fixture Updates

**Files:**
- Modify: `packages/server/src/__tests__/supervisor-manager.test.ts`
- Modify: `packages/server/src/supervisor/context-builder.test.ts`
- Modify: `packages/server/src/supervisor/evaluator.windows.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-integration.test.ts`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
- Modify: `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`

- [ ] **Step 1: Update server memory fixtures**

In each server test fixture that constructs `SupervisorTargetMemory` or inline `targetMemory` without a tree, add:

```ts
    planTree: undefined,
    activeNodeId: undefined,
    activeLeafPath: undefined,
    maxDepth: 6,
    planRevision: 0,
```

Apply this to:

```text
packages/server/src/__tests__/supervisor-manager.test.ts
packages/server/src/supervisor/context-builder.test.ts
packages/server/src/supervisor/evaluator.windows.test.ts
packages/server/src/__tests__/supervisor-integration.test.ts
```

For `cloneMemory` in `packages/server/src/__tests__/supervisor-manager.test.ts`, preserve the tree by adding:

```ts
    planTree: memory.planTree ? structuredClone(memory.planTree) : undefined,
    activeLeafPath: memory.activeLeafPath ? [...memory.activeLeafPath] : undefined,
```

- [ ] **Step 2: Update web memory fixtures**

In each web fixture that constructs `currentTargetMemory` without a tree, add:

```ts
      planTree: undefined,
      activeNodeId: undefined,
      activeLeafPath: undefined,
      maxDepth: 6,
      planRevision: 0,
```

Apply this to:

```text
packages/web/src/features/supervisor/components/supervisor-card.test.tsx
packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx
packages/web/src/ui-preview/scenes/showcase-scenes.tsx
```

- [ ] **Step 3: Run compatibility tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/supervisor-manager.test.ts src/supervisor/context-builder.test.ts src/supervisor/evaluator.windows.test.ts src/__tests__/supervisor-integration.test.ts
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/components/supervisor-card.test.tsx src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx src/features/supervisor/views/shared/supervisor-details-content.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/supervisor/context-builder.test.ts packages/server/src/supervisor/evaluator.windows.test.ts packages/server/src/__tests__/supervisor-integration.test.ts packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx packages/web/src/ui-preview/scenes/showcase-scenes.tsx
git commit -m "test: update supervisor memory fixtures for plan trees"
```

---

## Task 7: Web Details Tree Display

**Files:**
- Modify: `packages/web/src/features/supervisor/actions/use-supervisor-actions.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add UI test for plan tree rendering**

Add this test to `supervisor-details-content.test.tsx`:

```tsx
it("renders plan tree and current leaf path when recursive planning memory exists", () => {
  const store = createStore();
  window.localStorage.setItem("ui.locale", JSON.stringify("en"));
  store.set(localeAtom, "en");
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(
    supervisorsAtom,
    new Map([
      [
        "sess-1",
        {
          ...createSupervisor(),
          currentTargetMemory: {
            ...createSupervisor().currentTargetMemory,
            planTree: {
              id: "root",
              title: "Write a 1M word novel",
              objective: "Finish the novel through small writing tasks",
              deliverable: "Completed novel",
              acceptanceCriteria: ["Novel is complete"],
              status: "in_progress" as const,
              taskType: "writing" as const,
              depth: 0,
              children: [
                {
                  id: "volume-1",
                  parentId: "root",
                  title: "Volume 1",
                  objective: "Draft the first volume",
                  deliverable: "First volume draft",
                  acceptanceCriteria: ["Volume 1 has a complete arc"],
                  status: "in_progress" as const,
                  taskType: "writing" as const,
                  depth: 1,
                  readyCheck: {
                    granularity: "too_large" as const,
                    reason: "A full volume is too broad",
                    checkedAt: 10,
                  },
                  children: [
                    {
                      id: "scene-card-1",
                      parentId: "volume-1",
                      title: "Create first scene card",
                      objective: "Prepare the first scene",
                      deliverable: "A 500-800 word scene card",
                      acceptanceCriteria: ["Conflict is explicit"],
                      status: "in_progress" as const,
                      taskType: "writing" as const,
                      depth: 2,
                      readyCheck: {
                        granularity: "ready" as const,
                        reason: "A scene card is a good execution unit",
                        checkedAt: 11,
                      },
                      execution: {
                        executable: true,
                        guidance: "Create a 500-800 word scene card.",
                      },
                      children: [],
                    },
                  ],
                },
              ],
            },
            activeNodeId: "scene-card-1",
            activeLeafPath: ["root", "volume-1", "scene-card-1"],
            maxDepth: 6,
            planRevision: 2,
          },
        },
      ],
    ])
  );

  render(
    <Provider store={store}>
      <SupervisorDetailsContent sessionId="sess-1" workspaceId="ws-1" onEdit={vi.fn()} />
    </Provider>
  );

  expect(screen.getByText("Plan Tree")).toBeInTheDocument();
  expect(screen.getByText("Write a 1M word novel")).toBeInTheDocument();
  expect(screen.getByText("Volume 1")).toBeInTheDocument();
  expect(screen.getByText("Create first scene card")).toBeInTheDocument();
  expect(screen.getByText("Current leaf path")).toBeInTheDocument();
  expect(screen.getByText("Write a 1M word novel > Volume 1 > Create first scene card")).toBeInTheDocument();
  expect(screen.getByText("Ready check")).toBeInTheDocument();
  expect(screen.getByText("Ready")).toBeInTheDocument();
  expect(screen.getByText("A scene card is a good execution unit")).toBeInTheDocument();
  expect(screen.getByText("Next executable task")).toBeInTheDocument();
  expect(screen.getByText("Create a 500-800 word scene card.")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx
```

Expected: FAIL because the details view does not render plan tree sections.

- [ ] **Step 3: Update active item derivation**

In `use-supervisor-actions.ts`, change the top import from `@coder-studio/core` to include `SupervisorPlanNode`:

```ts
import type { SupervisorPlanNode, SupervisorState } from "@coder-studio/core";
```

Replace active item derivation with:

```ts
  const activePlanNode =
    targetMemory?.planTree && targetMemory.activeNodeId
      ? findPlanNode(targetMemory.planTree, targetMemory.activeNodeId)
      : null;
  const activeItem =
    activePlanNode ??
    targetMemory?.items.find((item) => item.id === targetMemory.activeItemId) ??
    targetMemory?.items[0] ??
    null;
```

Add helper in the same file:

```ts
function findPlanNode(node: SupervisorPlanNode, nodeId: string): SupervisorPlanNode | null {
  if (node.id === nodeId) {
    return node;
  }
  for (const child of node.children) {
    const match = findPlanNode(child, nodeId);
    if (match) {
      return match;
    }
  }
  return null;
}
```

- [ ] **Step 4: Add details rendering helpers**

In `supervisor-details-content.tsx`, import `SupervisorPlanNode`:

```ts
import type { SupervisorPlanNode } from "@coder-studio/core";
```

Add helpers above the component:

```tsx
function findPlanNodePath(root: SupervisorPlanNode | undefined, ids: string[] | undefined): SupervisorPlanNode[] {
  if (!root || !ids?.length) {
    return [];
  }
  const path: SupervisorPlanNode[] = [];
  let current: SupervisorPlanNode | undefined = root;
  for (const id of ids) {
    if (!current || current.id !== id) {
      current = current?.children.find((child) => child.id === id);
    }
    if (!current) {
      return [];
    }
    path.push(current);
    current = current.children[0];
  }
  return path;
}

function renderPlanNode(node: SupervisorPlanNode, activeNodeId: string | undefined, t: ReturnType<typeof useTranslation>) {
  const isActive = node.id === activeNodeId;
  return (
    <li key={node.id} className={`supervisor-plan-node${isActive ? " supervisor-plan-node--active" : ""}`}>
      <div className="supervisor-plan-node__row">
        <span className="supervisor-plan-node__title">{node.title}</span>
        <Tag color={node.status === "done" ? "green" : node.status === "in_progress" ? "blue" : "neutral"} size="sm" caps={false}>
          {t(`supervisor.target_memory.step_status.${node.status === "blocked" ? "pending" : node.status}`)}
        </Tag>
      </div>
      {node.readyCheck ? (
        <p className="supervisor-plan-node__meta">
          {t(`supervisor.target_memory.granularity.${node.readyCheck.granularity}`)} · {node.readyCheck.reason}
        </p>
      ) : null}
      {node.children.length ? (
        <ul className="supervisor-plan-tree__children">
          {node.children.map((child) => renderPlanNode(child, activeNodeId, t))}
        </ul>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 5: Render plan tree and focus panel**

In the component body, derive:

```ts
  const planPath = findPlanNodePath(targetMemory?.planTree, targetMemory?.activeLeafPath);
  const activePlanNode = planPath[planPath.length - 1];
```

Before the legacy progress list section, add:

```tsx
      {targetMemory?.planTree ? (
        <section className="supervisor-details-section">
          <h3 className="supervisor-details-section-title">
            {t("supervisor.target_memory.plan_tree_title")}
          </h3>
          <div className="supervisor-details-surface supervisor-plan-layout">
            <div className="supervisor-plan-tree" aria-label={t("supervisor.target_memory.plan_tree_title")}>
              <ul className="supervisor-plan-tree__root">
                {renderPlanNode(targetMemory.planTree, targetMemory.activeNodeId, t)}
              </ul>
            </div>
            <aside className="supervisor-plan-focus">
              <p className="supervisor-meta-label">
                {t("supervisor.target_memory.current_leaf_path_title")}
              </p>
              <p className="supervisor-meta-value supervisor-meta-value--wrap">
                {planPath.map((node) => node.title).join(" > ")}
              </p>
              {activePlanNode?.readyCheck ? (
                <>
                  <p className="supervisor-meta-label">
                    {t("supervisor.target_memory.ready_check_title")}
                  </p>
                  <p className="supervisor-meta-value supervisor-meta-value--strong">
                    {t(`supervisor.target_memory.granularity.${activePlanNode.readyCheck.granularity}`)}
                  </p>
                  <p className="supervisor-meta-value supervisor-meta-value--wrap">
                    {activePlanNode.readyCheck.reason}
                  </p>
                </>
              ) : null}
              {activePlanNode?.execution?.guidance ? (
                <>
                  <p className="supervisor-meta-label">
                    {t("supervisor.target_memory.next_executable_task_title")}
                  </p>
                  <p className="supervisor-meta-value supervisor-meta-value--wrap">
                    {activePlanNode.execution.guidance}
                  </p>
                </>
              ) : null}
            </aside>
          </div>
        </section>
      ) : null}
```

Keep the existing flat `items` progress list visible for now. If visual duplication is too much, hide it only when `planTree` exists in a follow-up patch.

- [ ] **Step 6: Add locale strings**

In `packages/web/src/locales/en.json` under `supervisor.target_memory`, add:

```json
"plan_tree_title": "Plan Tree",
"current_leaf_path_title": "Current leaf path",
"ready_check_title": "Ready check",
"next_executable_task_title": "Next executable task",
"granularity": {
  "too_large": "Too large",
  "ready": "Ready",
  "too_small": "Too small"
}
```

In `packages/web/src/locales/zh.json`, add:

```json
"plan_tree_title": "计划树",
"current_leaf_path_title": "当前叶子路径",
"ready_check_title": "就绪检查",
"next_executable_task_title": "下一步可执行任务",
"granularity": {
  "too_large": "过大",
  "ready": "可执行",
  "too_small": "过碎"
}
```

- [ ] **Step 7: Add CSS**

Append near existing supervisor details styles in `packages/web/src/styles/components.css`:

```css
.supervisor-plan-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(220px, 0.7fr);
  gap: 16px;
}

.supervisor-plan-tree__root,
.supervisor-plan-tree__children {
  list-style: none;
  margin: 0;
  padding-left: 0;
}

.supervisor-plan-tree__children {
  margin-top: 8px;
  padding-left: 18px;
  border-left: 1px solid var(--border-subtle);
}

.supervisor-plan-node {
  display: grid;
  gap: 6px;
  padding: 8px 0;
}

.supervisor-plan-node__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.supervisor-plan-node__title {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.supervisor-plan-node__meta {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.supervisor-plan-node--active > .supervisor-plan-node__row .supervisor-plan-node__title {
  color: var(--accent);
}

.supervisor-plan-focus {
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-raised);
}

@media (max-width: 720px) {
  .supervisor-plan-layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run UI tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/features/supervisor/actions/use-supervisor-actions.ts packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css
git commit -m "feat(web): show supervisor recursive plan tree"
```

---

## Task 8: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused backend verification**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/supervisor/evaluator.test.ts src/supervisor/manager.test.ts src/supervisor/target-store.test.ts src/supervisor/plan-tree.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm ci:typecheck
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional recursive planning files are modified. Existing unrelated git panel changes may still appear; do not stage or revert them.

---

## Notes For Execution

- Keep the old flat `items` fields working through the whole implementation.
- Do not remove existing evaluator `decompose` or `evaluate` modes.
- Do not change provider command builders; all new behavior is in the prompt/payload contract passed through the existing `supervisor_eval` scenario.
- Do not add a user-facing `maxDepth` setting in this plan.
