# Workspace Sidebar, Search, and Quick Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop `文件 / Git` sidebar tabs with a VS Code style workbench sidebar, add true workspace content search, and add a Quick Open file-jump overlay plus a desktop quick-action entry point.

**Architecture:** Split desktop workspace navigation into an Activity Bar and three independent sidebar views: `Explorer`, `Search`, and `Source Control`. Keep filename/path search on the existing `file.search` command for Quick Open, add a new `file.searchContent` command for real content search, and route both Search results and Quick Open through the existing `useOpenLocation` flow so file activation and navigation remain workspace-scoped and consistent.

**Tech Stack:** React 19, Jotai, React Router, Vitest, Testing Library, Node 24, existing websocket command dispatch, `rg` with a Node fallback for content search, and compatibility styles in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-23-workspace-sidebar-search-quick-open-design.md`

**Git hygiene:** The worktree may already contain unrelated user changes. Read files before patching them, stage only the files listed in each task, and never revert unrelated edits.

---

## File Structure

**New files:**
- `packages/server/src/fs/content-search.ts` — `rg`-first content-search helper with Node fallback, preview shaping, and truncation metadata
- `packages/server/src/__tests__/fs/content-search.test.ts` — helper tests for grouping, ignore behavior, fallback mode, binary skipping, and truncation
- `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx` — left-hand desktop Activity Bar for `Explorer`, `Search`, and `Source Control`
- `packages/web/src/features/workspace/views/shared/explorer-panel.tsx` — desktop Explorer wrapper with header, `Open Editors`, and file tree
- `packages/web/src/features/workspace/views/shared/search-panel.tsx` — desktop content-search view with debounce, highlight rendering, truncation messaging, retry, and open-location behavior
- `packages/web/src/features/workspace/views/shared/search-panel.test.tsx` — Search panel tests for debounce, highlight output, retry, and open-location
- `packages/web/src/features/quick-open/components/quick-open.tsx` — desktop Quick Open overlay, global shortcut handler, filename/path search loop, and keyboard navigation
- `packages/web/src/features/quick-open/components/quick-open.test.tsx` — Quick Open tests for keyboard trigger, query behavior, desktop-only scope, and file open
- `packages/web/src/features/quick-open/index.tsx` — Quick Open feature barrel

**Modified files:**
- `packages/core/src/domain/types.ts` — shared content-search result interfaces
- `packages/server/src/commands/file.ts` — register `file.searchContent`
- `packages/server/src/__tests__/file-commands.test.ts` — command-level coverage for `file.searchContent`
- `packages/web/src/atoms/app-ui.ts` — add `quickOpenOpenAtom`
- `packages/web/src/features/workspace/atoms/layout.ts` — add persisted desktop sidebar view state
- `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts` — replace desktop `files / git` tab state with `explorer / search / source-control`
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` — swap tabbed sidebar for Activity Bar + view shell
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx` — keep mobile filename search, allow desktop Explorer to hide it
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx` — lock desktop/mobile search split
- `packages/web/src/features/workspace/index.test.tsx` — workspace-level regression tests for new desktop sidebar structure
- `packages/web/src/features/command-palette/components/command-palette.tsx` — add a desktop-only “Go to File...” action that opens Quick Open
- `packages/web/src/features/command-palette/components/command-palette.test.tsx` — verify “Go to File...” opens Quick Open and stays hidden on mobile
- `packages/web/src/shells/desktop-shell.tsx` — mount `QuickOpen` next to `CommandPalette`
- `packages/web/src/shells/desktop-shell.test.tsx` — verify desktop shell mounts the new overlay
- `packages/web/src/styles/components.css` — sidebar shell, Activity Bar, Explorer/Search sections, Search results, and Quick Open styling
- `packages/web/src/locales/en.json` — add sidebar, Search, and Quick Open copy
- `packages/web/src/locales/zh.json` — add Chinese copy for the same states

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/index.test.tsx src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `pnpm --filter @coder-studio/server exec vitest run src/__tests__/fs/content-search.test.ts src/__tests__/file-commands.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx src/features/workspace/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/quick-open/components/quick-open.test.tsx src/features/command-palette/components/command-palette.test.tsx src/shells/desktop-shell.test.tsx`

---

### Task 1: Replace Desktop Sidebar Tabs With Activity Bar + Explorer Shell

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`
- Create: `packages/web/src/features/workspace/views/shared/explorer-panel.tsx`
- Modify: `packages/web/src/features/workspace/atoms/layout.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing desktop sidebar tests**

Add these tests to `packages/web/src/features/workspace/index.test.tsx` near the current desktop sidebar coverage:

```tsx
  it("renders an explorer-first activity bar and removes the desktop tree search box", async () => {
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
    store.set(openFilesAtomFamily("ws-test"), {
      "README.md": {
        kind: "text",
        path: "README.md",
        content: "# docs",
        savedContent: "# docs",
        baseHash: "base-readme",
        isDirty: false,
      },
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "export const App = () => null;\n",
        savedContent: "export const App = () => null;\n",
        baseHash: "base-app",
        isDirty: false,
      },
    });
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByText(/Open Editors|已打开的编辑器/i);

    expect(screen.getByRole("button", { name: /Explorer|资源管理器/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Search Files|搜索文件/i)).toBeNull();
    expect(document.querySelector(".workspace-activity-bar")).toBeTruthy();
  });

  it("switches desktop sidebar views from the activity bar", async () => {
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    expect(screen.getByRole("heading", { name: /Search|搜索/i })).toBeInTheDocument();
    expect(screen.getByText(/Type to search across file contents|输入关键词以搜索文件内容/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Source Control|源代码管理/i }));
    expect(screen.getByTestId("git-panel")).toBeInTheDocument();
  });
```

Add this focused regression to `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`:

```tsx
  it("omits the desktop filename search input when showSearch is false", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" showSearch={false} />
      </Provider>
    );

    expect(screen.queryByLabelText("action.search_files")).toBeNull();
  });
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected:
- FAIL because `WorkspaceDesktopView` still renders tab chrome instead of an Activity Bar
- FAIL because `FileTreePanel` always renders the desktop search input

- [ ] **Step 3: Implement the sidebar foundation and Explorer shell**

In `packages/web/src/features/workspace/atoms/layout.ts`, add persisted desktop sidebar state:

```diff
+export type DesktopSidebarView = "explorer" | "search" | "source-control";
+
+export const desktopSidebarViewAtom = atomWithStorage<DesktopSidebarView>(
+  "ui.desktopSidebarView",
+  "explorer"
+);
```

In `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`, replace desktop tab state with the persisted sidebar view:

```diff
-import { useAtomValue, useSetAtom, useStore } from "jotai";
+import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
+import { desktopSidebarViewAtom } from "../atoms/layout";
 
-export type WorkspaceSidebarTab = "files" | "git";
 export type WorkspaceMainAreaMode = "agent" | "editor";
 
-  const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>("files");
+  const [desktopSidebarView, setDesktopSidebarView] = useAtom(desktopSidebarViewAtom);
 
   const handleOpenBranchSwitcher = useCallback(() => {
     if (!workspace) {
       return;
     }
 
-    setSidebarTab("git");
+    setDesktopSidebarView("source-control");
     setBranchQuickPick({
       visible: true,
       workspaceId: workspace.id,
       inputValue: "",
     });
-  }, [setBranchQuickPick, workspace]);
+  }, [setBranchQuickPick, setDesktopSidebarView, workspace]);
 
   return {
     createRequest,
+    desktopSidebarView,
     handleConsumeCreateRequest,
     handleOpenBranchSwitcher,
     handleOpenFileCreate,
     handleOpenFolderCreate,
     mainAreaMode,
-    setSidebarTab,
+    setDesktopSidebarView,
     sidebarCollapsed,
-    sidebarTab,
     terminalPanelVisible,
     workspace,
```

Create `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`:

```tsx
import { FolderTree, GitBranch, Search } from "lucide-react";
import type { FC } from "react";
import { useTranslation } from "../../../../lib/i18n";
import type { DesktopSidebarView } from "../../atoms/layout";

interface WorkspaceActivityBarProps {
  activeView: DesktopSidebarView;
  onChange: (view: DesktopSidebarView) => void;
}

export const WorkspaceActivityBar: FC<WorkspaceActivityBarProps> = ({
  activeView,
  onChange,
}) => {
  const t = useTranslation();
  const items = [
    { value: "explorer" as const, icon: FolderTree, label: t("workspace.sidebar.explorer") },
    { value: "search" as const, icon: Search, label: t("workspace.sidebar.search") },
    {
      value: "source-control" as const,
      icon: GitBranch,
      label: t("workspace.sidebar.source_control"),
    },
  ];

  return (
    <div className="workspace-activity-bar" aria-label={t("workspace.sidebar.label")}>
      {items.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={activeView === value}
          className={`workspace-activity-bar__button${
            activeView === value ? " workspace-activity-bar__button--active" : ""
          }`}
          onClick={() => onChange(value)}
        >
          <Icon aria-hidden="true" size={18} strokeWidth={1.9} />
        </button>
      ))}
    </div>
  );
};
```

Create `packages/web/src/features/workspace/views/shared/explorer-panel.tsx`:

```tsx
import { useAtomValue } from "jotai";
import { ChevronsUp } from "lucide-react";
import type { FC } from "react";
import { IconButton, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { PanelHeader } from "../../../shared/components/panel-header";
import { activeFilePathAtomFamily, openFilesAtomFamily } from "../../atoms/files";
import type { CreateRequest } from "../../actions/use-file-actions";
import { FileTreePanel } from "./file-tree-panel";

interface ExplorerPanelProps {
  workspaceId: string;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  onOpenFileCreate: () => void;
  onOpenFolderCreate: () => void;
  onCollapseAll: () => void;
  collapseVersion: number;
}

export const ExplorerPanel: FC<ExplorerPanelProps> = ({
  workspaceId,
  createRequest = null,
  onCreateRequestConsumed,
  onOpenFileCreate,
  onOpenFolderCreate,
  onCollapseAll,
  collapseVersion,
}) => {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const openEditors = Object.values(openFiles).sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="workspace-sidebar-view">
      <PanelHeader
        title={t("workspace.sidebar.explorer")}
        actions={
          <div className="workspace-sidebar-panel__actions">
            <Tooltip content={t("file.new_file")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.new_file")}
                icon={<ThemedIcon semantic="file.action.new" size={14} />}
                onClick={onOpenFileCreate}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.new_folder")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.new_folder")}
                icon={<ThemedIcon semantic="file.action.newFolder" size={14} />}
                onClick={onOpenFolderCreate}
                size="sm"
              />
            </Tooltip>
            <Tooltip content={t("file.collapse_all")}>
              <IconButton
                className="panel-toolbar-btn"
                aria-label={t("file.collapse_all")}
                icon={<ChevronsUp size={14} />}
                onClick={onCollapseAll}
                size="sm"
              />
            </Tooltip>
          </div>
        }
      />

      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked">
        <section className="workspace-sidebar-section">
          <div className="workspace-sidebar-section__title">{t("workspace.sidebar.open_editors")}</div>
          <div className="workspace-open-editors">
            {openEditors.map((file) => (
              <button
                key={file.path}
                type="button"
                className={`workspace-open-editors__item${
                  activeFilePath === file.path ? " workspace-open-editors__item--active" : ""
                }`}
                onClick={() =>
                  void openLocation({
                    workspaceId,
                    path: file.path,
                    source: "manual",
                  })
                }
              >
                {file.path}
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-sidebar-section workspace-sidebar-section--fill">
          <div className="workspace-sidebar-section__title">{t("workspace.sidebar.workspace")}</div>
          <FileTreePanel
            workspaceId={workspaceId}
            createRequest={createRequest}
            onCreateRequestConsumed={onCreateRequestConsumed}
            collapseVersion={collapseVersion}
            variant="desktop"
            showSearch={false}
          />
        </section>
      </div>
    </div>
  );
};
```

Update `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx` so desktop Explorer can hide the filename search box without affecting mobile:

```diff
 interface FileTreePanelProps {
   workspaceId: string;
   refreshToken?: number;
   createRequest?: CreateRequest | null;
   onCreateRequestConsumed?: () => void;
   onSelectFile?: (path: string) => void;
   onVisibleCountChange?: (count: number, loading: boolean) => void;
   collapseVersion?: number;
   variant?: "desktop" | "mobile";
+  showSearch?: boolean;
 }
 
 export const FileTreePanel: FC<FileTreePanelProps> = ({
   workspaceId,
   refreshToken = 0,
   createRequest = null,
   onCreateRequestConsumed,
   onSelectFile,
   onVisibleCountChange,
   collapseVersion = 0,
   variant = "desktop",
+  showSearch = true,
 }) => {
 
-      <label
-        className={`file-tree-search ${variant === "desktop" ? "file-tree-search--desktop" : ""}`}
-        htmlFor={`file-tree-search-${workspaceId}`}
-      >
-        <ThemedIcon
-          semantic="file.action.search"
-          size={14}
-          className="file-tree-search-icon"
-          aria-hidden="true"
-        />
-        <input
-          id={`file-tree-search-${workspaceId}`}
-          className="file-tree-search-input"
-          type="search"
-          value={searchValue}
-          onChange={(event) => setSearchValue(event.target.value)}
-          placeholder={t("action.search_files")}
-          aria-label={t("action.search_files")}
-        />
-      </label>
+      {showSearch ? (
+        <label
+          className={`file-tree-search ${
+            variant === "desktop" ? "file-tree-search--desktop" : ""
+          }`}
+          htmlFor={`file-tree-search-${workspaceId}`}
+        >
+          <ThemedIcon
+            semantic="file.action.search"
+            size={14}
+            className="file-tree-search-icon"
+            aria-hidden="true"
+          />
+          <input
+            id={`file-tree-search-${workspaceId}`}
+            className="file-tree-search-input"
+            type="search"
+            value={searchValue}
+            onChange={(event) => setSearchValue(event.target.value)}
+            placeholder={t("action.search_files")}
+            aria-label={t("action.search_files")}
+          />
+        </label>
+      ) : null}
```

Update `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` so desktop Search uses a temporary placeholder in this task and Task 3 replaces it with the real `SearchPanel`:

```diff
-import {
-  EmptyState,
-  IconButton,
-  Tab,
-  TabList,
-  Tabs,
-  ThemedIcon,
-  Tooltip,
-} from "../../../../components/ui";
+import { EmptyState } from "../../../../components/ui";
 import { useTranslation } from "../../../../lib/i18n";
 import { AgentPanes } from "../../../agent-panes";
 import { CodeEditorHost } from "../../../code-editor/views/shared/code-editor-host";
 import { PanelHeader } from "../../../shared/components/panel-header";
 import { TerminalPanel } from "../../../terminal-panel";
 import { TopBar } from "../../../topbar";
 import { useWorkspaceFullscreen } from "../../actions/use-workspace-fullscreen";
 import { useWorkspaceScreenModel } from "../../actions/use-workspace-screen-model";
 import { sidebarCollapsedAtom } from "../../atoms";
-import { FileTreePanel } from "../shared/file-tree-panel";
 import { GitPanel } from "../shared/git-panel";
+import { ExplorerPanel } from "../shared/explorer-panel";
+import { WorkspaceActivityBar } from "../shared/workspace-activity-bar";
 
 const {
   createRequest,
+  desktopSidebarView,
   focusMode,
   gitState,
   handleBottomMouseDown,
   handleConsumeCreateRequest,
   handleLeftMouseDown,
   handleOpenBranchSwitcher,
   handleOpenFileCreate,
   handleOpenFolderCreate,
   leftPanelWidth,
   leftPanelRef,
   mainAreaMode,
-  setSidebarTab,
+  setDesktopSidebarView,
   sidebarCollapsed,
-  sidebarTab,
   terminalPanelVisible,
   workspace,
   bottomPanelHeight,
   bottomPanelRef,
 } = useWorkspaceScreenModel();
 
 if (event.key === "1") {
   event.preventDefault();
-  setSidebarTab("files");
+  setDesktopSidebarView("explorer");
   return;
 }
 
 if (event.key === "2") {
   event.preventDefault();
-  setSidebarTab("git");
+  setDesktopSidebarView("search");
+  return;
+}
+
+if (event.key === "3") {
+  event.preventDefault();
+  setDesktopSidebarView("source-control");
 }
 
-}, [setSidebarCollapsed, setSidebarTab]);
+}, [setDesktopSidebarView, setSidebarCollapsed]);
 
<div className="nav-panel workspace-sidebar-panel">
  <WorkspaceActivityBar
    activeView={desktopSidebarView}
    onChange={setDesktopSidebarView}
  />
  <div className="workspace-sidebar-panel__content">
    {desktopSidebarView === "explorer" ? (
      <ExplorerPanel
        workspaceId={workspace.id}
        createRequest={createRequest}
        onCreateRequestConsumed={handleConsumeCreateRequest}
        collapseVersion={fileTreeCollapseVersion}
        onOpenFileCreate={handleOpenFileCreate}
        onOpenFolderCreate={handleOpenFolderCreate}
        onCollapseAll={() => setFileTreeCollapseVersion((value) => value + 1)}
      />
    ) : desktopSidebarView === "search" ? (
      <div className="workspace-sidebar-view">
        <PanelHeader title={t("workspace.sidebar.search")} />
        <div className="workspace-sidebar-panel__body">
          <EmptyState
            style={{ minHeight: "auto", padding: "var(--sp-4)" }}
            title={<p>{t("workspace.search.empty")}</p>}
          />
        </div>
      </div>
    ) : (
      <div className="workspace-sidebar-view">
        <PanelHeader title={t("workspace.sidebar.source_control")} />
        <div className="workspace-sidebar-panel__body">
          <GitPanel workspaceId={workspace.id} variant="desktop" />
        </div>
      </div>
    )}
  </div>
</div>
```

Add the Activity Bar, section, and open-editor styles in `packages/web/src/styles/components.css`:

```css
.workspace-sidebar-panel {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  min-height: 0;
  height: 100%;
  background: var(--bg-panel);
}

.workspace-activity-bar {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 10px 6px;
  border-right: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  background: color-mix(in srgb, var(--bg-sidebar) 92%, var(--bg-panel));
}

.workspace-activity-bar__button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
}

.workspace-activity-bar__button--active {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-hover) 94%, transparent);
}

.workspace-activity-bar__button--active::before {
  content: "";
  position: absolute;
  left: -6px;
  top: 5px;
  bottom: 5px;
  width: 2px;
  border-radius: 999px;
  background: var(--accent-blue);
}

.workspace-sidebar-panel__content,
.workspace-sidebar-view {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.workspace-sidebar-panel__body--stacked {
  display: grid;
  gap: 10px;
  padding: 8px 0 0;
}

.workspace-sidebar-section {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.workspace-sidebar-section--fill {
  min-height: 0;
  flex: 1;
}

.workspace-sidebar-section__title {
  padding: 0 12px 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-open-editors {
  display: grid;
  gap: 2px;
  padding: 0 8px;
}

.workspace-open-editors__item {
  min-height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  padding: 0 8px;
}

.workspace-open-editors__item--active {
  background: var(--state-selected-bg);
  color: var(--text-primary);
}
```

Add sidebar strings to `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`:

```json
"workspace": {
  "sidebar": {
    "label": "Workspace sidebar",
    "explorer": "Explorer",
    "search": "Search",
    "source_control": "Source Control",
    "open_editors": "Open Editors",
    "workspace": "Workspace"
  },
  "search": {
    "empty": "Type to search across file contents"
  }
}
```

```json
"workspace": {
  "sidebar": {
    "label": "工作区侧边栏",
    "explorer": "资源管理器",
    "search": "搜索",
    "source_control": "源代码管理",
    "open_editors": "已打开的编辑器",
    "workspace": "工作区"
  },
  "search": {
    "empty": "输入关键词以搜索文件内容"
  }
}
```

- [ ] **Step 4: Re-run the focused tests to verify the desktop shell is green**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected:
- PASS
- the desktop sidebar now uses an Activity Bar and Explorer sections
- mobile filename search coverage stays intact because `showSearch` defaults to `true`
- the Search branch still uses a placeholder, which is intentional until Task 3

- [ ] **Step 5: Commit the sidebar foundation slice**

```bash
git add \
  packages/web/src/features/workspace/atoms/layout.ts \
  packages/web/src/features/workspace/actions/use-workspace-screen-model.ts \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx \
  packages/web/src/features/workspace/views/shared/explorer-panel.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx \
  packages/web/src/features/workspace/index.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add desktop workbench sidebar shell"
```

---

### Task 2: Add `file.searchContent` With `rg` + Node Fallback

**Files:**
- Create: `packages/server/src/fs/content-search.ts`
- Create: `packages/server/src/__tests__/fs/content-search.test.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/commands/file.ts`
- Modify: `packages/server/src/__tests__/file-commands.test.ts`

- [ ] **Step 1: Write the failing backend tests**

Create `packages/server/src/__tests__/fs/content-search.test.ts`:

```ts
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFileContents } from "../../fs/content-search.js";

describe("searchFileContents", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `content-search-${Date.now()}`);
    await mkdir(rootDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("groups matches by file and returns preview highlight metadata", async () => {
    await writeFile(
      join(rootDir, "src.ts"),
      "const alpha = 1;\nconst needleValue = alpha;\nexport { needleValue };\n"
    );

    const result = await searchFileContents(rootDir, "needle", {
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    expect(result.files).toEqual([
      {
        path: "src.ts",
        name: "src.ts",
        matchCount: 2,
        hasMoreMatches: false,
        matches: [
          expect.objectContaining({
            line: 2,
            column: 7,
            preview: expect.stringContaining("needleValue"),
            previewColumnStart: 7,
          }),
          expect.objectContaining({
            line: 3,
            preview: expect.stringContaining("needleValue"),
          }),
        ],
      },
    ]);
    expect(result.hasMoreFiles).toBe(false);
  });

  it("falls back to the Node scanner when rg is unavailable", async () => {
    await writeFile(join(rootDir, "notes.txt"), "first line\nneedle on second line\n");

    const result = await searchFileContents(
      rootDir,
      "needle",
      { maxFiles: 50, maxMatchesPerFile: 20 },
      {
        runRg: vi.fn(async () => {
          const error = Object.assign(new Error("rg missing"), { code: "ENOENT" });
          throw error;
        }),
      }
    );

    expect(result.files).toEqual([
      {
        path: "notes.txt",
        name: "notes.txt",
        matchCount: 1,
        hasMoreMatches: false,
        matches: [expect.objectContaining({ line: 2, preview: expect.stringContaining("needle") })],
      },
    ]);
  });

  it("respects .gitignore, skips binary files, and reports truncation", async () => {
    await writeFile(join(rootDir, ".gitignore"), "ignored.txt\n");
    await writeFile(join(rootDir, "ignored.txt"), "needle\n");
    await writeFile(join(rootDir, "keep.txt"), "needle\nneedle\nneedle\n");
    await writeFile(join(rootDir, "binary.bin"), "\u0000needle");

    const result = await searchFileContents(
      rootDir,
      "needle",
      { maxFiles: 50, maxMatchesPerFile: 2 },
      {
        runRg: vi.fn(async () => {
          const error = Object.assign(new Error("rg missing"), { code: "ENOENT" });
          throw error;
        }),
      }
    );

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: "keep.txt",
      matchCount: 3,
      hasMoreMatches: true,
    });
    expect(result.files[0].matches).toHaveLength(2);
    expect(result.truncatedMatchFileCount).toBe(1);
  });
});
```

Add this command-level test to `packages/server/src/__tests__/file-commands.test.ts`:

```ts
  it("searches file contents through file.searchContent", async () => {
    await writeFile(
      join(testDir, "src.ts"),
      "export const alpha = true;\nexport const needle = alpha;\n"
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "file-search-content-1",
        op: "file.searchContent",
        args: {
          workspaceId,
          query: "needle",
          maxFiles: 50,
          maxMatchesPerFile: 20,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect((result.data as { files: Array<{ path: string; matchCount: number }> }).files).toEqual([
      expect.objectContaining({
        path: "src.ts",
        matchCount: 1,
      }),
    ]);
  });
```

- [ ] **Step 2: Run the backend tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/fs/content-search.test.ts \
  src/__tests__/file-commands.test.ts
```

Expected:
- FAIL because `searchFileContents` does not exist
- FAIL because `file.searchContent` is not registered

- [ ] **Step 3: Implement shared result types and the server-side content-search helper**

In `packages/core/src/domain/types.ts`, add shared content-search types below `FileNode`:

```ts
export interface SearchContentMatch {
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  previewColumnStart: number;
  previewColumnEnd: number;
}

export interface SearchContentFileResult {
  path: string;
  name: string;
  matchCount: number;
  hasMoreMatches: boolean;
  matches: SearchContentMatch[];
}

export interface SearchContentResult {
  files: SearchContentFileResult[];
  totalMatchCount: number;
  hasMoreFiles: boolean;
  truncatedMatchFileCount: number;
}
```

Create `packages/server/src/fs/content-search.ts`:

```ts
import type {
  SearchContentFileResult,
  SearchContentMatch,
  SearchContentResult,
} from "@coder-studio/core";
import { execFile } from "child_process";
import { readdir, readFile, stat } from "fs/promises";
import { basename, join, relative } from "path";
import { promisify } from "util";
import { createGitignoreFilter } from "./gitignore.js";

const execFileAsync = promisify(execFile);
const FALLBACK_MAX_FILE_BYTES = 1_000_000;
const PREVIEW_CONTEXT_CHARS = 40;

export interface SearchContentOptions {
  maxFiles: number;
  maxMatchesPerFile: number;
}

interface SearchContentDeps {
  runRg?: typeof execFileAsync;
}

export async function searchFileContents(
  rootPath: string,
  query: string,
  options: SearchContentOptions,
  deps: SearchContentDeps = {}
): Promise<SearchContentResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return {
      files: [],
      totalMatchCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    };
  }

  const runRg = deps.runRg ?? execFileAsync;

  try {
    const { stdout } = await runRg(
      "rg",
      [
        "--json",
        "--line-number",
        "--column",
        "--smart-case",
        "--hidden",
        "--glob",
        "!.git",
        normalizedQuery,
        rootPath,
      ],
      { cwd: rootPath, maxBuffer: 10 * 1024 * 1024 }
    );

    return parseRgJson(stdout, rootPath, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return scanFileContentsFallback(rootPath, normalizedQuery, options);
  }
}

function parseRgJson(
  stdout: string,
  rootPath: string,
  options: SearchContentOptions
): SearchContentResult {
  const files = new Map<string, SearchContentFileResult>();
  let totalMatchCount = 0;
  let hasMoreFiles = false;
  let truncatedMatchFileCount = 0;

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const event = JSON.parse(line) as {
      type: string;
      data?: {
        path?: { text: string };
        line_number?: number;
        lines?: { text: string };
        submatches?: Array<{ start: number; end: number }>;
      };
    };

    if (event.type !== "match" || !event.data?.path?.text || !event.data.line_number) {
      continue;
    }

    const relPath = relative(rootPath, event.data.path.text);
    const current =
      files.get(relPath) ??
      {
        path: relPath,
        name: basename(relPath),
        matchCount: 0,
        hasMoreMatches: false,
        matches: [],
      };

    if (!files.has(relPath) && files.size >= options.maxFiles) {
      hasMoreFiles = true;
      continue;
    }

    const submatch = event.data.submatches?.[0];
    if (!submatch) {
      continue;
    }

    totalMatchCount += 1;
    current.matchCount += 1;

    if (current.matches.length >= options.maxMatchesPerFile) {
      if (!current.hasMoreMatches) {
        current.hasMoreMatches = true;
        truncatedMatchFileCount += 1;
      }
      files.set(relPath, current);
      continue;
    }

    current.matches.push(buildPreviewMatch(event.data.lines?.text ?? "", event.data.line_number, submatch.start, submatch.end));
    files.set(relPath, current);
  }

  return {
    files: [...files.values()],
    totalMatchCount,
    hasMoreFiles,
    truncatedMatchFileCount,
  };
}

function buildPreviewMatch(
  lineText: string,
  line: number,
  matchStart: number,
  matchEnd: number
): SearchContentMatch {
  const trimmedLine = lineText.replace(/\r?\n$/, "");
  const start = Math.max(0, matchStart - PREVIEW_CONTEXT_CHARS);
  const end = Math.min(trimmedLine.length, matchEnd + PREVIEW_CONTEXT_CHARS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < trimmedLine.length ? "…" : "";
  const preview = `${prefix}${trimmedLine.slice(start, end)}${suffix}`;
  const previewColumnStart = prefix.length + (matchStart - start) + 1;
  const previewColumnEnd = previewColumnStart + (matchEnd - matchStart);

  return {
    line,
    column: matchStart + 1,
    endColumn: matchEnd + 1,
    preview,
    previewColumnStart,
    previewColumnEnd,
  };
}

async function scanFileContentsFallback(
  rootPath: string,
  query: string,
  options: SearchContentOptions
): Promise<SearchContentResult> {
  const loweredQuery = query.toLowerCase();
  const files: SearchContentFileResult[] = [];
  let totalMatchCount = 0;
  let hasMoreFiles = false;
  let truncatedMatchFileCount = 0;

  async function walk(dirPath: string): Promise<void> {
    if (files.length >= options.maxFiles) {
      hasMoreFiles = true;
      return;
    }

    const filter = createGitignoreFilter(rootPath, dirPath);
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!filter(entry.name) || entry.name === ".git") {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        if (files.length >= options.maxFiles) {
          return;
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.size > FALLBACK_MAX_FILE_BYTES) {
        continue;
      }

      const content = await readFile(fullPath, "utf-8").catch(() => null);
      if (!content || content.includes("\u0000")) {
        continue;
      }

      const matches: SearchContentMatch[] = [];
      let matchCount = 0;

      for (const [index, line] of content.split(/\r?\n/).entries()) {
        let searchStart = 0;
        const loweredLine = line.toLowerCase();

        while (searchStart < loweredLine.length) {
          const foundIndex = loweredLine.indexOf(loweredQuery, searchStart);
          if (foundIndex === -1) {
            break;
          }

          matchCount += 1;
          totalMatchCount += 1;

          if (matches.length < options.maxMatchesPerFile) {
            matches.push(buildPreviewMatch(line, index + 1, foundIndex, foundIndex + query.length));
          }

          searchStart = foundIndex + Math.max(query.length, 1);
        }
      }

      if (matchCount === 0) {
        continue;
      }

      const hasMoreMatches = matchCount > matches.length;
      if (hasMoreMatches) {
        truncatedMatchFileCount += 1;
      }

      files.push({
        path: relative(rootPath, fullPath),
        name: entry.name,
        matchCount,
        hasMoreMatches,
        matches,
      });
    }
  }

  await walk(rootPath);

  return {
    files,
    totalMatchCount,
    hasMoreFiles,
    truncatedMatchFileCount,
  };
}
```

Register the command in `packages/server/src/commands/file.ts`:

```diff
-import { readTree, searchFiles } from "../fs/tree.js";
+import { searchFileContents } from "../fs/content-search.js";
+import { readTree, searchFiles } from "../fs/tree.js";
 
 registerCommand(
+  "file.searchContent",
+  z.object({
+    workspaceId: z.string(),
+    query: z.string(),
+    maxFiles: z.number().int().positive().max(200),
+    maxMatchesPerFile: z.number().int().positive().max(200),
+  }),
+  async (args, ctx) => {
+    const workspace = ctx.workspaceMgr.get(args.workspaceId);
+    if (!workspace) {
+      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
+    }
+
+    return searchFileContents(workspace.path, args.query, {
+      maxFiles: args.maxFiles,
+      maxMatchesPerFile: args.maxMatchesPerFile,
+    });
+  }
+);
```

- [ ] **Step 4: Re-run the backend tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/__tests__/fs/content-search.test.ts \
  src/__tests__/file-commands.test.ts
```

Expected:
- PASS
- `file.searchContent` returns grouped file matches with preview highlight metadata
- fallback tests pass even if `rg` is unavailable in CI
- truncation and ignore handling are covered

- [ ] **Step 5: Commit the content-search backend slice**

```bash
git add \
  packages/core/src/domain/types.ts \
  packages/server/src/fs/content-search.ts \
  packages/server/src/__tests__/fs/content-search.test.ts \
  packages/server/src/commands/file.ts \
  packages/server/src/__tests__/file-commands.test.ts
git commit -m "feat: add workspace content search command"
```

---

### Task 3: Build the Desktop Search View and Wire It to `file.searchContent`

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- Create: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing Search panel tests**

Create `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { SearchContentResult } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { activeFilePathAtomFamily } from "../../atoms/files";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import { SearchPanel } from "./search-panel";

describe("SearchPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces content queries, renders grouped results, and highlights matches", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 2,
          hasMoreMatches: true,
          matches: [
            {
              line: 3,
              column: 7,
              endColumn: 13,
              preview: "const needleValue = searchState;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
            {
              line: 8,
              column: 8,
              endColumn: 14,
              preview: "return needleValue;",
              previewColumnStart: 8,
              previewColumnEnd: 14,
            },
          ],
        },
      ],
      totalMatchCount: 2,
      hasMoreFiles: true,
      truncatedMatchFileCount: 1,
    } satisfies SearchContentResult);
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.searchContent",
        {
          workspaceId: "ws-test",
          query: "needle",
          maxFiles: 50,
          maxMatchesPerFile: 20,
        },
        undefined
      );
    });

    expect(await screen.findByText("app.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getAllByText("needleValue")[0]?.tagName).toBe("MARK");
    expect(screen.getByText(/Results limited|结果已截断/i)).toBeInTheDocument();
  });

  it("opens the file at the selected match location", async () => {
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
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    fireEvent.click(await screen.findByRole("button", { name: /12/ }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      line: 12,
      column: 5,
      source: "search",
    });
  });

  it("shows retry when the search command fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("boom"));
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(await screen.findByRole("button", { name: /Retry|重试/i })).toBeInTheDocument();
  });
});
```

Add this integration test to `packages/web/src/features/workspace/index.test.tsx`:

```tsx
  it("renders the content search input when the Search activity item is active", async () => {
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

      if (op === "file.searchContent") {
        return {
          files: [],
          totalMatchCount: 0,
          hasMoreFiles: false,
          truncatedMatchFileCount: 0,
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

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<WorkspaceDesktopView />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    expect(screen.getByRole("searchbox", { name: /Search|搜索/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the Search panel tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- FAIL because `SearchPanel` does not exist
- FAIL because the desktop Search view still only renders the placeholder state

- [ ] **Step 3: Implement `SearchPanel`, highlight rendering, retry, and truncation messaging**

Create `packages/web/src/features/workspace/views/shared/search-panel.tsx`:

```tsx
import type { SearchContentMatch, SearchContentResult } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import type { FC, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { Button } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import { PanelHeader } from "../../../shared/components/panel-header";

interface SearchPanelProps {
  workspaceId: string;
}

function renderPreview(match: SearchContentMatch): ReactNode {
  const start = Math.max(0, match.previewColumnStart - 1);
  const end = Math.max(start, match.previewColumnEnd - 1);

  return (
    <>
      {match.preview.slice(0, start)}
      <mark>{match.preview.slice(start, end)}</mark>
      {match.preview.slice(end)}
    </>
  );
}

export const SearchPanel: FC<SearchPanelProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openLocation } = useOpenLocation(workspaceId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [results, setResults] = useState<SearchContentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    const timeout = window.setTimeout(() => {
      void dispatch<SearchContentResult>("file.searchContent", {
        workspaceId,
        query: trimmed,
        maxFiles: 50,
        maxMatchesPerFile: 20,
      })
        .then((result) => {
          if (cancelled) {
            return;
          }
          if (!result.ok || !result.data) {
            setResults(null);
            setError(true);
            return;
          }
          setResults(result.data);
        })
        .catch(() => {
          if (!cancelled) {
            setResults(null);
            setError(true);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [dispatch, query, retryNonce, workspaceId]);

  const renderedMatchCount = useMemo(
    () => results?.files.reduce((sum, file) => sum + file.matchCount, 0) ?? 0,
    [results]
  );

  return (
    <div className="workspace-sidebar-view workspace-search-panel">
      <PanelHeader title={t("workspace.sidebar.search")} />

      <div className="workspace-search-panel__controls">
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label={t("workspace.sidebar.search")}
          className="workspace-search-panel__input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("workspace.search.placeholder")}
        />

        <div className="workspace-search-panel__summary">
          {loading
            ? t("common.loading")
            : query.trim()
              ? t("workspace.search.results_count", {
                  count: renderedMatchCount,
                  files: results?.files.length ?? 0,
                })
              : t("workspace.search.empty")}
        </div>

        {results && (results.hasMoreFiles || results.truncatedMatchFileCount > 0) ? (
          <div className="workspace-search-panel__truncate-note">
            {t("workspace.search.truncated")}
          </div>
        ) : null}
      </div>

      <div className="workspace-search-panel__results">
        {error ? (
          <div className="workspace-search-panel__state-block">
            <p className="workspace-search-panel__state">{t("workspace.search.failed")}</p>
            <Button size="sm" variant="secondary" onClick={() => setRetryNonce((value) => value + 1)}>
              {t("workspace.search.retry")}
            </Button>
          </div>
        ) : !query.trim() ? (
          <p className="workspace-search-panel__state">{t("workspace.search.empty")}</p>
        ) : loading ? (
          <p className="workspace-search-panel__state">{t("common.loading")}</p>
        ) : !results || results.files.length === 0 ? (
          <p className="workspace-search-panel__state">{t("workspace.search.no_results")}</p>
        ) : (
          results.files.map((file) => (
            <section key={file.path} className="workspace-search-panel__group">
              <div className="workspace-search-panel__group-header">
                <strong>{file.name}</strong>
                <span>{file.path}</span>
                <span>
                  {t("workspace.search.file_match_count", {
                    count: file.matchCount,
                    suffix: file.hasMoreMatches ? "+" : "",
                  })}
                </span>
              </div>

              {file.matches.map((match) => (
                <button
                  key={`${file.path}:${match.line}:${match.column}`}
                  type="button"
                  className="workspace-search-panel__match"
                  onClick={() =>
                    void openLocation({
                      workspaceId,
                      path: file.path,
                      line: match.line,
                      column: match.column,
                      endColumn: match.endColumn,
                      source: "search",
                    })
                  }
                >
                  <span className="workspace-search-panel__line">{match.line}</span>
                  <span className="workspace-search-panel__preview">{renderPreview(match)}</span>
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
};
```

Update `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` to replace the placeholder Search view:

```diff
+import { SearchPanel } from "../shared/search-panel";
 
   {desktopSidebarView === "explorer" ? (
     <ExplorerPanel
       workspaceId={workspace.id}
       createRequest={createRequest}
       onCreateRequestConsumed={handleConsumeCreateRequest}
       collapseVersion={fileTreeCollapseVersion}
       onOpenFileCreate={handleOpenFileCreate}
       onOpenFolderCreate={handleOpenFolderCreate}
       onCollapseAll={() => setFileTreeCollapseVersion((value) => value + 1)}
     />
   ) : desktopSidebarView === "search" ? (
-    <div className="workspace-sidebar-view">
-      <PanelHeader title={t("workspace.sidebar.search")} />
-      <div className="workspace-sidebar-panel__body">
-        <EmptyState
-          style={{ minHeight: "auto", padding: "var(--sp-4)" }}
-          title={<p>{t("workspace.search.empty")}</p>}
-        />
-      </div>
-    </div>
+    <SearchPanel workspaceId={workspace.id} />
   ) : (
```

Add Search view styles to `packages/web/src/styles/components.css`:

```css
.workspace-search-panel__controls {
  display: grid;
  gap: 8px;
  padding: 8px 12px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.workspace-search-panel__input {
  min-height: 32px;
  border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--bg-surface) 92%, var(--bg-panel));
  color: var(--text-primary);
  padding: 0 10px;
}

.workspace-search-panel__summary,
.workspace-search-panel__state,
.workspace-search-panel__group-header span,
.workspace-search-panel__line,
.workspace-search-panel__truncate-note {
  color: var(--text-tertiary);
  font-size: 12px;
}

.workspace-search-panel__truncate-note {
  padding: 6px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-hover) 90%, transparent);
}

.workspace-search-panel__results {
  display: grid;
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px 12px;
}

.workspace-search-panel__group {
  display: grid;
  gap: 4px;
}

.workspace-search-panel__group-header {
  display: grid;
  gap: 2px;
}

.workspace-search-panel__match {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  padding: 6px 8px;
  text-align: left;
}

.workspace-search-panel__match:hover {
  background: color-mix(in srgb, var(--bg-hover) 92%, transparent);
}

.workspace-search-panel__preview mark {
  background: color-mix(in srgb, var(--accent-blue) 30%, transparent);
  color: var(--text-primary);
}

.workspace-search-panel__state-block {
  display: grid;
  justify-items: start;
  gap: 8px;
}
```

Add Search strings to `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`:

```json
"workspace": {
  "search": {
    "placeholder": "Search workspace contents",
    "empty": "Type to search across file contents",
    "no_results": "No content matches found",
    "failed": "Search failed. Try again.",
    "retry": "Retry",
    "results_count": "{count} matches across {files} files",
    "file_match_count": "{count}{suffix} matches",
    "truncated": "Results limited to 50 files and 20 visible matches per file."
  }
}
```

```json
"workspace": {
  "search": {
    "placeholder": "搜索当前工作区内容",
    "empty": "输入关键词以搜索文件内容",
    "no_results": "没有找到内容匹配项",
    "failed": "搜索失败，请重试。",
    "retry": "重试",
    "results_count": "{files} 个文件中共 {count} 个匹配",
    "file_match_count": "{count}{suffix} 个匹配",
    "truncated": "结果已截断：最多显示 50 个文件，每个文件最多显示 20 条匹配。"
  }
}
```

- [ ] **Step 4: Re-run the Search panel tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS
- Search debounces requests at `250ms`
- Search result clicks update `activeFilePathAtomFamily` and `pendingEditorNavigationAtomFamily`
- highlight rendering uses backend preview columns
- truncation and retry states are covered

- [ ] **Step 5: Commit the desktop Search slice**

```bash
git add \
  packages/web/src/features/workspace/views/shared/search-panel.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.test.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  packages/web/src/features/workspace/index.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add desktop workspace search panel"
```

---

### Task 4: Add Quick Open and Expose It From Desktop Quick Actions

**Files:**
- Create: `packages/web/src/features/quick-open/components/quick-open.tsx`
- Create: `packages/web/src/features/quick-open/components/quick-open.test.tsx`
- Create: `packages/web/src/features/quick-open/index.tsx`
- Modify: `packages/web/src/atoms/app-ui.ts`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing Quick Open and quick-action tests**

Create `packages/web/src/features/quick-open/components/quick-open.test.tsx`:

```tsx
// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeWorkspaceIdAtom, workspaceOrderAtom, workspacesAtom } from "../../../atoms/workspaces";
import { quickOpenOpenAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { activeFilePathAtomFamily } from "../../workspace/atoms/files";
import { QuickOpen } from "./quick-open";

function seedWorkspace(store: ReturnType<typeof createStore>) {
  store.set(workspacesAtom, {
    "ws-test": {
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  } as never);
  store.set(workspaceOrderAtom, ["ws-test"]);
  store.set(activeWorkspaceIdAtom, "ws-test");
}

describe("QuickOpen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on Ctrl/Cmd+P and queries file.search for the active workspace", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "app" },
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.search",
        {
          workspaceId: "ws-test",
          query: "app",
          limit: 25,
        },
        undefined
      );
    });

    expect(await screen.findByText("app.tsx")).toBeInTheDocument();
  });

  it("opens the selected file and closes after Enter", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspace(store);
    store.set(quickOpenOpenAtom, true);

    render(
      <Provider store={store}>
        <QuickOpen />
      </Provider>
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      target: { value: "app" },
    });

    await screen.findByText("app.tsx");
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Go to File|跳转到文件/i }), {
      key: "Enter",
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(quickOpenOpenAtom)).toBe(false);
  });
});
```

Add these tests to `packages/web/src/features/command-palette/components/command-palette.test.tsx`:

```tsx
  it("opens Quick Open from the quick actions list on desktop", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.click(screen.getByText("Go to File..."));

    expect(store.get(quickOpenOpenAtom)).toBe(true);
    expect(store.get(commandPaletteOpenAtom)).toBe(false);
  });

  it("hides Go to File on mobile", () => {
    viewportMocks.viewport = "mobile";

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);
    store.set(workspacesAtom, {
      "ws-1": createWorkspace("ws-1", "/tmp/one"),
    });
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesLoadStateAtom, "ready");

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    expect(screen.queryByText("Go to File...")).toBeNull();
  });
```

Update `packages/web/src/shells/desktop-shell.test.tsx` mocks and add one coverage check:

```tsx
vi.mock("../features/quick-open", () => ({
  QuickOpen: () => <div>QuickOpen</div>,
}));

it("mounts QuickOpen beside CommandPalette on desktop", () => {
  window.history.replaceState({}, "", "/workspace");

  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);
  store.set(workspacesAtom, {
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
      },
    },
  });
  store.set(workspaceOrderAtom, ["ws-1"]);
  store.set(activeWorkspaceIdAtom, "ws-1");
  store.set(workspacesLoadStateAtom, "ready");

  renderShell(store);

  expect(screen.getByText("QuickOpen")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the Quick Open tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/quick-open/components/quick-open.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx
```

Expected:
- FAIL because `quickOpenOpenAtom` and `QuickOpen` do not exist
- FAIL because the command palette has no “Go to File...” action
- FAIL because desktop shell does not mount the overlay

- [ ] **Step 3: Implement Quick Open, its global state, and the desktop quick-action bridge**

In `packages/web/src/atoms/app-ui.ts`, add the new overlay state:

```diff
 export const commandPaletteOpenAtom = atom<boolean>(false);
+export const quickOpenOpenAtom = atom<boolean>(false);
```

Create `packages/web/src/features/quick-open/components/quick-open.tsx`:

```tsx
import type { FileNode } from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { quickOpenOpenAtom } from "../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { resolvedActiveWorkspaceIdAtom } from "../../../atoms/workspaces";
import { EmptyState, ThemedIcon, WorkbenchLayer } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { useOpenLocation } from "../../code-editor/actions/use-open-location";

interface SearchFilesResult {
  files: FileNode[];
}

export function QuickOpen() {
  const t = useTranslation();
  const [open, setOpen] = useAtom(quickOpenOpenAtom);
  const workspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const { openLocation } = useOpenLocation(workspaceId ?? "__workspace_placeholder__");
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [results, setResults] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }

    inputRef.current?.focus();
    setQuery("");
    setSelectedIndex(0);
    setResults([]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId) {
      return;
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const timeout = window.setTimeout(() => {
      void dispatch<SearchFilesResult>("file.search", {
        workspaceId,
        query: trimmed,
        limit: 25,
      })
        .then((result) => {
          if (cancelled) return;
          if (!result.ok || !result.data) {
            setError(t("quick_open.failed"));
            setResults([]);
            return;
          }
          setResults(result.data.files);
          setSelectedIndex(0);
        })
        .catch(() => {
          if (!cancelled) {
            setError(t("quick_open.failed"));
            setResults([]);
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
  }, [dispatch, open, query, t, workspaceId]);

  if (!open) {
    return null;
  }

  const activeResult = results[selectedIndex] ?? null;

  return (
    <WorkbenchLayer
      ariaLabel={t("quick_open.title")}
      initialFocus={() => inputRef.current}
      onOpenChange={setOpen}
      open
    >
      <div
        className="quick-open"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, Math.max(results.length - 1, 0)));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "Enter" && activeResult && workspaceId) {
            event.preventDefault();
            void openLocation({
              workspaceId,
              path: activeResult.path,
              source: "manual",
            });
            setOpen(false);
          }
        }}
      >
        <div className="quick-open__search">
          <ThemedIcon className="quick-open__icon" semantic="nav.search" size={16} />
          <input
            ref={inputRef}
            type="text"
            className="quick-open__input"
            aria-label={t("quick_open.title")}
            placeholder={t("quick_open.placeholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="quick-open__list">
          {!workspaceId ? (
            <EmptyState className="quick-open__empty" title={<p>{t("workspace.no_workspace")}</p>} />
          ) : error ? (
            <p className="quick-open__state">{error}</p>
          ) : !query.trim() ? (
            <p className="quick-open__state">{t("quick_open.empty")}</p>
          ) : loading ? (
            <p className="quick-open__state">{t("common.loading")}</p>
          ) : results.length === 0 ? (
            <p className="quick-open__state">{t("quick_open.no_results")}</p>
          ) : (
            results.map((file, index) => (
              <button
                key={file.path}
                type="button"
                className={`quick-open__item${
                  index === selectedIndex ? " quick-open__item--active" : ""
                }`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => {
                  if (!workspaceId) return;
                  void openLocation({
                    workspaceId,
                    path: file.path,
                    source: "manual",
                  });
                  setOpen(false);
                }}
              >
                <span className="quick-open__name">{file.name}</span>
                <span className="quick-open__path">{file.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </WorkbenchLayer>
  );
}
```

Create the barrel `packages/web/src/features/quick-open/index.tsx`:

```tsx
export { QuickOpen } from "./components/quick-open";
```

Mount the overlay in `packages/web/src/shells/desktop-shell.tsx`:

```diff
+import { QuickOpen } from "../features/quick-open";
 import { CommandPalette } from "../features/command-palette";
 
       </main>
 
+      <QuickOpen />
       <CommandPalette />
       <ToastContainer />
```

Add the desktop-only quick-action bridge to `packages/web/src/features/command-palette/components/command-palette.tsx`:

```diff
-import { commandPaletteOpenAtom } from "../../../atoms/app-ui";
+import { commandPaletteOpenAtom, quickOpenOpenAtom } from "../../../atoms/app-ui";
 
   const [isOpen, setIsOpen] = useAtom(commandPaletteOpenAtom);
+  const setQuickOpenOpen = useSetAtom(quickOpenOpenAtom);
 
   const commands = buildCommands({
     shellKind: isMobile ? "mobile" : "desktop",
     focusMode,
     setFocusMode,
     sidebarCollapsed,
     setSidebarCollapsed,
     terminalPanelVisible,
     setTerminalPanelVisible,
     bottomPanelHeight,
     setBottomPanelHeight,
     activeWorkspaceId,
     setActiveWorkspaceId,
     selectWorkspaceTarget,
     workspaces,
     locationPathname: location.pathname,
     navigate,
     t,
+    setQuickOpenOpen,
     setShowWorkspaceLaunch: (nextValue) => {
       if (nextValue) {
         setIsOpen(false);
       }
       setShowWorkspaceLaunch(nextValue);
     },
   });
 
 function buildCommands(context: {
   shellKind: ShellKind;
   focusMode: boolean;
   setFocusMode: (v: boolean) => void;
   sidebarCollapsed: boolean;
   setSidebarCollapsed: (v: boolean) => void;
   terminalPanelVisible: boolean;
   setTerminalPanelVisible: (v: boolean) => void;
   bottomPanelHeight: number;
   setBottomPanelHeight: (v: number) => void;
   activeWorkspaceId: string | null;
   setActiveWorkspaceId: (v: string | null) => void;
   selectWorkspaceTarget: (workspaceId: string) => Promise<unknown>;
   workspaces: Workspace[];
   locationPathname: string;
   navigate: (path: string) => void;
   t: (key: string) => string;
+  setQuickOpenOpen: (v: boolean) => void;
   setShowWorkspaceLaunch: (v: boolean) => void;
 }): Command[] {
   const {
     shellKind,
     focusMode,
     setFocusMode,
     sidebarCollapsed,
     setSidebarCollapsed,
     terminalPanelVisible,
     setTerminalPanelVisible,
     bottomPanelHeight,
     setBottomPanelHeight,
     activeWorkspaceId,
     setActiveWorkspaceId,
     selectWorkspaceTarget,
     workspaces,
     locationPathname,
     navigate,
     t,
+    setQuickOpenOpen,
     setShowWorkspaceLaunch,
   } = context;
 
   const commands: Command[] = [
     {
       id: "new-workspace",
       label: t("workspace.open"),
       description: t("workspace.open_hint"),
       shortcut: "Ctrl+N",
       action: () => {
         setShowWorkspaceLaunch(true);
       },
     },
   ];
 
   if (shellKind === "desktop" && activeWorkspaceId) {
     commands.push({
       id: "go-to-file",
       label: t("quick_open.command_label"),
       description: t("quick_open.command_description"),
       shortcut: "Ctrl+P",
       action: () => {
         setQuickOpenOpen(true);
       },
     });
   }
```

Add Quick Open styles to `packages/web/src/styles/components.css`:

```css
.quick-open {
  width: min(720px, calc(100vw - 32px));
  border-radius: 14px;
  background: var(--bg-panel);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.quick-open__search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
}

.quick-open__input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
}

.quick-open__list {
  display: grid;
  gap: 2px;
  max-height: 420px;
  overflow: auto;
  padding: 8px;
}

.quick-open__item {
  display: grid;
  gap: 2px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  padding: 10px 12px;
  text-align: left;
}

.quick-open__item--active,
.quick-open__item:hover {
  background: color-mix(in srgb, var(--bg-hover) 92%, transparent);
}

.quick-open__name {
  color: var(--text-primary);
  font-size: var(--type-body-3-size);
}

.quick-open__path,
.quick-open__state {
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
}
```

Add Quick Open strings to `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`:

```json
"quick_open": {
  "title": "Go to File",
  "placeholder": "Type a file name or path",
  "empty": "Type a file name or path to jump",
  "no_results": "No files found",
  "failed": "Unable to search files right now",
  "command_label": "Go to File...",
  "command_description": "Jump to a file in the current workspace"
}
```

```json
"quick_open": {
  "title": "跳转到文件",
  "placeholder": "输入文件名或路径",
  "empty": "输入文件名或路径以跳转",
  "no_results": "没有找到文件",
  "failed": "暂时无法搜索文件",
  "command_label": "跳转到文件...",
  "command_description": "在当前工作区中快速打开文件"
}
```

- [ ] **Step 4: Re-run the Quick Open tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/quick-open/components/quick-open.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx
```

Expected:
- PASS
- `Ctrl/Cmd+P` opens Quick Open
- clicking “Go to File...” from the command palette opens Quick Open and closes the palette
- “Go to File...” does not appear in the mobile command palette
- desktop shell mounts both global overlays

- [ ] **Step 5: Commit the Quick Open slice**

```bash
git add \
  packages/web/src/atoms/app-ui.ts \
  packages/web/src/features/quick-open/components/quick-open.tsx \
  packages/web/src/features/quick-open/components/quick-open.test.tsx \
  packages/web/src/features/quick-open/index.tsx \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/shells/desktop-shell.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add quick open file jump overlay"
```

---

## Self-Review Checklist

1. **Spec coverage**
   - Task 1 covers the Activity Bar, independent desktop sidebar views, Explorer ownership, and desktop filename-search removal.
   - Task 2 covers `file.searchContent`, grouped content-search results, `rg`, fallback scanning, ignore handling, binary skipping, preview truncation, and bounded result limits.
   - Task 3 covers the Search sidebar view, debounce, grouped matches, highlighted previews from backend columns, retry, and match-click open-location behavior.
   - Task 4 covers `Ctrl/Cmd+P`, Quick Open overlay behavior, desktop-only quick-action entry, and workspace-only file jump scope.

2. **Placeholder scan**
   - Task 1 intentionally uses a temporary Search placeholder so the sidebar shell can land before the real Search panel exists.
   - Task 3 explicitly removes that placeholder and swaps in `SearchPanel`.
   - No step relies on `TODO`, `TBD`, or unnamed helpers.

3. **Type consistency**
   - `DesktopSidebarView` values are always `explorer`, `search`, and `source-control`.
   - The backend content-search command is always named `file.searchContent`.
   - Search result open-location uses `source: "search"`.
   - Quick Open open-location uses `source: "manual"`.
   - Quick Open command-palette entry is desktop-only and requires an active workspace.
