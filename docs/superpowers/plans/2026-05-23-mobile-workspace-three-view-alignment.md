# Mobile Workspace Three-View Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the mobile workspace resources sheet from `Files / Git` into `Explorer / Search / Source Control`, add `Open Editors` plus `Quick Jump` inside Explorer, and keep the existing segmented-tab interaction while aligning the tab icon semantics with desktop.

**Architecture:** Keep the mobile sheet shell and detail-route model intact, but split the root resources surface into three views. Build a dedicated mobile Explorer composition layer from shared `Open Editors` and `Quick Jump` sections, reuse the existing `SearchPanel` logic with a mobile variant, and route all mobile file-opening entry points through `useOpenLocation` plus detail-route callbacks so root-sheet navigation and editor loading stay consistent.

**Tech Stack:** React 19, Jotai, React Router, Vitest, Testing Library, `lucide-react`, existing websocket command dispatch, and shared styles in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-23-mobile-workspace-three-view-alignment-design.md`

**Git hygiene:** The worktree already contains unrelated user changes. Read files before patching them, stage only the files listed in each task, and never revert unrelated edits.

---

## File Structure

**New files:**
- `packages/web/src/features/workspace/views/shared/open-editors-section.tsx` — shared `Open Editors` section used by desktop Explorer and the new mobile Explorer
- `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx` — filename/path jump section for mobile Explorer using `file.search`
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx` — mobile Explorer composition layer that stacks `Open Editors`, `Quick Jump`, and the file tree
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx` — coverage for mobile Explorer composition and `Quick Jump`

**Modified files:**
- `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts` — export the shared mobile sidebar-view type
- `packages/web/src/features/workspace/views/shared/explorer-panel.tsx` — switch desktop Explorer to the shared `Open Editors` section
- `packages/web/src/features/workspace/views/shared/search-panel.tsx` — add a mobile variant and a callback for route-aware file opening
- `packages/web/src/features/workspace/views/shared/search-panel.test.tsx` — verify mobile variant behavior
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx` — replace two text tabs with three icon tabs and render `Explorer / Search / Git`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` — cover the three-view mobile shell
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx` — hold the new mobile root-view state and title mapping
- `packages/web/src/styles/components.css` — mobile Explorer section styling, quick-jump rows, mobile Search variant, and icon-tab alignment
- `packages/web/src/styles/components.theme.test.ts` — lock the new icon-tab and shared surface selectors
- `packages/web/src/locales/en.json` — add `Quick Jump` copy
- `packages/web/src/locales/zh.json` — add `快速跳转` copy
- `packages/web/src/ui-preview/scenes/showcase-scenes.tsx` — keep the mobile resources preview scene aligned with the new props and default tab

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-files-sheet.test.tsx src/features/workspace/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/ui-preview/catalog.test.tsx`

---

### Task 1: Build Shared Explorer Sections And Mobile Explorer Composition

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
- Create: `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx`
- Create: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx`
- Create: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/explorer-panel.tsx`

- [ ] **Step 1: Write the failing mobile Explorer composition test**

Create `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx` with this coverage:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { MobileExplorerPanel } from "./mobile-explorer-panel";

const fileTreePanelSpy = vi.fn();

vi.mock("../shared/file-tree-panel", () => ({
  FileTreePanel: (props: unknown) => {
    fileTreePanelSpy(props);
    return <div data-testid="file-tree-panel" />;
  },
}));

describe("MobileExplorerPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fileTreePanelSpy.mockReset();
  });

  it("renders open editors, quick jump, and a file tree without the embedded tree search", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        return {
          files: [
            { path: "README.md", name: "README.md", kind: "file" },
            { path: "src/mobile-files-sheet.tsx", name: "mobile-files-sheet.tsx", kind: "file" },
          ].filter((file) =>
            file.path.toLowerCase().includes((args.query ?? "").toLowerCase())
          ),
        };
      }

      return { ok: true };
    });

    const onSelectFile = vi.fn();
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
          routeToDetail={onSelectFile}
          collapseVersion={0}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/mobile-files-sheet.tsx" })).toHaveClass(
      "workspace-open-editors__item--active"
    );
    expect(screen.getByRole("searchbox", { name: /Quick Jump|快速跳转/i })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: /Search Files|搜索文件/i })).toBeNull();
    expect(fileTreePanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "mobile",
        showSearch: false,
      })
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Quick Jump|快速跳转/i }), {
      target: { value: "read" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    fireEvent.click(await screen.findByRole("button", { name: /README\.md/i }));

    expect(onSelectFile).toHaveBeenCalledWith("README.md");
  });
});
```

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx
```

Expected:
- FAIL because `MobileExplorerPanel` does not exist yet
- FAIL because there is no `Quick Jump` section or shared `Open Editors` component

- [ ] **Step 3: Implement the shared sections and mobile Explorer panel**

Create `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`:

```tsx
import { useAtomValue, useSetAtom } from "jotai";
import type { FC } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
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

export const OpenEditorsSection: FC<OpenEditorsSectionProps> = ({
  workspaceId,
  onSelectFile,
  title,
}) => {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const openEditorPaths = Object.keys(openFiles).sort((left, right) => left.localeCompare(right));

  return (
    <section className="workspace-sidebar-section">
      <h2 className="workspace-sidebar-section__title">
        {title ?? t("workspace.sidebar.open_editors")}
      </h2>
      <div className="workspace-open-editors">
        {openEditorPaths.map((path) => (
          <button
            key={path}
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
            {path}
          </button>
        ))}
      </div>
    </section>
  );
};
```

Create `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx`:

```tsx
import type { FileNode } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import {
  deriveEditorModeForPath,
  editorModeAtomFamily,
} from "../../atoms";

interface SearchFilesResult {
  files: FileNode[];
}

interface QuickJumpSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
}

export function QuickJumpSection({ workspaceId, onSelectFile }: QuickJumpSectionProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestIdRef = useRef(0);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const requestId = ++requestIdRef.current;

    const timeout = window.setTimeout(() => {
      void dispatch<SearchFilesResult>("file.search", {
        workspaceId,
        query: trimmed,
        limit: 10,
      })
        .then((result) => {
          if (cancelled || requestId !== requestIdRef.current) {
            return;
          }

          if (!result.ok || !result.data) {
            setResults([]);
            setFailed(true);
            return;
          }

          setResults(result.data.files);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [dispatch, query, workspaceId]);

  return (
    <section className="workspace-sidebar-section workspace-quick-jump">
      <h2 className="workspace-sidebar-section__title">{t("workspace.quick_jump.title")}</h2>
      <label className="workspace-quick-jump__search" htmlFor={`quick-jump-${workspaceId}`}>
        <ThemedIcon semantic="nav.search" size={14} aria-hidden="true" />
        <input
          id={`quick-jump-${workspaceId}`}
          type="search"
          className="workspace-quick-jump__input"
          aria-label={t("workspace.quick_jump.title")}
          placeholder={t("workspace.quick_jump.placeholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {hasQuery ? (
        <div className="workspace-quick-jump__results">
          {loading ? (
            <p className="workspace-quick-jump__state">{t("common.loading")}</p>
          ) : failed ? (
            <p className="workspace-quick-jump__state">{t("workspace.quick_jump.failed")}</p>
          ) : results.length === 0 ? (
            <p className="workspace-quick-jump__state">{t("workspace.quick_jump.no_results")}</p>
          ) : (
            results.map((file) => (
              <button
                key={file.path}
                type="button"
                className="workspace-quick-jump__item"
                onClick={() => {
                  setEditorMode(deriveEditorModeForPath(file.path));
                  void openLocation({
                    workspaceId,
                    path: file.path,
                    source: "manual",
                  });
                  onSelectFile?.(file.path);
                }}
              >
                <span className="workspace-quick-jump__primary">{file.name}</span>
                <span className="workspace-quick-jump__secondary">{file.path}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
```

Create `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx`:

```tsx
import { useTranslation } from "../../../../lib/i18n";
import type { CreateRequest } from "../../actions/use-file-actions";
import { FileTreePanel } from "../shared/file-tree-panel";
import { OpenEditorsSection } from "../shared/open-editors-section";
import { QuickJumpSection } from "../shared/quick-jump-section";

interface MobileExplorerPanelProps {
  workspaceId: string;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  collapseVersion?: number;
  routeToDetail: (path: string) => void;
}

export function MobileExplorerPanel({
  workspaceId,
  createRequest = null,
  onCreateRequestConsumed,
  collapseVersion = 0,
  routeToDetail,
}: MobileExplorerPanelProps) {
  const t = useTranslation();

  return (
    <div className="mobile-explorer-panel">
      <OpenEditorsSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <QuickJumpSection workspaceId={workspaceId} onSelectFile={routeToDetail} />
      <section className="workspace-sidebar-section workspace-sidebar-section--fill">
        <h2 className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</h2>
        <FileTreePanel
          workspaceId={workspaceId}
          createRequest={createRequest}
          onCreateRequestConsumed={onCreateRequestConsumed}
          onSelectFile={routeToDetail}
          collapseVersion={collapseVersion}
          variant="mobile"
          showSearch={false}
        />
      </section>
    </div>
  );
}
```

Update `packages/web/src/features/workspace/views/shared/explorer-panel.tsx` to use `OpenEditorsSection`:

```diff
-import { useAtomValue } from "jotai";
 import { ChevronsUp } from "lucide-react";
 import type { FC } from "react";
 import { useState } from "react";
 import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
 import { useTranslation } from "../../../../lib/i18n";
-import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
 import { PanelHeader } from "../../../shared/components/panel-header";
 import type { WorkspaceCreateRequest } from "../../actions/use-workspace-screen-model";
-import { activeFilePathAtomFamily, openFilesAtomFamily } from "../../atoms";
 import { FileTreePanel } from "./file-tree-panel";
+import { OpenEditorsSection } from "./open-editors-section";

 ...

-        <section className="workspace-sidebar-section">
-          <h2 className="workspace-sidebar-section__title">
-            {t("workspace.sidebar.open_editors")}
-          </h2>
-          <div className="workspace-open-editors">
-            {openEditorPaths.map((path) => (
-              <button ...>{path}</button>
-            ))}
-          </div>
-        </section>
+        <OpenEditorsSection workspaceId={workspaceId} />
```

- [ ] **Step 4: Run the Explorer tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx
```

Expected:
- PASS
- `MobileExplorerPanel` renders `Open Editors`, `Quick Jump`, and the tree with `showSearch={false}`

- [ ] **Step 5: Commit the Explorer section work**

```bash
git add \
  packages/web/src/features/workspace/views/shared/open-editors-section.tsx \
  packages/web/src/features/workspace/views/shared/quick-jump-section.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/explorer-panel.tsx
git commit -m "feat: add mobile explorer sections"
```

---

### Task 2: Reuse SearchPanel In Mobile Sheet Mode

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`

- [ ] **Step 1: Write the failing mobile SearchPanel variant test**

Add this test to `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`:

```tsx
  it("renders a mobile variant without the desktop header and still opens the selected match", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);
    const onSelectFile = vi.fn();
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" variant="mobile" onSelectFile={onSelectFile} />
      </Provider>
    );

    expect(screen.queryByRole("heading", { name: /Search|搜索/i })).toBeNull();

    await searchFor("needle");
    fireEvent.click(screen.getByRole("button", { name: /12.*needle/i }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(onSelectFile).toHaveBeenCalledWith("src/app.tsx");
  });
```

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- FAIL because `SearchPanel` does not accept `variant` or `onSelectFile`
- FAIL because the desktop `PanelHeader` is still always rendered

- [ ] **Step 3: Implement the mobile SearchPanel variant**

Update `packages/web/src/features/workspace/views/shared/search-panel.tsx`:

```diff
-import { useAtomValue } from "jotai";
+import { useAtomValue, useSetAtom } from "jotai";
 ...
 import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
+import { deriveEditorModeForPath, editorModeAtomFamily } from "../../atoms";
 import { PanelHeader } from "../../../shared/components/panel-header";
 
 interface SearchPanelProps {
   workspaceId: string;
+  variant?: "desktop" | "mobile";
+  onSelectFile?: (path: string) => void;
 }
 
-export const SearchPanel: FC<SearchPanelProps> = ({ workspaceId }) => {
+export const SearchPanel: FC<SearchPanelProps> = ({
+  workspaceId,
+  variant = "desktop",
+  onSelectFile,
+}) => {
   const t = useTranslation();
   const dispatch = useAtomValue(dispatchCommandAtom);
   const { openLocation } = useOpenLocation(workspaceId);
+  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
   ...
 
+  const openMatch = (path: string, line: number, column: number, endColumn: number) => {
+    setEditorMode(deriveEditorModeForPath(path));
+    void openLocation({
+      workspaceId,
+      path,
+      line,
+      column,
+      endColumn,
+      source: "search",
+    });
+    onSelectFile?.(path);
+  };
+
   return (
-    <div className="workspace-sidebar-view workspace-search-panel">
-      <PanelHeader title={t("workspace.sidebar.search")} />
+    <div className={`workspace-sidebar-view workspace-search-panel workspace-search-panel--${variant}`}>
+      {variant === "desktop" ? <PanelHeader title={t("workspace.sidebar.search")} /> : null}
 
       <div className="workspace-search-panel__controls">
         <input
           ref={inputRef}
           type="search"
 ...
                         <button
                           key={`${file.path}:${match.line}:${match.column}`}
                           type="button"
                           className="workspace-search-panel__match"
-                          onClick={() =>
-                            void openLocation({
-                              workspaceId,
-                              path: file.path,
-                              line: match.line,
-                              column: match.column,
-                              endColumn: match.endColumn,
-                              source: "search",
-                            })
-                          }
+                          onClick={() =>
+                            openMatch(file.path, match.line, match.column, match.endColumn)
+                          }
                         >
```

- [ ] **Step 4: Run the SearchPanel tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- PASS
- Desktop behavior unchanged
- Mobile variant omits the desktop heading but still updates `activeFilePath` and calls `onSelectFile`

- [ ] **Step 5: Commit the SearchPanel work**

```bash
git add \
  packages/web/src/features/workspace/views/shared/search-panel.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.test.tsx
git commit -m "feat: add mobile search panel variant"
```

---

### Task 3: Wire Mobile Files Sheet To Explorer, Search, And Source Control

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- Modify: `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`

- [ ] **Step 1: Write the failing three-view mobile sheet tests**

Update `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` to use `Explorer / Search / Git` and mobile stubs:

```tsx
vi.mock("./mobile-explorer-panel", () => ({
  MobileExplorerPanel: () => <div data-testid="mobile-explorer-panel" />,
}));

vi.mock("../shared/search-panel", () => ({
  SearchPanel: ({ variant }: { variant?: string }) => (
    <div data-testid="search-panel" data-variant={variant} />
  ),
}));

it("renders three icon tabs and keeps explorer actions scoped to the explorer view", async () => {
  render(
    <Provider store={createStore()}>
      <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeView="explorer" />
    </Provider>
  );

  expect(screen.getByRole("tab", { name: /Explorer|资源管理器/i })).toHaveClass(
    "mobile-files-sheet__segment",
    "active"
  );
  expect(screen.getByRole("tab", { name: /Search|搜索/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Source Control|源代码管理/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New File" })).toBeInTheDocument();
  expect(screen.getByTestId("mobile-explorer-panel")).toBeInTheDocument();
});

it("renders the mobile search panel without explorer actions when Search is active", () => {
  render(
    <Provider store={createStore()}>
      <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeView="search" />
    </Provider>
  );

  expect(screen.queryByRole("button", { name: "New File" })).toBeNull();
  expect(screen.getByTestId("search-panel")).toHaveAttribute("data-variant", "mobile");
});

it("keeps Git preview routing on the third tab", () => {
  const handleRouteChange = vi.fn();

  render(
    <Provider store={createStore()}>
      <MobileFilesSheet
        workspaceId="ws-test"
        route={{ kind: "root" }}
        activeView="source-control"
        onRouteChange={handleRouteChange}
      />
    </Provider>
  );

  fireEvent.click(screen.getByRole("button", { name: "git-panel" }));

  expect(handleRouteChange).toHaveBeenCalledWith({
    kind: "detail",
    path: "abc123",
    title: "abc123 · commit subject",
  });
});
```

- [ ] **Step 2: Run the mobile sheet tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
```

Expected:
- FAIL because `MobileFilesSheet` still accepts `"files" | "git"`
- FAIL because Search is not a first-class root view
- FAIL because tabs still render text labels instead of icon-only controls with aria labels

- [ ] **Step 3: Implement the three-view mobile resources shell**

In `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`, export the shared view union:

```diff
export type MobileWorkspaceSidebarView = "explorer" | "search" | "source-control";

 export type WorkspaceMainAreaMode = "agent" | "editor";
 export type MobileWorkspaceSheetKind = "files" | "terminal" | "supervisor" | null;
 export type MobileFilesRoute =
```

Update `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`:

```diff
-import { ChevronsUp } from "lucide-react";
+import { ChevronsUp, FolderTree, GitBranch, Search } from "lucide-react";
 import { IconButton, Tab, TabList, Tabs, ThemedIcon, Tooltip } from "../../../../components/ui";
 import { useTranslation } from "../../../../lib/i18n";
 ...
-import type { MobileFilesRoute } from "../../actions/use-workspace-screen-model";
+import type {
+  MobileFilesRoute,
+  MobileWorkspaceSidebarView,
+} from "../../actions/use-workspace-screen-model";
 import type { GitDiffPreview } from "../../atoms";
-import { FileTreePanel } from "../shared/file-tree-panel";
 import { GitPanel } from "../shared/git-panel";
+import { SearchPanel } from "../shared/search-panel";
+import { MobileExplorerPanel } from "./mobile-explorer-panel";
 
 interface MobileFilesSheetProps {
   workspaceId: string;
   route: MobileFilesRoute;
-  activeTab: "files" | "git";
+  activeView: MobileWorkspaceSidebarView;
 ...
-  onTabChange?: (tab: "files" | "git") => void;
+  onTabChange?: (tab: MobileWorkspaceSidebarView) => void;
 }
 
+const mobileSheetTabs = [
+  { value: "explorer" as const, labelKey: "workspace.sidebar.explorer", icon: FolderTree },
+  { value: "search" as const, labelKey: "workspace.sidebar.search", icon: Search },
+  {
+    value: "source-control" as const,
+    labelKey: "workspace.sidebar.source_control",
+    icon: GitBranch,
+  },
+];
+
 export function MobileFilesSheet({
   workspaceId,
   route,
-  activeTab,
+  activeView,
 ...
       <div className="mobile-files-sheet__segmented">
         <Tabs
           aria-label={t("mobile.files.tabs")}
-          onValueChange={(tab) => onTabChange?.(tab as "files" | "git")}
-          value={activeTab}
+          onValueChange={(tab) => onTabChange?.(tab as MobileWorkspaceSidebarView)}
+          value={activeView}
         >
           <TabList className="mobile-files-sheet__tabs">
-            <Tab className="mobile-files-sheet__segment" value="files">
-              <span>{t("file.title")}</span>
-            </Tab>
-            <Tab className="mobile-files-sheet__segment" value="git">
-              <span>{t("label.git")}</span>
-            </Tab>
+            {mobileSheetTabs.map(({ value, labelKey, icon: Icon }) => (
+              <Tab
+                key={value}
+                className="mobile-files-sheet__segment"
+                value={value}
+                aria-label={t(labelKey)}
+              >
+                <Icon className="mobile-files-sheet__segment-icon" size={16} aria-hidden="true" />
+              </Tab>
+            ))}
           </TabList>
         </Tabs>
 
-        {activeTab === "files" ? (
+        {activeView === "explorer" ? (
           <div className="mobile-files-sheet__tab-actions">
 ...
       <div className="mobile-files-sheet__content">
-        {activeTab === "files" ? (
-          <FileTreePanel
+        {activeView === "explorer" ? (
+          <MobileExplorerPanel
             workspaceId={workspaceId}
             createRequest={createRequest}
             onCreateRequestConsumed={onCreateRequestConsumed}
-            onSelectFile={(path) => onRouteChange?.({ kind: "detail", path })}
+            routeToDetail={(path) => onRouteChange?.({ kind: "detail", path })}
             collapseVersion={collapseVersion}
-            variant="mobile"
           />
+        ) : activeView === "search" ? (
+          <SearchPanel
+            workspaceId={workspaceId}
+            variant="mobile"
+            onSelectFile={(path) => onRouteChange?.({ kind: "detail", path })}
+          />
         ) : (
           <GitPanel workspaceId={workspaceId} onPreviewOpen={handlePreviewOpen} variant="mobile" />
         )}
```

Update `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`:

```diff
+import type { MobileWorkspaceSidebarView } from "../../actions/use-workspace-screen-model";
 ...
-  const [mobileFilesTab, setMobileFilesTab] = useState<"files" | "git">("files");
+  const [mobileFilesView, setMobileFilesView] = useState<MobileWorkspaceSidebarView>("explorer");
 ...
          title:
            mobileFilesRoute.kind === "detail"
              ? (mobileFilesRoute.title ??
                mobileFilesRoute.path?.split("/").pop() ??
                t("mobile.files.editor_fallback"))
-              : mobileFilesTab === "files"
-                ? t("file.title")
-                : t("label.git"),
+              : mobileFilesView === "explorer"
+                ? t("workspace.sidebar.explorer")
+                : mobileFilesView === "search"
+                  ? t("workspace.sidebar.search")
+                  : t("workspace.sidebar.source_control"),
 ...
-              activeTab={mobileFilesTab}
+              activeView={mobileFilesView}
 ...
-              onTabChange={setMobileFilesTab}
+              onTabChange={setMobileFilesView}
```

Update the mobile preview scene in `packages/web/src/ui-preview/scenes/showcase-scenes.tsx`:

```diff
-          title="Files"
+          title="Explorer"
 ...
             <MobileFilesSheet
               workspaceId={workspace.id}
               route={{ kind: "root" }}
-              activeTab="files"
+              activeView="explorer"
             />
```

- [ ] **Step 4: Run the mobile sheet regression tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS
- Mobile root sheet now exposes `Explorer / Search / Source Control`
- Explorer actions render only on the Explorer tab

- [ ] **Step 5: Commit the mobile shell wiring**

```bash
git add \
  packages/web/src/features/workspace/actions/use-workspace-screen-model.ts \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx \
  packages/web/src/ui-preview/scenes/showcase-scenes.tsx
git commit -m "feat: align mobile workspace views with desktop"
```

---

### Task 4: Add Copy, Styling, And Theme Regression Coverage

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing style and copy assertions**

Add these assertions to `packages/web/src/styles/components.theme.test.ts` near the existing mobile files checks:

```tsx
    const mobileFilesSegmentIcon = getLastRuleBlock(".mobile-files-sheet__segment-icon");
    const mobileExplorerPanel = getLastRuleBlock(".mobile-explorer-panel");
    const mobileQuickJumpSearch = getLastRuleBlock(".workspace-quick-jump__search");
    const mobileQuickJumpItem = getLastRuleBlock(".workspace-quick-jump__item");
    const mobileSearchPanel = getLastRuleBlock(".workspace-search-panel--mobile");

    expect(mobileFilesSegment).toContain("justify-content: center");
    expect(mobileFilesSegment).toContain("min-width: 32px");
    expect(mobileFilesSegmentIcon).toContain("display: block");
    expect(mobileExplorerPanel).toContain("display: flex");
    expect(mobileExplorerPanel).toContain("flex-direction: column");
    expect(mobileQuickJumpSearch).toContain("border: 1px solid");
    expect(mobileQuickJumpItem).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(mobileSearchPanel).toContain("background: transparent");
```

Add a new `quick_jump` object under the existing `workspace` section in both locale files.

- [ ] **Step 2: Run the style test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because the new selectors do not exist yet

- [ ] **Step 3: Implement the styling and localized copy**

Update `packages/web/src/styles/components.css` with the new mobile resources selectors:

```css
.mobile-files-sheet__segment {
  justify-content: center;
  min-width: 32px;
}

.mobile-files-sheet__segment-icon {
  display: block;
  flex-shrink: 0;
}

.mobile-explorer-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.workspace-quick-jump {
  padding-bottom: var(--sp-3);
}

.workspace-quick-jump__search {
  display: flex;
  align-items: center;
  gap: var(--gap-default);
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-surface) 92%, var(--bg-page));
}

.workspace-quick-jump__input {
  min-width: 0;
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
}

.workspace-quick-jump__results {
  display: flex;
  flex-direction: column;
  padding-top: var(--sp-2);
}

.workspace-quick-jump__item {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  width: 100%;
  min-height: 40px;
  padding: 8px 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
}

.workspace-quick-jump__primary {
  color: var(--text-primary);
  font-size: var(--type-body-3-size);
}

.workspace-quick-jump__secondary {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--type-body-6-size);
}

.workspace-quick-jump__state {
  margin: 0;
  padding-top: var(--sp-2);
  color: var(--text-tertiary);
  font-size: var(--type-body-5-size);
}

.workspace-search-panel--mobile {
  background: transparent;
}

.workspace-search-panel--mobile .workspace-search-panel__controls {
  padding-top: 0;
}
```

Add the `quick_jump` object under the existing `workspace` section in both locale files:

```diff
    "sidebar": {
      "label": "Workspace activity bar",
      "explorer": "Explorer",
      "search": "Search",
      "source_control": "Source Control",
      "open_editors": "Open Editors",
      "workspace": "Workspace"
    },
+    "quick_jump": {
+      "title": "Quick Jump",
+      "placeholder": "Type a filename or path",
+      "no_results": "No matching files found.",
+      "failed": "File search failed. Try again."
+    },
    "search": {
```

and:

```diff
    "sidebar": {
      "label": "工作区活动栏",
      "explorer": "资源管理器",
      "search": "搜索",
      "source_control": "源代码管理",
      "open_editors": "打开的编辑器",
      "workspace": "工作区"
    },
+    "quick_jump": {
+      "title": "快速跳转",
+      "placeholder": "输入文件名或路径",
+      "no_results": "未找到匹配文件。",
+      "failed": "文件搜索失败，请重试。"
+    },
    "search": {
```

- [ ] **Step 4: Run the style and preview regressions**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts \
  src/ui-preview/catalog.test.tsx
```

Expected:
- PASS
- Theme checks lock the icon-tab and quick-jump styling hooks
- UI preview scene still renders with the new prop shape

- [ ] **Step 5: Commit the styling and copy updates**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "style: polish mobile workspace three-view sheet"
```

---

## Self-Review

### Spec coverage

- `Explorer / Search / Git` three-view mobile root model: Task 3
- keep segmented-tab interaction: Task 3 + Task 4
- icon-only tabs aligned with desktop semantics: Task 3 + Task 4
- `Open Editors` inside mobile Explorer: Task 1
- rename file-name search to `Quick Jump`: Task 1 + Task 4
- `Search` as file-content search aligned with desktop: Task 2 + Task 3
- keep Git as a separate third view: Task 3
- keep detail route model intact: Task 2 + Task 3

No spec gaps found.

### Placeholder scan

- Searched for `TODO`, `TBD`, and vague hand-offs while writing this file.
- No placeholder implementation steps remain.

### Type consistency

- Root mobile view union is consistently `MobileWorkspaceSidebarView = "explorer" | "search" | "source-control"`.
- Mobile sheet prop uses `activeView`, not the old `"files" | "git"` union.
- Route callback naming is consistently `onSelectFile` / `routeToDetail`.

No type-name drift remains.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-mobile-workspace-three-view-alignment.md`.

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
