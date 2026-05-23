# Open Editors Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring desktop and mobile `Open Editors` to parity with expand/collapse, file count, per-row close, and `Close all`, while making editor closing follow one deterministic active-file selection rule.

**Architecture:** Keep the close decision pure in a workspace helper, then reuse a lightweight `useOpenEditorsActions` hook from both the desktop editor header close action and the shared `OpenEditorsSection`. Build the new `Open Editors` chrome in the shared section, add a dedicated localized `Close all` label, and verify desktop/mobile behavior with focused UI and integration tests.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library, Lucide React, existing workspace atoms, `useOpenLocation`, Monaco model disposal via `monacoModelRegistry`, and shared CSS assertions in `packages/web/src/styles/components.theme.test.ts`.

**Spec reference:** `docs/superpowers/specs/2026-05-24-open-editors-actions-design.md`

**Current scope note:** The existing reusable editor-header close action only exists on desktop `CodeEditorHost`. Mobile file detail uses the sheet header/back flow instead of an editor close button, so this plan updates mobile `Open Editors` list actions but does not introduce a new mobile detail close control.

---

## File Structure

**Create:**
- `packages/web/src/features/workspace/actions/open-editors-close.ts` — pure helper that resolves removal targets, next active path, and editor-exit intent
- `packages/web/src/features/workspace/actions/open-editors-close.test.ts` — unit coverage for ordered close behavior and `closeAll`
- `packages/web/src/features/workspace/actions/use-open-editors-actions.ts` — shared hook that mutates workspace editor atoms and disposes Monaco models
- `packages/web/src/features/workspace/views/shared/open-editors-section.test.tsx` — shared section tests for collapse, count, close-row, and close-all behavior

**Modify:**
- `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts` — replace inline close logic with shared `useOpenEditorsActions`
- `packages/web/src/features/code-editor/index.test.tsx` — verify editor-header close switches to next editor and exits on final file
- `packages/web/src/features/workspace/views/shared/open-editors-section.tsx` — add header chrome, collapse state, close buttons, and shared actions wiring
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx` — verify mobile explorer renders the shared controls and active-row close behavior
- `packages/web/src/features/workspace/index.test.tsx` — verify desktop main area falls back to session/agent when `Close all` removes the last open editor
- `packages/web/src/styles/components.css` — add shared `Open Editors` layout, right-side actions, and single-line truncation rules
- `packages/web/src/styles/components.theme.test.ts` — assert the new selectors keep compact single-line rows
- `packages/web/src/locales/en.json` — add `action.close_all`
- `packages/web/src/locales/zh.json` — add `action.close_all`

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/actions/open-editors-close.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/code-editor/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/open-editors-section.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx src/features/workspace/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/actions/open-editors-close.test.ts src/features/code-editor/index.test.tsx src/features/workspace/views/shared/open-editors-section.test.tsx src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx src/features/workspace/index.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Add Pure Open-Editor Close Decisions

**Files:**
- Create: `packages/web/src/features/workspace/actions/open-editors-close.test.ts`
- Create: `packages/web/src/features/workspace/actions/open-editors-close.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/web/src/features/workspace/actions/open-editors-close.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { OpenFile } from "../atoms";
import { resolveOpenEditorsClose } from "./open-editors-close";

function createFile(path: string): OpenFile {
  return {
    kind: "text",
    path,
    content: path,
    savedContent: path,
    baseHash: `${path}-hash`,
    isDirty: false,
  };
}

describe("resolveOpenEditorsClose", () => {
  it("keeps the active file when closing a non-active editor", () => {
    const openFiles = {
      "README.md": createFile("README.md"),
      "src/app.tsx": createFile("src/app.tsx"),
      "src/view.tsx": createFile("src/view.tsx"),
    };

    expect(
      resolveOpenEditorsClose({
        openFiles,
        activeFilePath: "src/app.tsx",
        targetPath: "README.md",
      })
    ).toEqual({
      orderedPaths: ["README.md", "src/app.tsx", "src/view.tsx"],
      removedPaths: ["README.md"],
      nextActiveFilePath: "src/app.tsx",
      shouldExitEditor: false,
    });
  });

  it("selects the next editor when closing the active file with a later entry", () => {
    const openFiles = {
      "README.md": createFile("README.md"),
      "src/app.tsx": createFile("src/app.tsx"),
      "src/view.tsx": createFile("src/view.tsx"),
    };

    expect(
      resolveOpenEditorsClose({
        openFiles,
        activeFilePath: "src/app.tsx",
        targetPath: "src/app.tsx",
      })
    ).toEqual({
      orderedPaths: ["README.md", "src/app.tsx", "src/view.tsx"],
      removedPaths: ["src/app.tsx"],
      nextActiveFilePath: "src/view.tsx",
      shouldExitEditor: false,
    });
  });

  it("selects the previous editor when closing the active last entry", () => {
    const openFiles = {
      "README.md": createFile("README.md"),
      "src/app.tsx": createFile("src/app.tsx"),
    };

    expect(
      resolveOpenEditorsClose({
        openFiles,
        activeFilePath: "src/app.tsx",
        targetPath: "src/app.tsx",
      })
    ).toEqual({
      orderedPaths: ["README.md", "src/app.tsx"],
      removedPaths: ["src/app.tsx"],
      nextActiveFilePath: "README.md",
      shouldExitEditor: false,
    });
  });

  it("signals editor exit when the last remaining file closes", () => {
    const openFiles = {
      "src/app.tsx": createFile("src/app.tsx"),
    };

    expect(
      resolveOpenEditorsClose({
        openFiles,
        activeFilePath: "src/app.tsx",
        targetPath: "src/app.tsx",
      })
    ).toEqual({
      orderedPaths: ["src/app.tsx"],
      removedPaths: ["src/app.tsx"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("clears every open file for closeAll", () => {
    const openFiles = {
      "README.md": createFile("README.md"),
      "src/app.tsx": createFile("src/app.tsx"),
    };

    expect(
      resolveOpenEditorsClose({
        openFiles,
        activeFilePath: "src/app.tsx",
        closeAll: true,
      })
    ).toEqual({
      orderedPaths: ["README.md", "src/app.tsx"],
      removedPaths: ["README.md", "src/app.tsx"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });
});
```

- [ ] **Step 2: Run the helper test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/actions/open-editors-close.test.ts
```

Expected:
- FAIL with `Cannot find module './open-editors-close'`

- [ ] **Step 3: Implement the pure close helper**

Create `packages/web/src/features/workspace/actions/open-editors-close.ts`:

```ts
import type { OpenFile } from "../atoms";

interface ResolveOpenEditorsCloseInput {
  openFiles: Record<string, OpenFile>;
  activeFilePath: string | null;
  targetPath?: string;
  closeAll?: boolean;
}

interface ResolveOpenEditorsCloseResult {
  orderedPaths: string[];
  removedPaths: string[];
  nextActiveFilePath: string | null;
  shouldExitEditor: boolean;
}

export function orderOpenEditorPaths(openFiles: Record<string, OpenFile>): string[] {
  return Object.keys(openFiles).sort((left, right) => left.localeCompare(right));
}

export function resolveOpenEditorsClose(
  input: ResolveOpenEditorsCloseInput
): ResolveOpenEditorsCloseResult {
  const orderedPaths = orderOpenEditorPaths(input.openFiles);

  if (input.closeAll) {
    return {
      orderedPaths,
      removedPaths: orderedPaths,
      nextActiveFilePath: null,
      shouldExitEditor: true,
    };
  }

  const targetPath = input.targetPath;
  if (!targetPath || !input.openFiles[targetPath]) {
    return {
      orderedPaths,
      removedPaths: [],
      nextActiveFilePath: input.activeFilePath,
      shouldExitEditor: false,
    };
  }

  const targetIndex = orderedPaths.indexOf(targetPath);
  const remainingPaths = orderedPaths.filter((path) => path !== targetPath);
  const isActiveTarget = input.activeFilePath === targetPath;

  if (!isActiveTarget) {
    return {
      orderedPaths,
      removedPaths: [targetPath],
      nextActiveFilePath: input.activeFilePath,
      shouldExitEditor: remainingPaths.length === 0,
    };
  }

  const nextActiveFilePath =
    remainingPaths[targetIndex] ?? remainingPaths[targetIndex - 1] ?? null;

  return {
    orderedPaths,
    removedPaths: [targetPath],
    nextActiveFilePath,
    shouldExitEditor: nextActiveFilePath === null,
  };
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/actions/open-editors-close.test.ts
```

Expected:
- PASS for all `resolveOpenEditorsClose` cases

- [ ] **Step 5: Commit the helper layer**

```bash
git add \
  packages/web/src/features/workspace/actions/open-editors-close.ts \
  packages/web/src/features/workspace/actions/open-editors-close.test.ts
git commit -m "feat: add open editor close helper"
```

---

### Task 2: Share Close Actions With The Desktop Editor Header

**Files:**
- Create: `packages/web/src/features/workspace/actions/use-open-editors-actions.ts`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`

- [ ] **Step 1: Write the failing editor close tests**

Append these cases in `packages/web/src/features/code-editor/index.test.tsx` near the current close-button coverage:

```tsx
  it("switches to the next sorted open file when the header closes the active editor", () => {
    const { store } = setupStore({
      activePath: "src/app.tsx",
      openFiles: {
        "README.md": {
          kind: "text",
          path: "README.md",
          content: "docs",
          savedContent: "docs",
          baseHash: "readme-hash",
          isDirty: false,
        },
        "src/app.tsx": {
          kind: "text",
          path: "src/app.tsx",
          content: "app",
          savedContent: "app",
          baseHash: "app-hash",
          isDirty: false,
        },
        "src/view.tsx": {
          kind: "text",
          path: "src/view.tsx",
          content: "view",
          savedContent: "view",
          baseHash: "view-hash",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/view.tsx");
    expect(store.get(openFilesAtomFamily("ws-1"))["src/app.tsx"]).toBeUndefined();
    expect(mockRegistryDisposeFile).toHaveBeenCalledWith("/tmp/ws", "src/app.tsx");
  });

  it("returns to the empty editor state when the header closes the final remaining file", () => {
    const { store } = setupStore({
      activePath: "src/only.ts",
      openFiles: {
        "src/only.ts": {
          kind: "text",
          path: "src/only.ts",
          content: "only",
          savedContent: "only",
          baseHash: "only-hash",
          isDirty: false,
        },
      },
    });

    render(
      <Provider store={store}>
        <CodeEditorHost />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-1"))).toEqual({});
    expect(store.get(editorModeAtomFamily("ws-1"))).toBe("edit");
  });
```

- [ ] **Step 2: Run the editor test file to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/index.test.tsx
```

Expected:
- FAIL because `handleClose` still clears `activeFilePath` directly instead of selecting the next editor

- [ ] **Step 3: Implement shared open-editor actions and reuse them**

Create `packages/web/src/features/workspace/actions/use-open-editors-actions.ts`:

```ts
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import { monacoModelRegistry } from "../../code-editor/monaco/model-registry";
import {
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  gitDiffPreviewAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../atoms";
import { resolveOpenEditorsClose } from "./open-editors-close";

interface UseOpenEditorsActionsOptions {
  onExitEditor?: () => void;
}

export function useOpenEditorsActions(
  workspaceId: string,
  options?: UseOpenEditorsActionsOptions
) {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceRootPath = workspace?.id === workspaceId ? workspace.path : null;
  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtomFamily(workspaceId));
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId));
  const [diffPreview, setDiffPreview] = useAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));

  const disposePaths = useCallback(
    (paths: string[], snapshot: Record<string, OpenFile>) => {
      if (!workspaceRootPath) {
        return;
      }

      for (const path of paths) {
        const file = snapshot[path];
        if (file?.kind === "text") {
          monacoModelRegistry.disposeFile(workspaceRootPath, path);
        }
      }
    },
    [workspaceRootPath]
  );

  const applyRemoval = useCallback(
    (
      removedPaths: string[],
      nextActiveFilePath: string | null,
      shouldExitEditor: boolean,
      resetMode: boolean
    ) => {
      if (removedPaths.length === 0) {
        return;
      }

      disposePaths(removedPaths, openFiles);
      setOpenFiles((previous) => {
        const next = { ...previous };
        for (const path of removedPaths) {
          delete next[path];
        }
        return next;
      });
      setActiveFilePath(nextActiveFilePath);

      const shouldClearPreview =
        shouldExitEditor ||
        (diffPreview?.source === "file" && removedPaths.includes(diffPreview.path));

      if (shouldClearPreview) {
        setDiffPreview(null);
      }

      if (resetMode || shouldExitEditor) {
        setEditorMode("edit");
      }

      if (shouldExitEditor) {
        options?.onExitEditor?.();
      }
    },
    [
      diffPreview,
      disposePaths,
      openFiles,
      options,
      setActiveFilePath,
      setDiffPreview,
      setEditorMode,
      setOpenFiles,
    ]
  );

  const closePath = useCallback(
    (targetPath: string) => {
      const decision = resolveOpenEditorsClose({
        openFiles,
        activeFilePath,
        targetPath,
      });

      applyRemoval(
        decision.removedPaths,
        decision.nextActiveFilePath,
        decision.shouldExitEditor,
        activeFilePath === targetPath
      );

      return decision;
    },
    [activeFilePath, applyRemoval, openFiles]
  );

  const closeAll = useCallback(() => {
    const decision = resolveOpenEditorsClose({
      openFiles,
      activeFilePath,
      closeAll: true,
    });

    applyRemoval(decision.removedPaths, null, true, true);
    return decision;
  }, [activeFilePath, applyRemoval, openFiles]);

  return {
    closeAll,
    closePath,
  };
}
```

Then update `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`:

```ts
import { useOpenEditorsActions } from "../../workspace/actions/use-open-editors-actions";
```

```ts
  const { closePath } = useOpenEditorsActions(workspaceId ?? "");
```

Replace the current `handleClose` callback with:

```ts
  const handleClose = useCallback(() => {
    if (!currentFile?.path) {
      return;
    }

    closePath(currentFile.path);
    setSaveError(null);
  }, [closePath, currentFile?.path, setSaveError]);
```

- [ ] **Step 4: Run the editor test file to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/index.test.tsx
```

Expected:
- PASS for the two new close-flow cases
- PASS for existing editor tests, including diff-preview payload handling

- [ ] **Step 5: Commit the shared editor close integration**

```bash
git add \
  packages/web/src/features/workspace/actions/use-open-editors-actions.ts \
  packages/web/src/features/code-editor/actions/use-code-editor-actions.ts \
  packages/web/src/features/code-editor/index.test.tsx
git commit -m "feat: share open editor close actions"
```

---

### Task 3: Build The Shared Open Editors Section UI

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/open-editors-section.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing shared section tests**

Create `packages/web/src/features/workspace/views/shared/open-editors-section.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { seedReadyWorkspaceState } from "../../../../test-utils/workspace-state";
import {
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  gitDiffPreviewAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { OpenEditorsSection } from "./open-editors-section";

const disposeFileMock = vi.fn();

vi.mock("../../../code-editor/monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: vi.fn(),
    updateFromDisk: vi.fn(),
    disposeFile: disposeFileMock,
    disposeWorkspace: vi.fn(),
  },
}));

function createStoreState() {
  const store = createStore();
  store.set(localeAtom, "en");
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/tmp/ws-test",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  store.set(activeWorkspaceIdAtom, "ws-test");
  store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
  store.set(editorModeAtomFamily("ws-test"), "diff");
  store.set(openFilesAtomFamily("ws-test"), {
    "README.md": {
      kind: "text",
      path: "README.md",
      content: "docs",
      savedContent: "docs",
      baseHash: "readme-hash",
      isDirty: false,
    },
    "src/app.tsx": {
      kind: "text",
      path: "src/app.tsx",
      content: "app",
      savedContent: "app",
      baseHash: "app-hash",
      isDirty: false,
    },
  });
  store.set(gitDiffPreviewAtomFamily("ws-test"), {
    path: "src/app.tsx",
    diff: "diff --git a/src/app.tsx b/src/app.tsx",
    staged: false,
    source: "file",
  });
  return store;
}

describe("OpenEditorsSection", () => {
  afterEach(() => {
    disposeFileMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders the file count and lets users collapse and re-expand rows", () => {
    const store = createStoreState();

    render(
      <Provider store={store}>
        <OpenEditorsSection workspaceId="ws-test" />
      </Provider>
    );

    const heading = screen.getByRole("heading", { name: /Open Editors/i });
    const section = heading.closest("section");

    expect(heading).toHaveTextContent("Open Editors");
    expect(heading).toHaveTextContent("(2)");

    const collapseButton = within(section as HTMLElement).getByRole("button", {
      name: "Collapse",
    });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseButton);

    expect(screen.queryByRole("button", { name: "README.md" })).toBeNull();
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");

    fireEvent.click(
      within(section as HTMLElement).getByRole("button", { name: "Expand" })
    );

    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
  });

  it("closes a non-active row without changing the active file or diff mode", () => {
    const store = createStoreState();

    render(
      <Provider store={store}>
        <OpenEditorsSection workspaceId="ws-test" />
      </Provider>
    );

    const readmeRow = screen
      .getByRole("button", { name: "README.md" })
      .closest(".workspace-open-editors__row");

    fireEvent.click(
      within(readmeRow as HTMLElement).getByRole("button", { name: "Close README.md" })
    );

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(editorModeAtomFamily("ws-test"))).toBe("diff");
    expect(store.get(openFilesAtomFamily("ws-test"))["README.md"]).toBeUndefined();
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toEqual({
      path: "src/app.tsx",
      diff: "diff --git a/src/app.tsx b/src/app.tsx",
      staged: false,
      source: "file",
    });
    expect(disposeFileMock).toHaveBeenCalledWith("/tmp/ws-test", "README.md");
  });

  it("closes all rows from the header action", () => {
    const store = createStoreState();

    render(
      <Provider store={store}>
        <OpenEditorsSection workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({});
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toBeNull();
    expect(store.get(editorModeAtomFamily("ws-test"))).toBe("edit");
  });
});
```

- [ ] **Step 2: Run the shared section test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/open-editors-section.test.tsx
```

Expected:
- FAIL because the section still renders only a heading plus plain path buttons

- [ ] **Step 3: Implement the shared header, localized close-all action, and styles**

Update `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`:

```tsx
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { IconButton, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { orderOpenEditorPaths } from "../../actions/open-editors-close";
import { useOpenEditorsActions } from "../../actions/use-open-editors-actions";
import {
  activeFilePathAtomFamily,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";

interface OpenEditorsSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
  title?: string;
}

export function OpenEditorsSection({ workspaceId, onSelectFile, title }: OpenEditorsSectionProps) {
  const t = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { closeAll, closePath } = useOpenEditorsActions(workspaceId);
  const { openLocation } = useOpenLocation(workspaceId);
  const openEditorPaths = orderOpenEditorPaths(openFiles);

  return (
    <section className="workspace-sidebar-section">
      <div className="workspace-open-editors__header">
        <div className="workspace-open-editors__header-main">
          <Tooltip content={collapsed ? t("action.expand") : t("action.collapse")}>
            <IconButton
              aria-expanded={!collapsed}
              aria-label={collapsed ? t("action.expand") : t("action.collapse")}
              className="workspace-open-editors__toggle"
              icon={collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              onClick={() => setCollapsed((value) => !value)}
              size="sm"
            />
          </Tooltip>
          <h2 className="workspace-sidebar-section__title workspace-open-editors__title">
            {title ?? t("workspace.sidebar.open_editors")}
            <span className="workspace-open-editors__count">({openEditorPaths.length})</span>
          </h2>
        </div>

        <button
          type="button"
          className="workspace-open-editors__close-all"
          disabled={openEditorPaths.length === 0}
          onClick={() => closeAll()}
        >
          {t("action.close_all")}
        </button>
      </div>

      {!collapsed && openEditorPaths.length > 0 ? (
        <div className="workspace-open-editors">
          {openEditorPaths.map((path) => (
            <div key={path} className="workspace-open-editors__row">
              <button
                type="button"
                className={`workspace-open-editors__item ${
                  activeFilePath === path ? "workspace-open-editors__item--active" : ""
                }`}
                title={path}
                onClick={() => {
                  setEditorMode(deriveEditorModeForPath(path));
                  void openLocation({
                    workspaceId,
                    path,
                    source: "manual",
                  });
                  onSelectFile?.(path);
                }}
              >
                <span className="workspace-open-editors__item-label">{path}</span>
              </button>

              <Tooltip content={t("action.close")}>
                <IconButton
                  aria-label={`${t("action.close")} ${path}`}
                  className="workspace-open-editors__item-close"
                  icon={<X size={12} />}
                  onClick={() => closePath(path)}
                  size="sm"
                />
              </Tooltip>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
```

Add the new locale key in `packages/web/src/locales/en.json`:

```json
    "close": "Close",
    "close_all": "Close all",
    "apply": "Apply",
```

Add the new locale key in `packages/web/src/locales/zh.json`:

```json
    "close": "关闭",
    "close_all": "全部关闭",
    "apply": "应用",
```

Extend `packages/web/src/styles/components.css` near the existing `workspace-open-editors` block:

```css
.workspace-open-editors__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-tight);
  margin-bottom: var(--sp-2);
}

.workspace-open-editors__header-main {
  display: flex;
  align-items: center;
  gap: var(--gap-micro);
  min-width: 0;
}

.workspace-open-editors__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  min-width: 0;
}

.workspace-open-editors__count {
  color: var(--text-quaternary);
}

.workspace-open-editors__close-all {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
}

.workspace-open-editors__close-all:disabled {
  opacity: 0.5;
}

.workspace-open-editors__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--gap-micro);
  align-items: center;
}

.workspace-open-editors__item {
  display: flex;
  align-items: center;
  min-width: 0;
}

.workspace-open-editors__item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-open-editors__item-close {
  flex: 0 0 auto;
}
```

Extend `packages/web/src/styles/components.theme.test.ts` with:

```ts
  it("keeps open editors rows single-line with compact right-side actions", () => {
    const header = getLastRuleBlock(".workspace-open-editors__header");
    const item = getLastRuleBlock(".workspace-open-editors__item");
    const row = getLastRuleBlock(".workspace-open-editors__row");
    const label = getLastRuleBlock(".workspace-open-editors__item-label");
    const closeAll = getLastRuleBlock(".workspace-open-editors__close-all");

    expect(header).toContain("justify-content: space-between");
    expect(row).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(item).toContain("min-width: 0");
    expect(label).toContain("text-overflow: ellipsis");
    expect(label).toContain("white-space: nowrap");
    expect(closeAll).toContain("background: transparent");
  });
```

- [ ] **Step 4: Run the shared section and theme tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/open-editors-section.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS for count, collapse, non-active-row close, and close-all behavior
- PASS for the compact single-line CSS assertions

- [ ] **Step 5: Commit the shared `Open Editors` UI**

```bash
git add \
  packages/web/src/features/workspace/views/shared/open-editors-section.tsx \
  packages/web/src/features/workspace/views/shared/open-editors-section.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add open editors controls"
```

---

### Task 4: Verify Desktop And Mobile Integration

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`

- [ ] **Step 1: Write the failing integration tests**

Extend `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx` with:

```tsx
  it("renders the shared open editors controls on mobile and closes the active row to the next file", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        return {
          files: [
            { path: "README.md", name: "README.md", kind: "file" },
            {
              path: "src/mobile-files-sheet.tsx",
              name: "mobile-files-sheet.tsx",
              kind: "file",
            },
          ].filter((file) => file.path.toLowerCase().includes((args.query ?? "").toLowerCase())),
        };
      }

      return { ok: true };
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(activeFilePathAtomFamily("ws-test"), "src/mobile-files-sheet.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "README.md": {
        kind: "text",
        path: "README.md",
        content: "# docs",
        savedContent: "# docs",
        baseHash: "base-readme",
        isDirty: false,
      },
      "src/mobile-files-sheet.tsx": {
        kind: "text",
        path: "src/mobile-files-sheet.tsx",
        content: "export function MobileFilesSheet() {}\n",
        savedContent: "export function MobileFilesSheet() {}\n",
        baseHash: "base-mobile-files-sheet",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <MobileExplorerPanel
          workspaceId="ws-test"
          routeToDetail={vi.fn()}
          collapseVersion={0}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "Close all" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Open Editors/i })).toHaveTextContent("(2)");

    fireEvent.click(
      screen.getByRole("button", { name: "Close src/mobile-files-sheet.tsx" })
    );

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("README.md");
  });
```

Extend `packages/web/src/features/workspace/index.test.tsx` with:

```tsx
  it("returns the desktop main area to agent panes when close all removes the last open editor", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        };
      }

      return [];
    });

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
      "ws-test": {
        id: "ws-test",
        path: "/home/spencer/workspace/coder-studio",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-app",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByTestId("code-editor-host");

    fireEvent.click(screen.getByRole("button", { name: "Close all" }));

    expect(screen.getByTestId("agent-panes")).toBeInTheDocument();
    expect(screen.queryByTestId("code-editor-host")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the integration tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- FAIL because the current mobile explorer has no `Close all` or row-close buttons
- FAIL because desktop explorer has no `Close all` action yet

- [ ] **Step 3: Keep the existing desktop and mobile composition unchanged**

Do not introduce new wrappers. The shared section already sits in the right place for both layouts:

```tsx
<OpenEditorsSection workspaceId={workspaceId} />
```

```tsx
<OpenEditorsSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
```

No implementation file changes are required in this task unless the tests expose a missing prop or duplicated wrapper.

- [ ] **Step 4: Run the full targeted suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/actions/open-editors-close.test.ts \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/views/shared/open-editors-section.test.tsx \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  src/features/workspace/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS for helper logic, desktop editor-header close flow, shared section UI, mobile explorer controls, desktop main-area fallback, and theme assertions

- [ ] **Step 5: Commit the integration coverage**

```bash
git add \
  packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  packages/web/src/features/workspace/index.test.tsx
git commit -m "test: cover open editors integration"
```

---

## Self-Review

**Spec coverage:** The plan covers shared `Open Editors` header chrome, file count, collapse/expand, per-row close, localized `Close all`, deterministic close ordering, shared editor-header close logic on desktop, desktop main-area fallback, mobile explorer parity, and single-line truncation rules. No accepted requirement is left without a task.

**Placeholder scan:** No `TODO`, `TBD`, or “implement later” placeholders remain. Every task includes concrete file paths, code snippets, commands, and expected outcomes.

**Type consistency:** The plan uses one close helper (`resolveOpenEditorsClose`), one shared hook (`useOpenEditorsActions`), and the same ordered-path rule (`orderOpenEditorPaths`) everywhere. `action.close_all` is explicitly introduced before the UI starts using it.
