# Workspace Panel Editor Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the desktop and mobile `Explorer`, `Search`, and `Source Control` workspace panels into one compact, editor-like visual system with small-radius controls, shared spacing, and block-style selected states that no longer rely on left accent bars.

**Architecture:** Keep the current workbench information architecture and component boundaries, then pull the three panels onto one shared sidebar grammar: common compact controls, common row states, common section headers, and common token-driven selected/focus behavior. Implement the visual contract in `components.theme.test.ts` first, add lightweight shared row/control hooks where the markup needs them, then converge `Explorer`, `Search`, `Git`, and `mobile-files-sheet` without introducing a parallel mobile design language.

**Tech Stack:** React 19, TypeScript, Jotai, Vitest, Testing Library, vanilla CSS custom properties in `packages/web/src/styles/components.css`

**Spec reference:** `docs/superpowers/specs/2026-05-26-workspace-panel-editor-unification-design.md`

**Git hygiene:** The worktree may already contain unrelated user changes. Read files before patching them, stage only the files listed in each task, and never revert unrelated edits.

---

## File Structure

**Modified files:**
- `packages/web/src/styles/components.theme.test.ts`
  - Lock the approved style contract: shared compact controls, shared selected blocks, no left selection bar, shared mobile/desktop token usage.
- `packages/web/src/styles/components.css`
  - Add shared workbench primitives for sidebar controls and rows, then restyle `Explorer`, `Search`, `Git`, and mobile files surfaces to consume them.
- `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
  - Add shared row class hooks to open-editor items.
- `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx`
  - Add shared control/row hooks so quick jump matches Explorer/Search grammar on mobile.
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
  - Add shared row class hooks to tree rows and search-result rows without changing file-tree behavior.
- `packages/web/src/features/workspace/views/shared/search-panel.tsx`
  - Track the currently selected search match and expose a persistent block-selected state in addition to hover/focus.
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
  - Add shared row hooks to worktree rows, diff rows, and history rows so Git consumes the same panel language.
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
  - Keep file tree structure and search-mode behavior stable while row hooks and selected-state styling change.
- `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
  - Add regression coverage for persistent selected search rows and query-reset behavior.
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
  - Keep active diff-row behavior and Git panel structure stable while styles and row hooks change.
- `packages/web/src/features/workspace/views/shared/explorer-panel.test.tsx`
  - Preserve the Explorer header/action split while shared row/control classes are added below it.
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
  - Preserve Quick Jump / Open Editors / Workspace ordering and hidden embedded file search on mobile.
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
  - Preserve three-tab switching and detail-surface behavior while the panel system is visually unified.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx src/features/workspace/views/shared/explorer-panel.test.tsx src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/workspace/views/shared/file-tree-panel.test.tsx src/features/workspace/views/shared/search-panel.test.tsx src/features/workspace/views/shared/git-panel.test.tsx src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`

---

### Task 1: Lock The Shared Workbench Style Contract In Theme Tests

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Rewrite the theme assertions around the approved selected-state and compact-control contract**

Update the existing workspace sidebar assertions in `packages/web/src/styles/components.theme.test.ts` so they reflect the approved visual direction.

Replace the desktop file-tree selected-row expectations with this contract:

```ts
    expect(rowSelected).not.toContain("border-left:");
    expect(rowSelected).not.toContain("padding-left: calc(");
    expect(rowSelected).toContain("border: 1px solid var(--state-selected-border)");
    expect(rowSelected).toContain("background: var(--state-selected-bg)");
    expect(rowSelected).toContain("color: var(--text-primary)");
```

Tighten the shared compact-control assertions for Explorer / Search / Quick Jump / Git:

```ts
    expect(search).toContain("border-radius: var(--radius-md)");
    expect(searchInput).toContain("border-radius: var(--radius-md)");
    expect(searchInput).not.toContain("border-radius: 4px");
    expect(quickOpenSearch).toContain("border-radius: var(--radius-md)");
    expect(gitCommitBlock).toContain("gap: var(--sp-2)");
```

Extend the Search assertions to cover the persistent selected row:

```ts
    const searchMatchActive = getLastRuleBlock(".workspace-search-panel__match--active");

    expect(searchMatch).toContain("border-radius: var(--radius-md)");
    expect(searchMatch).toContain("border: 1px solid transparent");
    expect(searchMatchActive).toContain("border-color: var(--state-selected-border)");
    expect(searchMatchActive).toContain("background: var(--state-selected-bg)");
```

Extend the Git assertions to cover the unified row-selection language:

```ts
    const gitRowActive = getLastRuleBlock(".git-panel .git-row.active");
    const gitHistoryRowCurrent = getLastRuleBlock(".git-history-row.current");

    expect(gitRowActive).not.toContain("::before");
    expect(gitRowActive).toContain("border-color: var(--state-selected-border)");
    expect(gitRowActive).toContain("background: var(--state-selected-bg)");
    expect(gitHistoryRowCurrent).toContain("border-color: var(--state-selected-border)");
    expect(gitHistoryRowCurrent).toContain("background: var(--state-selected-bg)");
```

Replace the mobile file-row selected assertion with the same block-selected contract:

```ts
    expect(mobileFileRow).toContain("border-radius: var(--radius-md)");
    expect(mobileFileRowSelected).not.toContain("border-left:");
    expect(mobileFileRowSelected).toContain("border: 1px solid var(--state-selected-border)");
    expect(mobileFileRowSelected).toContain("background: var(--state-selected-bg)");
```

- [ ] **Step 2: Run the style test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- FAIL because `file-tree-shell .tree-item.selected` still uses `border-left`
- FAIL because Git diff rows still use `::before`
- FAIL because Search has no persistent selected-row class
- FAIL because several controls still use panel-sized or ad hoc radii instead of the shared compact token

- [ ] **Step 3: Commit nothing yet**

Do not stage or commit after the red run. The next tasks make the test contract pass.

---

### Task 2: Add Shared Sidebar Control And Row Primitives

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add the shared control and row primitives to `components.css`**

Insert a shared workbench primitive block near the existing `.workspace-sidebar-panel` rules in `packages/web/src/styles/components.css`:

```css
.workspace-sidebar-control {
  border: 1px solid var(--component-mix-border-default-84pct-transparent);
  border-radius: var(--radius-md);
  background: var(--component-mix-surface-panel-92pct-surface-page);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.workspace-sidebar-control:focus-within {
  border-color: var(--component-mix-border-focus-64pct-transparent);
  box-shadow: inset 0 0 0 var(--state-focus-ring-width)
    var(--component-mix-border-focus-64pct-transparent);
}

.workspace-sidebar-row {
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);
}

.workspace-sidebar-row:hover {
  background: var(--surface-hover);
}

.workspace-sidebar-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 var(--state-focus-ring-width)
    var(--component-mix-border-focus-64pct-transparent);
}

.workspace-sidebar-row--selected {
  border-color: var(--state-selected-border);
  background: var(--state-selected-bg);
  color: var(--text-primary);
}
```

- [ ] **Step 2: Replace the old one-off row and control chrome with the shared primitives**

Update the existing selector bodies in `packages/web/src/styles/components.css` so they stop fighting the shared primitive block:

```css
.workspace-open-editors__item {
  min-height: 28px;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-md);
}

.workspace-quick-jump__search,
.file-tree-shell .file-tree-search,
.file-tree-shell .file-tree-search--desktop,
.workspace-search-panel__input,
.git-panel .git-commit-input {
  border-radius: var(--radius-md);
}

.file-tree-shell .tree-item.selected {
  border: 1px solid var(--state-selected-border);
  background: var(--state-selected-bg);
  color: var(--text-primary);
}

.git-panel .git-row.active {
  border-color: var(--state-selected-border);
  background: var(--state-selected-bg);
}
```

Delete the old left-accent implementation entirely:

```css
.git-panel .git-row.active::before {
  content: none;
}
```

- [ ] **Step 3: Re-run the theme test to verify the shared primitive layer is taking effect**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- PASS for the shared row/control assertions added in Task 1
- PASS for the existing workspace surface assertions

- [ ] **Step 4: Commit the shared primitive layer**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "refactor(web): add shared workspace panel primitives"
```

---

### Task 3: Converge Explorer Rows, Sections, And Compact Controls

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/explorer-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/explorer-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`

- [ ] **Step 1: Add focused Explorer regressions before tightening the styling**

Add this regression to `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`:

```tsx
  it("keeps the shared row hook on selected desktop tree items without restoring the embedded search field", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }],
        ],
      ])
    );
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" showSearch={false} />
      </Provider>
    );

    const row = screen.getByText("app.tsx").closest(".tree-item") as HTMLElement;

    expect(row).toHaveClass("workspace-sidebar-row", "workspace-sidebar-row--selected");
    expect(screen.queryByLabelText("action.search_files")).toBeNull();
  });
```

Add this regression to `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`:

```tsx
    expect(
      screen.getByPlaceholderText(/Type a filename or path|输入文件名或路径/i).closest("label")
    ).toHaveClass("workspace-sidebar-control");
```

- [ ] **Step 2: Run the Explorer-focused tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/explorer-panel.test.tsx \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx
```

Expected:
- FAIL because the new shared-row assertions are not implemented yet
- PASS for the unchanged Explorer header/action split

- [ ] **Step 3: Add the Explorer markup hooks and tighten Explorer spacing around the shared primitives**

In `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`, move open-editor items onto the shared row contract:

```tsx
              <button
                type="button"
                className={`workspace-open-editors__item workspace-sidebar-row ${
                  activeFilePath === path
                    ? "workspace-open-editors__item--active workspace-sidebar-row--selected"
                    : ""
                }`}
```

In `packages/web/src/features/workspace/views/shared/quick-jump-section.tsx`, add shared control and row hooks:

```tsx
      <label
        className="workspace-quick-jump__search workspace-sidebar-control"
        htmlFor={`quick-jump-${workspaceId}`}
      >
```

```tsx
                className="workspace-quick-jump__item workspace-sidebar-row"
```

In `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`, attach the shared row hook to both tree nodes and search-result rows:

```tsx
      className={`tree-item workspace-sidebar-row tree-item--file ${
        selectedPath === node.path ? "selected workspace-sidebar-row--selected" : ""
      } ${isContextTarget ? "tree-item--context-target" : ""}`}
```

```tsx
        className={`tree-item workspace-sidebar-row tree-item--${node.kind} ${
          selectedPath === node.path ? "selected workspace-sidebar-row--selected" : ""
        } ${contextTargetPath === node.path ? "tree-item--context-target" : ""}`}
```

In `packages/web/src/styles/components.css`, make Explorer consume the shared compact system instead of its previous looser chrome:

```css
.workspace-sidebar-section {
  padding: var(--sp-2) var(--sp-3) 0;
}

.workspace-sidebar-section__header,
.workspace-open-editors__header {
  min-height: 24px;
  margin-bottom: var(--sp-1);
}

.workspace-sidebar-panel .panel-toolbar-btn {
  width: 22px;
  height: 22px;
  border-radius: var(--radius-sm);
}

.file-tree-shell .file-tree-search,
.workspace-quick-jump__search {
  min-height: 32px;
  border-radius: var(--radius-md);
}

.file-tree-shell .tree-item {
  min-height: 26px;
  margin: 0 var(--gap-tight);
  padding: 3px var(--inset-control-block) 3px var(--inset-row-inline);
  border-radius: var(--radius-md);
}
```

- [ ] **Step 4: Re-run the Explorer-focused tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/explorer-panel.test.tsx \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx
```

Expected:
- PASS for the new shared-row and shared-control regressions
- PASS for existing Explorer behavior

- [ ] **Step 5: Commit the Explorer convergence**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/features/workspace/views/shared/open-editors-section.tsx \
  packages/web/src/features/workspace/views/shared/quick-jump-section.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/explorer-panel.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx
git commit -m "feat(web): unify explorer panel chrome"
```

---

### Task 4: Add Persistent Search Selection And Align Search Styling

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`

- [ ] **Step 1: Add failing tests for the selected search-result row behavior**

Add this test to `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`:

```tsx
  it("keeps the clicked search match selected until the query changes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 2,
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
            {
              line: 21,
              column: 3,
              endColumn: 9,
              preview: "startNeedle(worker);",
              previewColumnStart: 6,
              previewColumnEnd: 12,
            },
          ],
        },
      ],
      totalMatchCount: 2,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const firstMatch = screen.getByRole("button", { name: /12.*needle/i });
    const secondMatch = screen.getByRole("button", { name: /21.*Needle/i });

    fireEvent.click(firstMatch);

    expect(firstMatch).toHaveClass("workspace-search-panel__match--active");
    expect(firstMatch).toHaveAttribute("aria-current", "true");
    expect(secondMatch).not.toHaveClass("workspace-search-panel__match--active");

    await searchFor("thread");

    expect(screen.queryByRole("button", { name: /12.*needle/i })).toBeNull();
  });
```

Add this reset regression beside it:

```tsx
  it("clears the selected match when the query is emptied", async () => {
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

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const match = screen.getByRole("button", { name: /12.*needle/i });
    fireEvent.click(match);
    expect(match).toHaveAttribute("aria-current", "true");

    await searchFor("");

    expect(screen.queryByRole("button", { name: /12.*needle/i })).toBeNull();
  });
```

- [ ] **Step 2: Run the Search panel test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- FAIL because Search rows do not store a selected match key
- FAIL because rows never receive `workspace-search-panel__match--active` or `aria-current`

- [ ] **Step 3: Implement the selected-match state and row styling**

In `packages/web/src/features/workspace/views/shared/search-panel.tsx`, extend the panel state:

```ts
  selectedMatchKey: string | null;
```

Initialize and clear it whenever the query is reset or a fresh result set is loaded:

```ts
    selectedMatchKey: null,
```

```ts
              selectedMatchKey: null,
```

```ts
            selectedMatchKey: null,
```

Inside the match map, compute the row key and mark the active row:

```tsx
                      const matchKey = `${file.path}:${match.line}:${match.column}:${match.endColumn}`;
                      const selected = state.selectedMatchKey === matchKey;

                      return (
                        <button
                          key={matchKey}
                          type="button"
                          className={`workspace-search-panel__match workspace-sidebar-row ${
                            selected
                              ? "workspace-search-panel__match--active workspace-sidebar-row--selected"
                              : ""
                          }`}
                          aria-current={selected ? "true" : undefined}
                          onClick={() => {
                            setState((current) => ({
                              ...current,
                              selectedMatchKey: matchKey,
                            }));
                            openMatch(file.path, match.line, match.column, match.endColumn);
                          }}
                        >
```

In `packages/web/src/styles/components.css`, align the Search control and selected row styling with the shared primitives:

```css
.workspace-search-panel__input {
  border-radius: var(--radius-md);
}

.workspace-search-panel__group-header,
.workspace-search-panel__match {
  border: 1px solid transparent;
  border-radius: var(--radius-md);
}

.workspace-search-panel__match--active {
  border-color: var(--state-selected-border);
  background: var(--state-selected-bg);
}
```

- [ ] **Step 4: Re-run the Search panel test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/search-panel.test.tsx
```

Expected:
- PASS for the selected-row regressions
- PASS for existing debounce, retry, and open-location behavior

- [ ] **Step 5: Commit the Search convergence**

```bash
git add \
  packages/web/src/features/workspace/views/shared/search-panel.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.test.tsx \
  packages/web/src/styles/components.css
git commit -m "feat(web): unify workspace search panel selection"
```

---

### Task 5: Align Git Sections, Rows, And History With The Same Panel Grammar

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

- [ ] **Step 1: Add focused Git regressions around the unified selected-state contract**

Add this test to `packages/web/src/features/workspace/views/shared/git-panel.test.tsx` after the active-row coverage:

```tsx
  it("marks the selected change row with the shared row hook instead of a left accent pseudo-element", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
      if (op === "git.status") {
        return status;
      }

      if (op === "git.branches") {
        return {
          current: "feature/ai-agent",
          branches: [],
        };
      }

      if (op === "git.diff") {
        return {
          diff: `diff --git a/src/auth/AuthGate.tsx b/src/auth/AuthGate.tsx\n${JSON.stringify(args)}`,
        };
      }

      if (op === "git.log") {
        return { entries: historyEntries };
      }

      if (op === "worktree.list") {
        return { worktrees };
      }

      return {};
    });

    const store = createStore();
    store.set(localeAtom, "en");
    store.set(wsClientAtom, { sendCommand } as never);
    seedWorkspaceStore(store);

    render(
      <Provider store={store}>
        <GitPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByText("AuthGate.tsx"));

    await waitFor(() => {
      const row = document.querySelector(".git-row.active") as HTMLElement;
      expect(row).toBeTruthy();
      expect(row).toHaveClass("workspace-sidebar-row", "workspace-sidebar-row--selected");
    });
  });
```

- [ ] **Step 2: Run the Git panel test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx
```

Expected:
- FAIL because selected Git rows do not yet carry the shared selected-row class

- [ ] **Step 3: Add the Git markup hooks and tighten Git chrome to match the compact workbench system**

In `packages/web/src/features/workspace/views/shared/git-panel.tsx`, put Git rows onto the shared row contract:

```tsx
      <div
        className={`git-row workspace-sidebar-row ${
          selected ? "active workspace-sidebar-row--selected" : ""
        } ${mobile ? "mobile" : ""}`}
```

```tsx
                        <button
                          type="button"
                          className={`git-worktree-row__main workspace-sidebar-row ${
                            isCurrent ? "workspace-sidebar-row--selected" : ""
                          }`}
```

```tsx
      className={`git-history-row workspace-sidebar-row ${
        isCurrent ? "current workspace-sidebar-row--selected" : ""
      }`}
```

In `packages/web/src/styles/components.css`, update the Git section and row styling:

```css
.git-panel-scroll {
  gap: var(--sp-3);
  padding: 0 var(--sp-3) var(--sp-3);
}

.git-commit-block {
  gap: var(--sp-2);
}

.git-panel .git-commit-input {
  min-height: 78px;
  border-radius: var(--radius-md);
}

.git-commit-primary {
  min-height: 28px;
  border-radius: var(--radius-sm);
}

.git-worktree-row__main,
.git-panel .git-row,
.git-history-row {
  border: 1px solid transparent;
  border-radius: var(--radius-md);
}

.git-worktree-row.active .git-worktree-row__main,
.git-panel .git-row.active,
.git-history-row.current {
  border-color: var(--state-selected-border);
  background: var(--state-selected-bg);
}
```

Delete the old pseudo-element selector entirely from `components.css`:

```css
.git-panel .git-row.active::before {
  content: none;
}
```

- [ ] **Step 4: Re-run the Git panel test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx
```

Expected:
- PASS for the shared-row regression
- PASS for existing Git diff-preview, history, and worktree behaviors

- [ ] **Step 5: Commit the Git convergence**

```bash
git add \
  packages/web/src/features/workspace/views/shared/git-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.test.tsx \
  packages/web/src/styles/components.css
git commit -m "feat(web): unify git panel workbench chrome"
```

---

### Task 6: Map The Same Visual System To Mobile Files Panels

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add a mobile regression for the unified small-radius panel language**

Add this assertion to `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` inside the root-sheet test:

```tsx
    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveClass(
      "mobile-files-sheet__segment",
      "active"
    );
    expect(document.querySelector(".mobile-files-sheet__content")).toBeTruthy();
```

This keeps the mobile structure stable while the styling moves to the shared workbench language.

- [ ] **Step 2: Run the mobile files and theme tests as a guard**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL only on the theme assertions from Task 1 if any mobile selected-state rules still use the old left-accent contract
- PASS for the structural mobile files sheet test

- [ ] **Step 3: Apply the shared workbench system to the mobile files surface without softening it**

Update the mobile-specific blocks in `packages/web/src/styles/components.css`:

```css
.mobile-files-sheet__segment {
  min-width: 32px;
  min-height: 32px;
  border-radius: 0;
}

.mobile-sheet--files .file-tree-shell--mobile,
.mobile-sheet--files .git-panel--mobile,
.mobile-sheet--files .workspace-search-panel--mobile {
  border: 1px solid var(--component-mix-border-default-80pct-transparent);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  box-shadow: none;
}

.mobile-sheet--files .file-tree-shell--mobile .file-tree-search {
  min-height: 36px;
  border-radius: var(--radius-md);
}

.mobile-sheet--files .file-tree-shell--mobile .tree-item {
  min-height: 40px;
  border-radius: var(--radius-md);
}

.mobile-sheet--files .file-tree-shell--mobile .tree-item.selected {
  border: 1px solid var(--state-selected-border);
  background: var(--state-selected-bg);
}

.git-panel--mobile .git-worktree-row,
.git-panel--mobile .git-worktree-row__main,
.git-panel--mobile .git-row,
.git-panel--mobile .git-history-row {
  min-height: 40px;
  border-radius: var(--radius-md);
}
```

Do not add a separate rounded-card mobile shell. The goal is the desktop workbench language with larger touch targets only.

- [ ] **Step 4: Re-run the mobile files and theme tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS for the mobile selected-row and shared-radius assertions
- PASS for the unchanged mobile files sheet behavior

- [ ] **Step 5: Commit the mobile mapping**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
git commit -m "feat(web): map workspace panel system to mobile files"
```

---

### Task 7: Run The Targeted Verification Suite And Final Cleanup

**Files:**
- Modify: none expected
- Test: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`

- [ ] **Step 1: Run the full targeted verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/search-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
```

Expected:
- PASS across all targeted tests
- No regressions in file opening, Git preview, or mobile tab switching

- [ ] **Step 2: Stage and commit the final verification pass**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/features/workspace/views/shared/file-tree-panel.tsx \
  packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/open-editors-section.tsx \
  packages/web/src/features/workspace/views/shared/quick-jump-section.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.tsx \
  packages/web/src/features/workspace/views/shared/search-panel.test.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
git commit -m "feat(web): unify workspace panels into editor workbench chrome"
```
