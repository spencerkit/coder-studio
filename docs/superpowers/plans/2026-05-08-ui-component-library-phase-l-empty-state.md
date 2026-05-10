# UI Component Library Phase L EmptyState Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `EmptyState` component in `components/ui` and migrate the bounded centered empty-state shells that currently hand-roll the same title/description/icon layout.

**Architecture:** Implement `EmptyState` as a presentational primitive under `packages/web/src/components/ui/empty-state/` with optional icon and action slots plus optional alert semantics. Keep all data loading, file-selection, terminal creation, and workspace routing logic in feature code. This phase only migrates the bounded centered shell patterns that already look like generic empty states; it does not absorb the larger workspace resolving/loading card.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing app tokens, Lucide icons.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/empty-state/index.tsx`
- `packages/web/src/components/ui/empty-state/index.module.css`
- `packages/web/src/components/ui/empty-state/index.test.tsx`
- `packages/web/src/components/ui/empty-state/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- `packages/web/src/features/settings/components/config-editor.tsx`
- `packages/web/src/features/settings/components/config-editor.test.tsx`
- `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- `packages/web/src/features/code-editor/index.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`
- `packages/web/src/features/code-editor/components/image-preview.tsx`

**No changes in this plan:**
- `packages/web/src/features/workspace/views/shared/workspace-empty-state.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-loading-state.tsx`
- `packages/web/src/features/topbar/index.tsx`
- `packages/web/src/features/mobile-select/*`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- any tab / tooltip / select / sheet / popover work

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded empty-state caller inventory**

Current bounded callers in this slice:

- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx` (`bottom-terminal-empty`)
- `packages/web/src/features/settings/components/config-editor.tsx` (`config-empty-state`)
- `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx` (`git-diff-empty`)
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx` (`git-diff-empty`)
- `packages/web/src/features/code-editor/components/image-preview.tsx` (`git-diff-empty`)

Current non-goals:

- migrating `workspace-resolving-*` shells
- migrating topbar “no workspace” inline hint
- changing file-read / terminal-create / diff-preview logic
- changing any feature copy

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/views/shared/git-diff-viewer.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `EmptyState`

**Files:**
- Create: `packages/web/src/components/ui/empty-state/*`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <EmptyState
    title="No terminals"
    description="Launch a shell to inspect files."
    icon={<Terminal size={32} />}
    action={<button type="button">Create</button>}
  />
);
```

and assertions for:

- title and optional description render with shared shell structure
- optional icon and action render in stable slots
- optional `role="alert"` or other pass-through props reach the root
- compatibility classes can be composed in by callers via `className`
- content-only callers can omit icon and/or description cleanly

- [ ] **Step 2: Implement `EmptyState`**

Requirements:

- public API exports `EmptyState` and relevant prop types
- `EmptyState` accepts `title`, optional `description`, optional `icon`, optional `action`, `className`, and pass-through div props
- shared primitive remains presentational only
- CSS module owns the generic centered empty-state layout extracted from existing caller patterns
- do not hard-code legacy feature class names inside the primitive; callers compose compatibility classes where needed

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/empty-state/index.test.tsx
```

Expected: all shared empty-state tests pass.

## Task 3: Migrate Bounded Callers

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Modify: `packages/web/src/features/settings/components/config-editor.tsx`
- Modify: `packages/web/src/features/settings/components/config-editor.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/image-preview.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(document.querySelector(".bottom-terminal-empty")).toBeTruthy();
expect(document.querySelector(".git-diff-empty")).toBeTruthy();
expect(screen.getByText("No terminals")).toBeInTheDocument();
```

and preserve:

- terminal empty-state button still uses shared `Button`
- code-editor load errors keep `role="alert"` where already present
- config-editor missing-file copy remains unchanged
- git diff and image-preview empty states keep their current titles/descriptions

- [ ] **Step 2: Replace raw empty-state markup with shared primitive**

Requirements:

- import `EmptyState` from the public UI barrel
- keep existing handlers, copy, and layout ownership in feature code
- preserve caller-specific legacy classes by composing them on the shared primitive and/or its subcontent wrappers where needed
- do not force actions or icons into callers that currently do not have them

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/empty-state/index.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/views/shared/git-diff-viewer.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected: all tests pass.

## Task 4: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Export and document the component**

Requirements:

- add `EmptyState` to the UI barrel
- add `EmptyState` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect the bounded empty-state migration status and caller count

- [ ] **Step 2: Run the full phase-l verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/empty-state/index.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/views/shared/git-diff-viewer.test.tsx \
  src/features/workspace/index.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/empty-state \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/terminal-panel/views/shared/terminal-panel.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/settings/components/config-editor.tsx \
  src/features/settings/components/config-editor.test.tsx \
  src/features/code-editor/views/shared/code-editor-host.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/views/shared/git-diff-viewer.tsx \
  src/features/workspace/views/shared/git-diff-viewer.test.tsx \
  src/features/code-editor/components/image-preview.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining raw bounded empty-state callers**

Run:

```bash
rg -n "bottom-terminal-empty|config-empty-state|git-diff-empty|EmptyState" packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared empty-state primitive itself, its tests/docs, and feature code intentionally using the shared primitive.
