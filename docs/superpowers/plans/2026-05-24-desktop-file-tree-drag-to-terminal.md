# Desktop File Tree Drag To Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow desktop users to drag file-tree rows into the active terminal to insert shell-quoted workspace-relative paths without uploading anything.

**Architecture:** Define one shared drag payload contract in `packages/web/src/lib`, then teach the terminal drop hook to recognize that payload before the existing file-upload path, and finally make desktop `FileTreeNode` rows emit the payload on `dragstart`. Keep the change web-only, leave search/mobile/open-editors untouched, and reuse the existing `quoteShellSingle()` plus `sendTextToTerminal()` path so terminal input stays consistent.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Jotai, DOM Drag and Drop APIs

**Spec reference:** `docs/superpowers/specs/2026-05-24-desktop-file-tree-drag-to-terminal-design.md`

---

## File Structure

**New files:**
- `packages/web/src/lib/workspace-path-drag.ts`
- `packages/web/src/lib/workspace-path-drag.test.ts`

**Modified files:**
- `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`

**No changes in this plan:**
- `packages/server/**`
- `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
- `packages/web/src/features/workspace/views/shared/file-search*`
- `packages/web/src/features/workspace/views/mobile/**`
- terminal WebSocket protocol or PTY host code

### Task 1: Add A Shared Workspace Path Drag Payload Helper

**Files:**
- Create: `packages/web/src/lib/workspace-path-drag.ts`
- Test: `packages/web/src/lib/workspace-path-drag.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/web/src/lib/workspace-path-drag.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_PATH_DRAG_MIME,
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
  setWorkspacePathDragData,
} from "./workspace-path-drag";

describe("workspace-path-drag", () => {
  it("writes the custom mime payload and plain text path", () => {
    const setData = vi.fn();
    const dataTransfer = {
      effectAllowed: "none",
      setData,
    } as unknown as DataTransfer;

    setWorkspacePathDragData(dataTransfer, {
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(setData).toHaveBeenNthCalledWith(
      1,
      WORKSPACE_PATH_DRAG_MIME,
      JSON.stringify({
        workspaceId: "ws-1",
        path: "src/app.tsx",
        kind: "file",
      })
    );
    expect(setData).toHaveBeenNthCalledWith(2, "text/plain", "src/app.tsx");
  });

  it("reads a valid payload only when the custom mime type is present", () => {
    const dataTransfer = {
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      getData: vi.fn((type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME
          ? JSON.stringify({
              workspaceId: "ws-1",
              path: "src/app.tsx",
              kind: "file",
            })
          : "src/app.tsx"
      ),
    } as unknown as DataTransfer;

    expect(hasWorkspacePathDragType(dataTransfer)).toBe(true);
    expect(getWorkspacePathDragPayload(dataTransfer)).toEqual({
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });
  });

  it("returns null for invalid payloads", () => {
    expect(
      getWorkspacePathDragPayload({
        types: [WORKSPACE_PATH_DRAG_MIME],
        getData: () => "{bad json",
      } as unknown as DataTransfer)
    ).toBeNull();

    expect(
      getWorkspacePathDragPayload({
        types: [WORKSPACE_PATH_DRAG_MIME],
        getData: () => JSON.stringify({ workspaceId: "ws-1", path: "", kind: "file" }),
      } as unknown as DataTransfer)
    ).toBeNull();

    expect(
      getWorkspacePathDragPayload({
        types: ["text/plain"],
        getData: () => "src/app.tsx",
      } as unknown as DataTransfer)
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the helper tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/lib/workspace-path-drag.test.ts
```

Expected: FAIL because `src/lib/workspace-path-drag.ts` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

Create `packages/web/src/lib/workspace-path-drag.ts`:

```ts
export const WORKSPACE_PATH_DRAG_MIME = "application/x-coder-studio-workspace-path";

export interface WorkspacePathDragPayload {
  workspaceId: string;
  path: string;
  kind: "file" | "dir";
}

function isWorkspacePathDragPayload(value: unknown): value is WorkspacePathDragPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.workspaceId === "string" &&
    payload.workspaceId.length > 0 &&
    typeof payload.path === "string" &&
    payload.path.length > 0 &&
    (payload.kind === "file" || payload.kind === "dir")
  );
}

export function hasWorkspacePathDragType(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(WORKSPACE_PATH_DRAG_MIME);
}

export function setWorkspacePathDragData(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  payload: WorkspacePathDragPayload
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(WORKSPACE_PATH_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.path);
}

export function getWorkspacePathDragPayload(
  dataTransfer: Pick<DataTransfer, "types" | "getData"> | null | undefined
): WorkspacePathDragPayload | null {
  if (!hasWorkspacePathDragType(dataTransfer)) {
    return null;
  }

  try {
    const raw = dataTransfer?.getData(WORKSPACE_PATH_DRAG_MIME) ?? "";
    const parsed: unknown = JSON.parse(raw);
    return isWorkspacePathDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/lib/workspace-path-drag.test.ts
```

Expected: PASS with 3 tests in `workspace-path-drag.test.ts`.

- [ ] **Step 5: Commit the helper**

Run:

```bash
git add packages/web/src/lib/workspace-path-drag.ts packages/web/src/lib/workspace-path-drag.test.ts
git commit -m "feat: add workspace path drag payload helper"
```

Expected: a commit containing only the new helper and its tests.

### Task 2: Teach Terminal Drop Handling About Internal Workspace Paths

**Files:**
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`

- [ ] **Step 1: Write the failing drop-hook tests**

Add the custom drag helpers near the existing `fireDrop()` utility in `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`:

```ts
import { WORKSPACE_PATH_DRAG_MIME } from "../../../lib/workspace-path-drag";

function fireWorkspacePathDragOver(
  target: HTMLElement,
  payload: { workspaceId: string; path: string; kind: "file" | "dir" }
) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: (type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME ? JSON.stringify(payload) : payload.path,
    },
  });
  target.dispatchEvent(event);
  return event;
}

function fireWorkspacePathDrop(
  target: HTMLElement,
  payload: { workspaceId: string; path: string; kind: "file" | "dir" }
) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [],
      types: [WORKSPACE_PATH_DRAG_MIME, "text/plain"],
      items: [],
      getData: (type: string) =>
        type === WORKSPACE_PATH_DRAG_MIME ? JSON.stringify(payload) : payload.path,
    },
  });
  target.dispatchEvent(event);
  return event;
}
```

Add these tests in the same file:

```ts
it("prevents default for internal workspace drags and inserts a quoted relative path", async () => {
  const store = createStore();
  const { result } = renderHook(
    () =>
      usePasteDropUpload({
        containerRef: { current: container },
        workspaceId: "ws-1",
        sendTextToTerminal: sendInput,
        enabled: true,
      }),
    { wrapper: makeWrapper(store) }
  );

  const dragOver = fireWorkspacePathDragOver(container, {
    workspaceId: "ws-1",
    path: "src/app.tsx",
    kind: "file",
  });
  expect(dragOver.defaultPrevented).toBe(true);

  await act(async () => {
    const drop = fireWorkspacePathDrop(container, {
      workspaceId: "ws-1",
      path: "src/app.tsx",
      kind: "file",
    });
    expect(drop.defaultPrevented).toBe(true);
    await flushAsyncWork();
  });

  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(sendInput).toHaveBeenCalledWith("'src/app.tsx' ");
  expect(result.current.busy).toBe(false);
});

it("rejects internal workspace drops from another workspace", async () => {
  const store = createStore();
  const { result } = renderHook(
    () =>
      usePasteDropUpload({
        containerRef: { current: container },
        workspaceId: "ws-1",
        sendTextToTerminal: sendInput,
        enabled: true,
      }),
    { wrapper: makeWrapper(store) }
  );

  await act(async () => {
    fireWorkspacePathDrop(container, {
      workspaceId: "ws-2",
      path: "src/app.tsx",
      kind: "file",
    });
    await flushAsyncWork();
  });

  expect(sendInput).not.toHaveBeenCalled();
  expect(store.get(toastsAtom)).toContainEqual(
    expect.objectContaining({
      kind: "error",
      title: "Drop failed",
    })
  );
  expect(result.current.busy).toBe(false);
});
```

- [ ] **Step 2: Run the terminal drop-hook tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx
```

Expected: FAIL on the new workspace-path drag tests because the hook still ignores the custom MIME payload, so `defaultPrevented` stays `false` and `sendTextToTerminal()` is never called.

- [ ] **Step 3: Implement internal workspace-path drop parsing without touching upload flow**

Update the imports and helpers in `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`:

```ts
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../lib/workspace-path-drag";
```

Add this callback next to the existing `handleText()` callback:

```ts
  const handleWorkspacePathDrop = useCallback(
    async (dataTransfer: DataTransfer | null | undefined) => {
      const payload = getWorkspacePathDragPayload(dataTransfer);
      if (!payload) {
        pushToast({
          kind: "error",
          title: "Drop failed",
          body: "Could not read the dragged workspace path.",
          duration: 3_000,
        });
        return;
      }

      if (payload.workspaceId !== workspaceId) {
        pushToast({
          kind: "error",
          title: "Drop failed",
          body: "You can only drop paths from the current workspace.",
          duration: 3_000,
        });
        return;
      }

      try {
        await sendTextToTerminal(`${quoteShellSingle(payload.path)} `);
      } catch (error) {
        console.debug("Workspace path drop failed:", error);
        pushToast({
          kind: "error",
          title: "Drop failed",
          body: "Could not insert the dragged path into the terminal.",
          duration: 3_000,
        });
      }
    },
    [pushToast, sendTextToTerminal, workspaceId]
  );
```

Replace the `drop` and `dragover` handlers inside the effect with:

```ts
    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        void handleFiles(Array.from(files));
        return;
      }

      if (!hasWorkspacePathDragType(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void handleWorkspacePathDrop(event.dataTransfer);
    };

    const onDragOver = (event: DragEvent) => {
      if (hasWorkspacePathDragType(event.dataTransfer)) {
        event.preventDefault();
        return;
      }

      const types = Array.from(event.dataTransfer?.types ?? []);
      if (types.includes("Files")) {
        event.preventDefault();
      }
    };
```

Update the effect dependency list to include the new callback:

```ts
  }, [containerRef, enabled, handleFiles, handleWorkspacePathDrop]);
```

- [ ] **Step 4: Run the terminal drop-hook tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx
```

Expected: PASS, including the new internal workspace-path drag tests and all existing upload regression tests.

- [ ] **Step 5: Commit the terminal drop support**

Run:

```bash
git add packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx
git commit -m "feat: support workspace path drops in terminal"
```

Expected: a commit containing only the terminal drop-hook changes and tests.

### Task 3: Make Desktop File Tree Rows Emit Workspace Path Drag Data

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`

- [ ] **Step 1: Write the failing desktop tree drag tests**

Add this helper near the top of `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`:

```ts
import { WORKSPACE_PATH_DRAG_MIME } from "../../../../lib/workspace-path-drag";

function createDragDataTransfer() {
  const values = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
  } as unknown as DataTransfer;

  return { dataTransfer, values };
}
```

Add these tests:

```ts
it("marks desktop tree rows draggable and writes workspace path drag data on dragstart", () => {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [
        ".",
        [
          { path: "README.md", name: "README.md", kind: "file" },
          { path: "src", name: "src", kind: "dir", children: [] },
        ],
      ],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" variant="desktop" showSearch={false} />
    </Provider>
  );

  const fileRow = screen.getByText("README.md").closest(".tree-item");
  const folderRow = screen.getByText("src").closest(".tree-item");
  expect(fileRow).toHaveAttribute("draggable", "true");
  expect(folderRow).toHaveAttribute("draggable", "true");

  const { dataTransfer, values } = createDragDataTransfer();
  fireEvent.dragStart(fileRow!, { dataTransfer });

  expect(values.get(WORKSPACE_PATH_DRAG_MIME)).toBe(
    JSON.stringify({
      workspaceId: "ws-test",
      path: "README.md",
      kind: "file",
    })
  );
  expect(values.get("text/plain")).toBe("README.md");
});

it("keeps mobile tree rows non-draggable", () => {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(
    fileTreeAtomFamily("ws-test"),
    new Map([
      [".", [{ path: "README.md", name: "README.md", kind: "file" }]],
    ])
  );

  render(
    <Provider store={store}>
      <FileTreePanel workspaceId="ws-test" variant="mobile" showSearch={false} />
    </Provider>
  );

  expect(screen.getByText("README.md").closest(".tree-item")).not.toHaveAttribute(
    "draggable",
    "true"
  );
});
```

- [ ] **Step 2: Run the file-tree tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: FAIL on the new drag assertions because `FileTreeNode` rows are not draggable and never write any `dataTransfer` payload.

- [ ] **Step 3: Implement desktop dragstart on `FileTreeNode` only**

Add the new imports in `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`:

```ts
import type {
  DragEvent as ReactDragEvent,
  FC,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { setWorkspacePathDragData } from "../../../../lib/workspace-path-drag";
```

Thread `workspaceId` through the tree-node props:

```ts
interface FileTreeNodeProps {
  workspaceId: string;
  node: FileNode;
  depth: number;
  variant: "desktop" | "mobile";
  // ...existing props...
}
```

Pass the prop at both render sites:

```tsx
<FileTreeNode
  key={node.path}
  workspaceId={workspaceId}
  node={node}
  depth={0}
  variant={variant}
  expandedDirs={expandedDirs}
  selectedPath={activeFilePath}
  contextTargetPath={contextTargetPath}
  onRequestCreate={openCreateDialog}
  onSelectFile={handleSelectFile}
  onLoadChildren={loadChildren}
  onToggleDirs={applyExpandedDirs}
  defaultExpandedRootPaths={defaultExpandedRootPaths}
  isLoadingDir={isLoadingDir}
  onOpenContextMenu={openRowContextMenu}
  onBeginLongPress={beginRowLongPress}
  onUpdateLongPress={updateLongPress}
  onCancelLongPress={cancelLongPress}
  consumeSuppressedClick={consumeSuppressedClick}
/>
```

```tsx
<FileTreeNode
  key={child.path}
  workspaceId={workspaceId}
  node={child}
  depth={depth + 1}
  variant={variant}
  expandedDirs={expandedDirs}
  selectedPath={selectedPath}
  contextTargetPath={contextTargetPath}
  onRequestCreate={onRequestCreate}
  onSelectFile={onSelectFile}
  onLoadChildren={onLoadChildren}
  onToggleDirs={onToggleDirs}
  defaultExpandedRootPaths={defaultExpandedRootPaths}
  isLoadingDir={isLoadingDir}
  onOpenContextMenu={onOpenContextMenu}
  onBeginLongPress={onBeginLongPress}
  onUpdateLongPress={onUpdateLongPress}
  onCancelLongPress={onCancelLongPress}
  consumeSuppressedClick={consumeSuppressedClick}
/>
```

Inside `FileTreeNode`, add the drag handler and wire it to the row:

```ts
  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    if (variant !== "desktop" || !event.dataTransfer) {
      return;
    }

    setWorkspacePathDragData(event.dataTransfer, {
      workspaceId,
      path: node.path,
      kind: node.kind,
    });
  };
```

```tsx
      <div
        className={`tree-item tree-item--${node.kind} ${
          selectedPath === node.path ? "selected" : ""
        } ${contextTargetPath === node.path ? "tree-item--context-target" : ""}`}
        draggable={variant === "desktop" ? true : undefined}
        onDragStart={variant === "desktop" ? handleDragStart : undefined}
        onClick={handleClick}
        onContextMenu={
          variant === "desktop" ? (event) => onOpenContextMenu(event, node, "tree") : undefined
        }
        onPointerDown={
          variant === "mobile" ? (event) => onBeginLongPress(event, node, "mobile") : undefined
        }
        onPointerMove={variant === "mobile" ? onUpdateLongPress : undefined}
        onPointerCancel={
          variant === "mobile" ? (event) => onCancelLongPress(event.pointerId) : undefined
        }
        onPointerUp={
          variant === "mobile" ? (event) => onCancelLongPress(event.pointerId) : undefined
        }
        style={{ paddingLeft }}
      >
```

- [ ] **Step 4: Run the file-tree tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: PASS, including the new desktop/mobile drag coverage and all existing file-tree behavior tests.

- [ ] **Step 5: Commit the file-tree drag source**

Run:

```bash
git add packages/web/src/features/workspace/views/shared/file-tree-panel.tsx packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx
git commit -m "feat: add desktop file tree drag-to-terminal source"
```

Expected: a commit containing only the file-tree drag source changes and tests.

### Task 4: Run Targeted Regression Coverage For The Whole Flow

**Files:**
- No code changes required unless a test reveals a regression.

- [ ] **Step 1: Run the shared helper, terminal, and file-tree tests together**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/lib/workspace-path-drag.test.ts src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: PASS across all three suites with no newly failing upload or file-tree regressions.

- [ ] **Step 2: Inspect the final diff to verify scope stayed inside the approved files**

Run:

```bash
git diff --stat HEAD~3..HEAD
git status --short
```

Expected: only the six approved web files changed, plus no accidental edits outside the feature scope.

- [ ] **Step 3: If Task 4 required no code fixes, create a lightweight verification checkpoint commit**

Run:

```bash
git commit --allow-empty -m "test: verify desktop file tree drag-to-terminal flow"
```

Expected: an empty verification commit only if you want a visible checkpoint after the targeted regression run; skip this step if the team dislikes empty commits.
