# Mobile Files Content PC Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the mobile workspace files content area so its tabs, actions, search, file tree, and Git list align with the flat PC sidebar language while preserving mobile touch sizing and existing behavior.

**Architecture:** Keep the current `MobileFilesSheet`, `FileTreePanel`, and `GitPanel` structure, then tighten the mobile-only CSS scopes so the content area reuses PC sidebar semantics instead of the current floating card language. Lock the redesign in stylesheet tests first, then update the scoped mobile selectors in `components.css`, and finally rerun the targeted mobile files tests to verify behavior did not regress.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, vanilla CSS custom properties

**Spec reference:** `docs/superpowers/specs/2026-05-18-mobile-files-content-pc-alignment-design.md`

---

## File Structure

- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Replace the current mobile files surface assertions with the new flat-panel contract.
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
  - Keep the current structural assertions aligned if header wrappers or class expectations shift.
- Modify: `packages/web/src/styles/components.css`
  - Rewrite the scoped mobile files content selectors to align tabs, actions, search, file tree, and Git mobile surfaces with PC sidebar language.
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
  - Only if needed for a lightweight header wrapper that improves tab/actions alignment without changing behavior.

## Task 1: Lock The New Mobile Files Style Contract In Tests

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing mobile files content style assertions**

Update the mobile workspace home-screen style test in `packages/web/src/styles/components.theme.test.ts` so it captures the new files content language:

```ts
    const mobileFilesSurface = getLastRuleBlock(".mobile-sheet--files .file-tree-shell--mobile");
    const mobileFilesGitSurface = getLastRuleBlock(".mobile-sheet--files .git-panel--mobile");
    const mobileFilesSegmented = getLastRuleBlock(".mobile-files-sheet__segmented");
    const mobileFilesSegment = getLastRuleBlock(".mobile-files-sheet__segment");
    const mobileFilesSegmentActive = getLastRuleBlock(".mobile-files-sheet__segment.active");
    const mobileFilesSegmentIndicator = getLastRuleBlock(".mobile-files-sheet__segment.active::after");
    const mobileFilesTabAction = getLastRuleBlock(".mobile-files-sheet__tab-action");
    const mobileFileSearch = getLastRuleBlock(".file-tree-shell--mobile .file-tree-search");
    const mobileFileRow = getLastRuleBlock(".file-tree-shell--mobile .tree-item");
    const mobileFileRowSelected = getLastRuleBlock(".file-tree-shell--mobile .tree-item.selected");

    expect(mobileFilesSegmented).toContain("border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent)");
    expect(mobileFilesSegmented).toContain("border-radius: 0");
    expect(mobileFilesSegmented).not.toContain("linear-gradient(");
    expect(mobileFilesSegmented).not.toContain("box-shadow:");

    expect(mobileFilesSegment).toContain("padding: 0");
    expect(mobileFilesSegment).toContain("font-weight: var(--type-label-weight)");
    expect(mobileFilesSegmentActive).toContain("background: transparent");
    expect(mobileFilesSegmentIndicator).toContain("height: 1.5px");

    expect(mobileFilesTabAction).toContain("border: none");
    expect(mobileFilesTabAction).toContain("border-radius: 6px");
    expect(mobileFilesTabAction).toContain("background: transparent");

    expect(mobileFilesSurface).toContain("border: 1px solid color-mix(in srgb, var(--border) 80%, transparent)");
    expect(mobileFilesSurface).toContain("border-radius: var(--radius-md)");
    expect(mobileFilesSurface).not.toContain("box-shadow:");
    expect(mobileFilesSurface).not.toContain("linear-gradient(");

    expect(mobileFilesGitSurface).toContain("border: 1px solid color-mix(in srgb, var(--border) 80%, transparent)");
    expect(mobileFilesGitSurface).toContain("border-radius: var(--radius-md)");
    expect(mobileFilesGitSurface).not.toContain("box-shadow:");

    expect(mobileFileSearch).toContain("margin: 0");
    expect(mobileFileSearch).toContain("border-radius: 0");
    expect(mobileFileSearch).toContain("border-right: none");
    expect(mobileFileSearch).toContain("border-left: none");
    expect(mobileFileSearch).toContain("background: transparent");

    expect(mobileFileRow).toContain("min-height: 40px");
    expect(mobileFileRow).toContain("border-radius: 0");
    expect(mobileFileRowSelected).toContain("border-left: 2px solid color-mix(in srgb, var(--accent-blue) 88%, white 12%)");
```

- [ ] **Step 2: Run the style test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the current mobile files selectors still use rounded segmented chrome, circular actions, and floating-card surfaces

- [ ] **Step 3: Commit nothing yet**

Do not stage or commit after the red run. The next task will make the code pass.

## Task 2: Flatten The Mobile Files Header And Content Surfaces

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx` (only if layout wrapper is needed)
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Update the mobile files header styles to match the PC sidebar language**

In `packages/web/src/styles/components.css`, replace the existing `.mobile-files-sheet__segmented`, `.mobile-files-sheet__segment`, `.mobile-files-sheet__tab-actions`, and `.mobile-files-sheet__tab-action` block bodies with this contract:

```css
.mobile-files-sheet__segmented {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: var(--sp-3);
  padding: 0 0 var(--sp-2);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.mobile-files-sheet__segment {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  min-height: 32px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--type-label-size);
  line-height: var(--type-label-line-height);
  font-weight: var(--type-label-weight);
  transition: color var(--duration-fast) var(--ease-out);
}

.mobile-files-sheet__segment.active {
  background: transparent;
  color: var(--text-primary);
}

.mobile-files-sheet__segment.active::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -10px;
  left: 0;
  height: 1.5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-blue) 90%, white 10%);
}

.mobile-files-sheet__tab-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.mobile-files-sheet__tab-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}
```

- [ ] **Step 2: Update the mobile-only files surfaces to remove the floating-card shell**

In the `.mobile-sheet--files` section of `packages/web/src/styles/components.css`, rewrite the shared mobile files surface selector:

```css
  .mobile-sheet--files .file-tree-shell--mobile,
  .mobile-sheet--files .git-panel--mobile,
  .mobile-sheet--files .workspace-git-editor,
  .mobile-sheet--files .workspace-git-view {
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    border-radius: var(--radius-md);
    background: var(--bg-panel);
    box-shadow: none;
  }
```

Keep the existing exclusions for code-editor and diff wrappers unchanged.

- [ ] **Step 3: Align the mobile file-tree search and row styling with the PC sidebar**

In the `file-tree-shell--mobile` section of `packages/web/src/styles/components.css`, keep the touch-friendly height but flatten the presentation:

```css
.file-tree-shell--mobile .file-tree-search {
  margin: 0;
  border-right: none;
  border-left: none;
  border-radius: 0;
  padding-inline: 12px;
  background: transparent;
}

.file-tree-shell--mobile .file-tree {
  padding-bottom: 10px;
}

.file-tree-shell--mobile .tree-item {
  min-height: 40px;
  margin: 0;
  border-radius: 0;
  padding-top: 8px;
  padding-bottom: 8px;
}

.file-tree-shell--mobile .tree-item.selected {
  padding-left: 14px;
  border-left: 2px solid color-mix(in srgb, var(--accent-blue) 88%, white 12%);
  background: color-mix(in srgb, var(--accent-blue) 12%, transparent);
}
```

- [ ] **Step 4: Re-run the style test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the updated mobile files surface assertions
- PASS for existing unrelated theme-sensitive surface assertions

- [ ] **Step 5: Commit the style implementation**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): align mobile files content with pc sidebar"
```

## Task 3: Verify Mobile Files Behavior Did Not Regress

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` (only if needed)
- Test: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`

- [ ] **Step 1: Review the current mobile files sheet structure tests**

Open `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` and confirm whether any selectors or wrapper assumptions changed. Only edit the test if the header layout gained a new wrapper or if class assertions need to include a new structural class.

- [ ] **Step 2: If needed, add a focused regression assertion for the unchanged behavior**

If the component structure changes, keep the behavior lock tight with a focused test like this:

```tsx
  it("keeps file actions in the same header row as the tabs after the visual refresh", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: "/workspace",
      children: [],
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeTab="files" />
      </Provider>
    );

    const tabList = screen.getByRole("tablist", { name: "Files tabs" });
    const newFileButton = await screen.findByRole("button", { name: "New File" });

    expect(tabList.closest(".mobile-files-sheet__segmented")).toBe(
      newFileButton.closest(".mobile-files-sheet__segmented")
    );
  });
```

- [ ] **Step 3: Run the targeted mobile files tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
```

Expected:

- PASS for the existing structural tests
- PASS for any new regression assertion added in Step 2

- [ ] **Step 4: Commit any structural-test-only adjustments**

If `mobile-files-sheet.test.tsx` changed:

```bash
git add packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx
git commit -m "test(web): keep mobile files header behavior covered"
```

If it did not change, skip this commit.

## Task 4: Final Verification

**Files:**
- No new files
- Test: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`

- [ ] **Step 1: Run the combined verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
```

Expected:

- PASS with `0` failures
- No regressions in the mobile files content style contract or structure contract

- [ ] **Step 2: Perform a quick requirement checklist against the spec**

Confirm each item directly against the code and test coverage:

- tabs are flat and aligned with PC sidebar language
- header actions are flat icon actions, not circular floating buttons
- file and Git surfaces no longer use floating-card shadows
- file-tree search and rows keep mobile touch sizing
- editor, diff, terminal, top header, and bottom status bar selectors were not changed as part of this task

- [ ] **Step 3: Commit the verification checkpoint only if there are uncommitted plan-scope changes left**

If there are still plan-scope code changes not yet committed:

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx
git commit -m "chore(web): verify mobile files content refresh"
```

If there are no plan-scope changes left, skip this step.
