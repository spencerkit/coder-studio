# Workspace Search And Quick Open Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the desktop `Search` sidebar and `Quick Open` overlay so they behave and read closer to VS Code, including collapsible file-group search results and a denser two-line file-only quick-open list.

**Architecture:** Keep the existing fetch and navigation flows intact. Limit functional changes to client-side presentation state: `SearchPanel` gains per-query expanded group state keyed by file path, and `QuickOpen` keeps file-only results while switching to a clearer two-line row hierarchy. CSS work lives in `components.css`, with focused theme assertions added to `components.theme.test.ts`.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library, Lucide React, existing `useOpenLocation` navigation, and shared theme assertions in `packages/web/src/styles/components.theme.test.ts`.

**Spec reference:** `docs/superpowers/specs/2026-05-23-workspace-search-quick-open-visual-refresh-design.md`

**Git hygiene:** The current worktree already contains unrelated user changes. Stage only the files listed in each task, and never revert unrelated edits.

---

## File Structure

**Modified files:**
- `packages/web/src/features/workspace/views/shared/search-panel.tsx` — add per-query expand state, header buttons, and compact match-list markup
- `packages/web/src/features/workspace/views/shared/search-panel.test.tsx` — cover default-expanded groups, collapse/re-expand behavior, reset-on-new-query behavior, and preserved navigation
- `packages/web/src/features/quick-open/components/quick-open.tsx` — change file result rows to a VS Code-like two-line hierarchy without changing data sources
- `packages/web/src/features/quick-open/components/quick-open.test.tsx` — cover two-line result structure and active-row keyboard behavior
- `packages/web/src/styles/components.css` — add the missing `workspace-search-panel*` and `quick-open*` selector rules for compact editor-like chrome
- `packages/web/src/styles/components.theme.test.ts` — assert the new selectors keep the intended compact hierarchy

**No backend changes:**
- `file.searchContent` payload shape already groups matches by file
- `file.search` already returns file-only results for `Quick Open`

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/quick-open/components/quick-open.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx src/features/quick-open/components/quick-open.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Add Collapsible Search Result Groups

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.tsx`

- [ ] **Step 1: Write the failing search-panel interaction tests**

Extend `packages/web/src/features/workspace/views/shared/search-panel.test.tsx` with these cases:

```tsx
  it("expands file groups by default and lets users collapse or re-expand them", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 2,
          hasMoreMatches: false,
          matches: [
            {
              line: 3,
              column: 7,
              endColumn: 18,
              preview: "const needleValue = searchState;",
              previewColumnStart: 7,
              previewColumnEnd: 18,
            },
            {
              line: 8,
              column: 8,
              endColumn: 19,
              preview: "return needleValue;",
              previewColumnStart: 8,
              previewColumnEnd: 19,
            },
          ],
        },
      ],
      totalMatchCount: 2,
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
      await vi.advanceTimersByTimeAsync(250);
    });

    const groupToggle = screen.getByRole("button", {
      name: /app\.tsx.*src\/app\.tsx.*2/i,
    });

    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /3.*needle/i })).toBeInTheDocument();

    fireEvent.click(groupToggle);

    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /3.*needle/i })).toBeNull();

    fireEvent.click(groupToggle);

    expect(groupToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /3.*needle/i })).toBeInTheDocument();
  });

  it("resets returned file groups to expanded after a new successful query", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        files: [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 3,
                column: 7,
                endColumn: 18,
                preview: "const needleValue = searchState;",
                previewColumnStart: 7,
                previewColumnEnd: 18,
              },
            ],
          },
        ],
        totalMatchCount: 1,
        hasMoreFiles: false,
        truncatedMatchFileCount: 0,
      } satisfies SearchContentResult)
      .mockResolvedValueOnce({
        files: [
          {
            path: "src/view-state.ts",
            name: "view-state.ts",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 12,
                column: 4,
                endColumn: 8,
                preview: "export const view = createViewState();",
                previewColumnStart: 14,
                previewColumnEnd: 18,
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
      await vi.advanceTimersByTimeAsync(250);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /app\.tsx.*src\/app\.tsx.*1/i,
      })
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "view" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const nextToggle = screen.getByRole("button", {
      name: /view-state\.ts.*src\/view-state\.ts.*1/i,
    });

    expect(nextToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /12.*view/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the search-panel tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- FAIL because file headers are not interactive buttons
- FAIL because there is no `aria-expanded` state or collapse behavior

- [ ] **Step 3: Implement per-query expand state and grouped header buttons**

Update `packages/web/src/features/workspace/views/shared/search-panel.tsx` so successful results initialize all returned paths as expanded, and group headers toggle match visibility.

```tsx
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function buildExpandedPaths(result: SearchContentResult): Record<string, boolean> {
  return Object.fromEntries(result.files.map((file) => [file.path, true]));
}

export const SearchPanel: FC<SearchPanelProps> = ({ workspaceId }) => {
  // existing state...
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setExpandedPaths({});
      setLoading(false);
      setError(false);
      return;
    }

    // existing debounce setup...
    const timeout = window.setTimeout(() => {
      void dispatchRef
        .current<SearchContentResult>("file.searchContent", {
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
            setExpandedPaths({});
            setError(true);
            return;
          }

          setResults(result.data);
          setExpandedPaths(buildExpandedPaths(result.data));
        })
        .catch(() => {
          if (!cancelled) {
            setResults(null);
            setExpandedPaths({});
            setError(true);
          }
        });
    }, 250);
  }, [query, retryNonce, workspaceId]);

  const toggleFileGroup = (path: string) => {
    setExpandedPaths((current) => ({
      ...current,
      [path]: !current[path],
    }));
  };

  return (
    <div className="workspace-sidebar-view workspace-search-panel">
      <PanelHeader title={t("workspace.sidebar.search")} />
      {/* existing controls */}
      <div className="workspace-search-panel__results">
        {results?.files.map((file) => {
          const expanded = expandedPaths[file.path] ?? true;
          const groupId = `workspace-search-group-${file.path.replace(/[^a-z0-9_-]+/gi, "-")}`;

          return (
            <section key={file.path} className="workspace-search-panel__group">
              <button
                type="button"
                className="workspace-search-panel__group-toggle"
                aria-expanded={expanded}
                aria-controls={groupId}
                onClick={() => toggleFileGroup(file.path)}
              >
                <span className="workspace-search-panel__group-chevron" aria-hidden="true">
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="workspace-search-panel__group-copy">
                  <strong className="workspace-search-panel__group-name">{file.name}</strong>
                  <span className="workspace-search-panel__group-path">{file.path}</span>
                </span>
                <span className="workspace-search-panel__group-count">
                  {t("workspace.search.file_match_count", {
                    count: file.matchCount,
                    suffix: file.hasMoreMatches ? "+" : "",
                  })}
                </span>
              </button>

              {expanded ? (
                <div id={groupId} className="workspace-search-panel__matches">
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
                      <span className="workspace-search-panel__preview">
                        {renderPreview(match)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run the search-panel tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- PASS
- Existing open-location assertions still pass

- [ ] **Step 5: Commit the interaction change**

```bash
git add \
  packages/web/src/features/workspace/views/shared/search-panel.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.test.tsx
git commit -m "feat(workspace): add collapsible search result groups"
```

---

### Task 2: Add Compact Search Sidebar Chrome

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing theme assertions for search chrome**

Add this case to `packages/web/src/styles/components.theme.test.ts` near other desktop tool-surface checks:

```ts
  it("keeps the workspace search panel on compact editor-like chrome", () => {
    const controls = getLastRuleBlock(".workspace-search-panel__controls");
    const input = getLastRuleBlock(".workspace-search-panel__input");
    const summary = getLastRuleBlock(".workspace-search-panel__summary");
    const groupToggle = getLastRuleBlock(".workspace-search-panel__group-toggle");
    const groupCopy = getLastRuleBlock(".workspace-search-panel__group-copy");
    const groupPath = getLastRuleBlock(".workspace-search-panel__group-path");
    const matches = getLastRuleBlock(".workspace-search-panel__matches");
    const match = getLastRuleBlock(".workspace-search-panel__match");
    const line = getLastRuleBlock(".workspace-search-panel__line");

    expect(controls).toContain("gap: 4px");
    expect(input).toContain("min-height: 28px");
    expect(input).toContain("border-radius: 2px");
    expect(groupToggle).toContain("grid-template-columns: 16px minmax(0, 1fr) auto");
    expect(groupCopy).toContain("gap: 2px");
    expect(groupPath).toContain("color: var(--text-tertiary)");
    expect(matches).toContain("gap: 0");
    expect(match).toContain("grid-template-columns: 34px minmax(0, 1fr)");
    expect(match).toContain("border-radius: 0");
    expect(line).toContain("text-align: right");
  });
```

- [ ] **Step 2: Run the theme test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because the `workspace-search-panel*` selectors do not yet exist in `components.css`

- [ ] **Step 3: Add the search-panel selectors and compact rules**

Add a dedicated search-panel block to `packages/web/src/styles/components.css` near the workspace sidebar rules:

```css
.workspace-search-panel {
  min-height: 0;
}

.workspace-search-panel__controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 10px;
}

.workspace-search-panel__input {
  min-height: 28px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--bg-page) 88%, var(--bg-surface) 12%);
  color: var(--text-primary);
}

.workspace-search-panel__summary,
.workspace-search-panel__truncate-note,
.workspace-search-panel__state {
  color: var(--text-tertiary);
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.workspace-search-panel__results {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
  padding: 0 8px 8px;
}

.workspace-search-panel__group {
  border-top: 1px solid color-mix(in srgb, var(--border) 54%, transparent);
}

.workspace-search-panel__group-toggle {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding: 8px 4px 6px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
}

.workspace-search-panel__group-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.workspace-search-panel__group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.workspace-search-panel__group-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--type-body-5-size);
}

.workspace-search-panel__matches {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.workspace-search-panel__match {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  padding: 4px 4px 4px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.workspace-search-panel__line {
  color: var(--text-quaternary);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Run the search and theme tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS
- Theme test now finds the new selectors and compact grid rules

- [ ] **Step 5: Commit the search chrome**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "style(workspace): tighten search sidebar chrome"
```

---

### Task 3: Convert Quick Open To A Two-Line File List

**Files:**
- Modify: `packages/web/src/features/quick-open/components/quick-open.test.tsx`
- Modify: `packages/web/src/features/quick-open/components/quick-open.tsx`

- [ ] **Step 1: Write the failing quick-open structure tests**

Extend `packages/web/src/features/quick-open/components/quick-open.test.tsx` with these cases:

```tsx
  it("renders each result as a two-line file row", async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const row = screen.getByRole("button", { name: /app\.tsx.*src\/app\.tsx/i });

    expect(row.querySelector(".quick-open__item-copy")).toBeTruthy();
    expect(row.querySelector(".quick-open__item-title")).toHaveTextContent("app.tsx");
    expect(row.querySelector(".quick-open__item-path")).toHaveTextContent("src/app.tsx");
  });

  it("moves the active quick-open row with arrow keys", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        { path: "src/app.tsx", name: "app.tsx", kind: "file" },
        { path: "src/view-state.ts", name: "view-state.ts", kind: "file" },
      ],
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

    const input = screen.getByRole("textbox", { name: /Go to File|跳转到文件/i });

    fireEvent.change(input, {
      target: { value: "t" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const firstRow = screen.getByRole("button", { name: /app\.tsx.*src\/app\.tsx/i });
    const secondRow = screen.getByRole("button", {
      name: /view-state\.ts.*src\/view-state\.ts/i,
    });

    expect(firstRow).toHaveClass("quick-open__item--active");
    expect(secondRow).not.toHaveClass("quick-open__item--active");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(secondRow).toHaveClass("quick-open__item--active");
  });
```

- [ ] **Step 2: Run the quick-open tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/quick-open/components/quick-open.test.tsx
```

Expected:
- FAIL because the row still renders flat `quick-open__name` and `quick-open__path` spans
- FAIL because the new structural selectors do not exist yet

- [ ] **Step 3: Replace the flat row markup with a two-line hierarchy**

Update `packages/web/src/features/quick-open/components/quick-open.tsx` so rows keep the same click and keyboard behavior but expose clearer hierarchy hooks:

```tsx
{results.map((file, index) => (
  <button
    key={file.path}
    type="button"
    className={`quick-open__item${
      index === selectedIndex ? " quick-open__item--active" : ""
    }`}
    onMouseEnter={() => setSelectedIndex(index)}
    onClick={() => {
      if (!workspaceId) {
        return;
      }

      void openLocation({
        workspaceId,
        path: file.path,
        source: "manual",
      });
      setOpen(false);
    }}
  >
    <span className="quick-open__item-copy">
      <span className="quick-open__item-title">{file.name}</span>
      <span className="quick-open__item-path">{file.path}</span>
    </span>
  </button>
))}
```

Remove the old flat selectors:

```diff
-<span className="quick-open__name">{file.name}</span>
-<span className="quick-open__path">{file.path}</span>
```

- [ ] **Step 4: Run the quick-open tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/quick-open/components/quick-open.test.tsx
```

Expected:
- PASS
- existing Enter-to-open behavior still passes

- [ ] **Step 5: Commit the quick-open row structure**

```bash
git add \
  packages/web/src/features/quick-open/components/quick-open.tsx \
  packages/web/src/features/quick-open/components/quick-open.test.tsx
git commit -m "feat(quick-open): add dual-line file rows"
```

---

### Task 4: Add Quick Open Chrome And Final Verification

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing quick-open theme assertions**

Add this case to `packages/web/src/styles/components.theme.test.ts` near the existing command-palette desktop chrome assertions:

```ts
  it("keeps quick open on compact file-switcher chrome", () => {
    const quickOpen = getLastRuleBlock(".quick-open");
    const quickOpenSearch = getLastRuleBlock(".quick-open__search");
    const quickOpenItem = getLastRuleBlock(".quick-open__item");
    const quickOpenItemCopy = getLastRuleBlock(".quick-open__item-copy");
    const quickOpenItemTitle = getLastRuleBlock(".quick-open__item-title");
    const quickOpenItemPath = getLastRuleBlock(".quick-open__item-path");

    expect(quickOpen).toContain("max-width: var(--desktop-modal-max-width-md)");
    expect(quickOpenSearch).toContain("min-height: 38px");
    expect(quickOpenItem).toContain("padding: 6px 12px");
    expect(quickOpenItemCopy).toContain("gap: 2px");
    expect(quickOpenItemTitle).toContain("color: var(--text-primary)");
    expect(quickOpenItemPath).toContain("color: var(--text-tertiary)");
  });
```

- [ ] **Step 2: Run the quick-open and theme tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/quick-open/components/quick-open.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because the new `quick-open__item-copy`, `__item-title`, and `__item-path` rules are not in CSS yet

- [ ] **Step 3: Add the quick-open selectors and compact overlay rules**

Add the `quick-open*` rules to `packages/web/src/styles/components.css` near other desktop overlay rules:

```css
.quick-open {
  width: min(100%, var(--desktop-modal-max-width-md));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-panel) 98%, var(--bg-page) 2%);
  box-shadow: var(--shadow-lg);
}

.quick-open__search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
}

.quick-open__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
}

.quick-open__list {
  display: flex;
  flex-direction: column;
  padding: 6px 0;
}

.quick-open__item {
  display: flex;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
}

.quick-open__item-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.quick-open__item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--type-body-3-size);
}

.quick-open__item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--type-body-5-size);
}
```

Keep the existing `quick-open__item--active` class, but ensure it uses a single background fill rather than card-like decoration.

- [ ] **Step 4: Run the final focused verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/search-panel.test.tsx \
  src/features/quick-open/components/quick-open.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS
- search groups stay collapsible and reset to expanded per query
- quick-open rows expose the two-line hierarchy selectors
- theme assertions confirm both surfaces use compact editor-like chrome

- [ ] **Step 5: Commit the quick-open chrome**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "style(quick-open): match vscode file switcher chrome"
```
