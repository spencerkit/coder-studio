# VSCode Preview Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VSCode-style preview file tabs, fixed tabs, and editor-tab context menu close actions to the workspace editor.

**Architecture:** Keep preview behavior inside the existing web editor state layer. File tabs gain a `pinned` flag in `WorkspaceFileEditorTab`; `openEditorTabs` becomes the canonical ordered tab list while `openEditorPaths` remains a compatibility/persisted pinned-file list. File tree clicks pass an explicit open disposition, editor actions own pin/replace/close logic, and the tab header owns the visual/context-menu surface.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, lucide-react

---

## File Map

- `packages/web/src/features/workspace/atoms/files.ts`
  Adds file-tab `pinned`, helper constructors, and tab identity helpers.
- `packages/web/src/features/workspace/actions/open-editor-state.ts`
  Normalizes old file tabs as pinned and adds ordered tab list helpers.
- `packages/web/src/features/workspace/actions/open-editor-state.test.ts`
  Covers legacy normalization and preview tab preservation.
- `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`
  Accepts `openDisposition: "preview" | "pinned" | "preserve"` and applies file preview replacement.
- `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`
  Covers single-click preview replacement and double-click pinning.
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
  Routes file tree selection as preview.
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
  Adds file double-click pin entry.
- `packages/web/src/features/workspace/actions/use-open-editors-actions.ts`
  Keeps close behavior compatible with preview tabs and exposes close helpers for batch operations if needed.
- `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
  Pins preview tabs on edit and exposes tab-level close/pin/batch actions.
- `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`
  Extends non-file tab tests to ensure browser/canvas tabs still work with mixed file tab states.
- `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
  Renders preview tab style and opens the editor tab context menu.
- `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx`
  Covers preview visual state and context menu actions.
- `packages/web/src/features/workspace/views/shared/file-context-menu.tsx`
  Either remains as-is or is generalized only if necessary for editor tab context menus.

## Final Verification

Run after implementation:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/open-editor-state.test.ts src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/workspace/actions/open-editors-close.test.ts src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx src/features/workspace/views/shared/file-tree-panel.test.tsx
pnpm lint
```

Expected: targeted web tests pass, then repository lint exits `0`.

### Task 1: Add Preview/Pinned File Tab State Helpers

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/files.ts`
- Modify: `packages/web/src/features/workspace/actions/open-editor-state.ts`
- Test: `packages/web/src/features/workspace/actions/open-editor-state.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Add tests to `open-editor-state.test.ts`:

```ts
it("normalizes legacy file editor tabs as pinned", () => {
  expect(
    normalizeWorkspaceEditorUiStatePatch({
      openEditorTabs: [{ kind: "file", path: "src/app.ts" }],
      activeEditorTab: { kind: "file", path: "src/app.ts" },
    })
  ).toEqual({
    openEditorTabs: [{ kind: "file", path: "src/app.ts", pinned: true }],
    activeEditorTab: { kind: "file", path: "src/app.ts", pinned: true },
  });
});

it("preserves preview file editor tabs", () => {
  expect(
    normalizeWorkspaceEditorUiStatePatch({
      openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
      activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
    })
  ).toEqual({
    openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
    activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/open-editor-state.test.ts
```

Expected: FAIL because file tabs do not carry `pinned`.

- [ ] **Step 3: Implement minimal state helpers**

Change `WorkspaceFileEditorTab`:

```ts
export interface WorkspaceFileEditorTab {
  kind: "file";
  path: string;
  pinned?: boolean;
}
```

Add helpers near the tab types:

```ts
export function createWorkspaceFileEditorTab(
  path: string,
  options: { pinned?: boolean } = {}
): WorkspaceFileEditorTab {
  return {
    kind: "file",
    path,
    pinned: options.pinned ?? true,
  };
}

export function isPreviewFileEditorTab(tab: WorkspaceEditorTab | null | undefined): boolean {
  return tab?.kind === "file" && tab.pinned === false;
}
```

Update `normalizeWorkspaceFileEditorTab` to trim path and set `pinned`:

```ts
return {
  kind: "file",
  path: candidate.path.trim(),
  pinned: typeof candidate.pinned === "boolean" ? candidate.pinned : true,
};
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/open-editor-state.test.ts
```

Expected: PASS.

### Task 2: Add Preview Replacement and Pin Open Semantics

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`
- Modify: `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-file-actions.ts`

- [ ] **Step 1: Write failing open behavior tests**

Add tests to `use-open-workspace-file.test.tsx`:

```ts
it("replaces the existing preview file tab when opening another preview file", async () => {
  const store = createStore();
  seedWorkspace(store);
  store.set(openEditorTabsAtomFamily("ws-test"), [
    { kind: "file", path: "src/a.ts", pinned: false },
  ]);
  store.set(activeEditorTabAtomFamily("ws-test"), {
    kind: "file",
    path: "src/a.ts",
    pinned: false,
  });
  store.set(activeFilePathAtomFamily("ws-test"), "src/a.ts");

  const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
    wrapper: wrapperFor(store),
  });

  await act(async () => {
    await result.current.openWorkspaceFile(
      { workspaceId: "ws-test", path: "src/b.ts", source: "file-tree" },
      { openTarget: "navigate", openDisposition: "preview" }
    );
  });

  expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
    { kind: "file", path: "src/b.ts", pinned: false },
  ]);
  expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual({
    kind: "file",
    path: "src/b.ts",
    pinned: false,
  });
  expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/b.ts");
});

it("pins the current preview tab when opening the same file as pinned", async () => {
  const store = createStore();
  seedWorkspace(store);
  store.set(openEditorTabsAtomFamily("ws-test"), [
    { kind: "file", path: "src/a.ts", pinned: false },
  ]);
  store.set(activeEditorTabAtomFamily("ws-test"), {
    kind: "file",
    path: "src/a.ts",
    pinned: false,
  });
  store.set(activeFilePathAtomFamily("ws-test"), "src/a.ts");

  const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
    wrapper: wrapperFor(store),
  });

  await act(async () => {
    await result.current.openWorkspaceFile(
      { workspaceId: "ws-test", path: "src/a.ts", source: "file-tree" },
      { openTarget: "navigate", openDisposition: "pinned" }
    );
  });

  expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
    { kind: "file", path: "src/a.ts", pinned: true },
  ]);
  expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual(["src/a.ts"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-open-workspace-file.test.tsx
```

Expected: FAIL because `openDisposition` is not supported.

- [ ] **Step 3: Implement open disposition**

Extend `OpenWorkspaceFileOptions`:

```ts
openDisposition?: "preview" | "pinned" | "preserve";
```

In the standalone source-file branch, before persisting, compute next tabs:

```ts
const openDisposition = options.openDisposition ?? "pinned";
const currentOpenEditorTabs = store.get(openEditorTabsAtomFamily(workspaceId));
const existingFileTab = currentOpenEditorTabs.find(
  (tab) => tab.kind === "file" && tab.path === input.path
);
const existingPreviewTab = currentOpenEditorTabs.find(
  (tab) => tab.kind === "file" && tab.pinned === false
);
const nextFileTab = {
  kind: "file" as const,
  path: input.path,
  pinned: openDisposition !== "preview",
};
const nextOpenEditorTabs = existingFileTab
  ? currentOpenEditorTabs.map((tab) =>
      tab === existingFileTab ? { ...existingFileTab, pinned: nextFileTab.pinned } : tab
    )
  : openDisposition === "preview" && existingPreviewTab
    ? currentOpenEditorTabs.map((tab) => (tab === existingPreviewTab ? nextFileTab : tab))
    : [...currentOpenEditorTabs, nextFileTab];
```

Then set:

```ts
setOpenEditorTabs(nextOpenEditorTabs);
setActiveEditorTab(nextFileTab);
```

Only append to `openEditorPaths` when the resolved tab is pinned:

```ts
const nextOpenEditorPaths =
  nextFileTab.pinned === true
    ? appendOpenEditorPath(store.get(openEditorPathsAtomFamily(workspaceId)), input.path)
    : store.get(openEditorPathsAtomFamily(workspaceId));
```

Persist `openEditorTabs`, `activeEditorTab`, `activeEditorPath`, and the possibly unchanged `openEditorPaths`.

- [ ] **Step 4: Route file tree single-clicks to preview**

In `use-file-actions.ts`, change `handleSelectFile`:

```ts
void openWorkspaceFile(
  {
    workspaceId,
    path,
    source: "file-tree",
  },
  { openTarget: "navigate", openDisposition: "preview" }
);
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/workspace/actions/open-editor-state.test.ts
```

Expected: PASS.

### Task 3: Add File Tree Double-Click Pinning

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-file-actions.ts`
- Test: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`

- [ ] **Step 1: Add failing double-click test**

In `file-tree-panel.test.tsx`, add a test that renders a file row and double-clicks it. Mock `useFileActions` or assert through existing integration setup that `openWorkspaceFile` receives `{ openDisposition: "pinned" }`.

Use this assertion shape:

```ts
expect(openWorkspaceFile).toHaveBeenCalledWith(
  { workspaceId: "ws-test", path: "src/app.ts", source: "file-tree" },
  { openTarget: "navigate", openDisposition: "pinned" }
);
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: FAIL because rows do not have a pinning double-click path.

- [ ] **Step 3: Add a pin handler**

In `use-file-actions.ts`, add:

```ts
const handlePinFile = useCallback(
  (path: string) => {
    void openWorkspaceFile(
      {
        workspaceId,
        path,
        source: "file-tree",
      },
      { openTarget: "navigate", openDisposition: "pinned" }
    );
    onSelectFile?.(path);
  },
  [onSelectFile, openWorkspaceFile, workspaceId]
);
```

Return `handlePinFile`.

In `file-tree-panel.tsx`, thread `onPinFile` to file rows and attach:

```tsx
onDoubleClick={
  node.kind === "file"
    ? (event) => {
        event.preventDefault();
        onPinFile(node.path);
      }
    : undefined
}
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: PASS.

### Task 4: Pin Preview Tabs on Editing and Preserve Mixed Tab Behavior

**Files:**
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Test: `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`

- [ ] **Step 1: Add failing edit-to-pin test**

Add to `use-code-editor-actions.browser-tabs.test.tsx`:

```ts
it("pins an active preview file tab when the user edits it", async () => {
  const { store } = setupStore();
  store.set(openEditorTabsAtomFamily("ws-1"), [
    { kind: "file", path: "src/app.ts", pinned: false },
  ]);
  store.set(activeEditorTabAtomFamily("ws-1"), {
    kind: "file",
    path: "src/app.ts",
    pinned: false,
  });

  const { result } = renderHook(() => useCodeEditorActions(), {
    wrapper: createWrapper(store),
  });

  await act(async () => {
    result.current.handleContentChange("export const app = 2;\n");
  });

  expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
    { kind: "file", path: "src/app.ts", pinned: true },
  ]);
  expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual({
    kind: "file",
    path: "src/app.ts",
    pinned: true,
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx
```

Expected: FAIL because editing does not pin preview tabs.

- [ ] **Step 3: Pin active preview in `handleContentChange`**

Inside `handleContentChange`, after dirty state update, add:

```ts
if (currentActiveEditorTab?.kind === "file" && currentActiveEditorTab.path === currentFile.path) {
  const pinnedTab = { kind: "file" as const, path: currentFile.path, pinned: true };
  if (isGlobalEditorState) {
    setOpenEditorTabs((current) =>
      current.map((tab) =>
        tab.kind === "file" && tab.path === currentFile.path ? pinnedTab : tab
      )
    );
    setActiveEditorTab(pinnedTab);
  } else {
    setLocalOpenEditorTabs((current) =>
      current.map((tab) =>
        tab.kind === "file" && tab.path === currentFile.path ? pinnedTab : tab
      )
    );
    setLocalActiveEditorTab(pinnedTab);
  }
}
```

Persist the updated `openEditorTabs`, `activeEditorTab`, and append the path to `openEditorPaths` for global state.

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx
```

Expected: PASS.

### Task 5: Render Preview Tab Styling and Context Menu Actions

**Files:**
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx`

- [ ] **Step 1: Add failing tab header tests**

Add tests:

```ts
it("marks preview file tabs with a preview class", () => {
  render(
    <CodeEditorTabsHeader
      activeFilePath="src/preview.ts"
      activeFullPath="/workspace/src/preview.ts"
      activeEditorTab={{ kind: "file", path: "src/preview.ts", pinned: false }}
      openEditorTabs={[{ kind: "file", path: "src/preview.ts", pinned: false }]}
      openEditorPaths={[]}
      openFiles={{}}
      showPathRow={false}
      onActivateOpenFile={vi.fn()}
    />,
    { wrapper: wrapperFor() }
  );

  expect(screen.getByRole("tab")).toHaveClass("code-editor-tab--preview");
});

it("opens a tab context menu with keep open for preview tabs", async () => {
  const keepOpen = vi.fn();
  render(
    <CodeEditorTabsHeader
      activeFilePath="src/preview.ts"
      activeFullPath="/workspace/src/preview.ts"
      activeEditorTab={{ kind: "file", path: "src/preview.ts", pinned: false }}
      openEditorTabs={[{ kind: "file", path: "src/preview.ts", pinned: false }]}
      openEditorPaths={[]}
      openFiles={{}}
      showPathRow={false}
      onActivateOpenFile={vi.fn()}
      onKeepOpenEditorTab={keepOpen}
    />,
    { wrapper: wrapperFor() }
  );

  fireEvent.contextMenu(screen.getByRole("tab"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Keep Open" }));

  expect(keepOpen).toHaveBeenCalledWith({ kind: "file", path: "src/preview.ts", pinned: false });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx
```

Expected: FAIL because preview class and context menu are missing.

- [ ] **Step 3: Add header props and menu**

Add optional props:

```ts
onCloseOtherEditorTabs?: (tab: WorkspaceEditorTab) => void;
onCloseSavedEditorTabs?: () => void;
onCloseEditorTabsToRight?: (tab: WorkspaceEditorTab) => void;
onCloseAllEditorTabs?: () => void;
onKeepOpenEditorTab?: (tab: WorkspaceEditorTab) => void;
```

Track context menu state:

```ts
const [contextMenu, setContextMenu] = useState<{
  tab: WorkspaceEditorTab;
  x: number;
  y: number;
} | null>(null);
```

Render a small `role="menu"` portal or inline fixed layer with menuitem buttons. Include `Keep Open` only when `tab.kind === "file" && tab.pinned === false`.

Add `code-editor-tab--preview` and `code-editor-tab-item--preview` classes when `tab.kind === "file" && tab.pinned === false`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx
```

Expected: PASS.

### Task 6: Implement Batch Tab Actions in Editor Actions

**Files:**
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- Test: `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`

- [ ] **Step 1: Add failing batch close tests**

Add tests for:

```ts
it("closes saved file tabs while keeping dirty file tabs", async () => {
  const { store } = setupStore();
  store.set(openEditorTabsAtomFamily("ws-1"), [
    { kind: "file", path: "src/app.ts", pinned: true },
    { kind: "file", path: "src/dirty.ts", pinned: true },
  ]);
  store.set(openEditorPathsAtomFamily("ws-1"), ["src/app.ts", "src/dirty.ts"]);
  store.set(openFilesAtomFamily("ws-1"), {
    "src/app.ts": {
      kind: "text",
      path: "src/app.ts",
      content: "a",
      savedContent: "a",
      baseHash: "hash-app",
      isDirty: false,
    },
    "src/dirty.ts": {
      kind: "text",
      path: "src/dirty.ts",
      content: "changed",
      savedContent: "saved",
      baseHash: "hash-dirty",
      isDirty: true,
    },
  });

  const { result } = renderHook(() => useCodeEditorActions(), {
    wrapper: createWrapper(store),
  });

  await act(async () => {
    result.current.closeSavedEditorTabs();
  });

  expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
    { kind: "file", path: "src/dirty.ts", pinned: true },
  ]);
});
```

Add a second test for `closeEditorTabsToRight`.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx
```

Expected: FAIL because batch action methods are missing.

- [ ] **Step 3: Implement batch action methods**

Return these from `useCodeEditorActions`:

```ts
keepOpenEditorTab(tab: WorkspaceEditorTab): void
closeOtherEditorTabs(tab: WorkspaceEditorTab): void
closeEditorTabsToRight(tab: WorkspaceEditorTab): void
closeSavedEditorTabs(): void
closeAllEditorTabs(): void
```

Use the current ordered `openEditorTabsRef.current`. For file tabs, also update:

- `openFiles`
- `openEditorPaths`
- `activeFilePath`
- pending loads
- persisted UI state

For non-file tabs, use existing `closeEditorTab` identity behavior.

- [ ] **Step 4: Wire header props**

Where `CodeEditorTabsHeader` is rendered in `code-editor-host.tsx` and editor pane surfaces, pass the new methods:

```tsx
onKeepOpenEditorTab={state.keepOpenEditorTab}
onCloseOtherEditorTabs={state.closeOtherEditorTabs}
onCloseEditorTabsToRight={state.closeEditorTabsToRight}
onCloseSavedEditorTabs={state.closeSavedEditorTabs}
onCloseAllEditorTabs={state.closeAllEditorTabs}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx
```

Expected: PASS.

### Task 7: Final Verification and Commit

**Files:**
- All files modified above

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/actions/open-editor-state.test.ts src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/workspace/actions/open-editors-close.test.ts src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx src/features/code-editor/views/shared/code-editor-tabs-header.test.tsx src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run repository lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff --stat
git diff -- packages/web/src/features/workspace packages/web/src/features/code-editor
```

Expected: only files related to preview tabs and editor tab menu changed.

- [ ] **Step 4: Commit**

Run:

```bash
git add packages/web/src/features/workspace packages/web/src/features/code-editor docs/superpowers/plans/2026-06-25-vscode-preview-tabs.md
git commit -m "feat: add preview editor tabs"
```

Expected: commit succeeds.
