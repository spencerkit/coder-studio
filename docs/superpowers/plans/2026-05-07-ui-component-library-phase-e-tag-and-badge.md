# UI Component Library Phase E Tag + Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `Tag` and `Badge` as the next shared label/count primitives, migrate a small set of real callers, and keep compatibility intact.

**Architecture:** Follow the same parity-first slice pattern as the previous UI component phases. Each component lives in its own folder under `packages/web/src/components/ui/`, uses CSS Modules plus temporary compatibility classes, and is exported from the public barrel. Keep this slice limited to session labels, selector labels, and topbar unread count.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing `tokens.css`, existing global `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-07-ui-component-library-tag-badge-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/tag/index.tsx`
- `packages/web/src/components/ui/tag/index.module.css`
- `packages/web/src/components/ui/tag/index.test.tsx`
- `packages/web/src/components/ui/tag/README.md`
- `packages/web/src/components/ui/badge/index.tsx`
- `packages/web/src/components/ui/badge/index.module.css`
- `packages/web/src/components/ui/badge/index.test.tsx`
- `packages/web/src/components/ui/badge/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx`
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.test.tsx`
- `packages/web/src/features/topbar/components/tab.tsx`
- `packages/web/src/features/topbar/components/tab.test.tsx`

**No changes in this plan:**
- `packages/web/src/styles/components.css`
- `agent-badge`
- `supervisor-state-tag`
- `git-row-status-*`
- `mobile-supervisor-badge`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the current tag/count caller counts**

Baseline targets in this slice:

- `.badge .badge-*`
- `branch-quick-pick-badge`
- `mobile-select-sheet__item-badge`
- `topbar-unread`

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/workspace/views/shared/branch-quick-pick.test.tsx \
  src/features/mobile-select/components/mobile-select-sheet.test.tsx \
  src/features/topbar/components/tab.test.tsx
```

Expected: all tests pass.

## Task 2: Implement `Tag`

**Files:**
- Create: `packages/web/src/components/ui/tag/*`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx`
- Modify: `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- Modify: `packages/web/src/features/mobile-select/components/mobile-select-sheet.test.tsx`

- [ ] **Step 1: Write failing `Tag` tests**

Cover:

```tsx
render(<Tag>Idle</Tag>);
render(<Tag color="green">Running</Tag>);
render(<Tag size="sm">Draft</Tag>);
render(<Tag caps={false}>Remote</Tag>);
render(<Tag color="blue" className="session-provider-badge">Codex</Tag>);
```

- [ ] **Step 2: Implement `Tag`**

Requirements:

- span-based component
- `color`, `size`, `caps`
- legacy classes include `badge` and `badge-*`
- custom classes survive so feature-level overrides still apply

- [ ] **Step 3: Migrate selected tag callers**

Change:

- session provider/state labels to `<Tag />`
- draft launcher `DRAFT` label to `<Tag />`
- branch quick pick remote badge to `<Tag caps={false} />`
- mobile select item badge to `<Tag caps={false} />`

- [ ] **Step 4: Update focused tests**

Assertions should confirm:

- session card still renders provider/state labels
- branch quick pick still shows `Remote`
- mobile select still shows item badges without forcing all-caps

## Task 3: Implement `Badge`

**Files:**
- Create: `packages/web/src/components/ui/badge/*`
- Modify: `packages/web/src/features/topbar/components/tab.tsx`
- Modify: `packages/web/src/features/topbar/components/tab.test.tsx`

- [ ] **Step 1: Write failing `Badge` tests**

Cover:

```tsx
render(<Badge count={3} />);
render(<Badge count={0} />);
render(<Badge count={12} max={9} />);
render(<Badge count={4} className="topbar-unread" />);
```

- [ ] **Step 2: Implement `Badge`**

Requirements:

- count-based component
- `count <= 0` returns `null`
- `max` truncation support
- compact rounded pill layout

- [ ] **Step 3: Migrate selected badge caller**

Change:

- workspace topbar unread count to `<Badge count={workspace.unreadCount} max={9} />`

- [ ] **Step 4: Update focused tests**

Assertions should confirm:

- unread count renders when present
- `9+` truncation still works
- clicking the tab and close button still behaves the same

## Task 4: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export both components from the public barrel**

- [ ] **Step 2: Update the UI library README**

Mark `Tag` and `Badge` as implemented.

- [ ] **Step 3: Update migration inventory**

After this phase:

- `Tag` should reflect only real remaining `.badge`-family callers outside this slice
- `Badge` should reflect remaining count badge callers, if any

- [ ] **Step 4: Run the targeted test set**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tag/index.test.tsx \
  src/components/ui/badge/index.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/workspace/views/shared/branch-quick-pick.test.tsx \
  src/features/mobile-select/components/mobile-select-sheet.test.tsx \
  src/features/topbar/components/tab.test.tsx
```

- [ ] **Step 5: Run targeted formatting/lint verification**

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/tag \
  src/components/ui/badge \
  src/features/agent-panes/views/shared/session-card.tsx \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/agent-panes/views/shared/draft-launcher.tsx \
  src/features/workspace/views/shared/branch-quick-pick.tsx \
  src/features/workspace/views/shared/branch-quick-pick.test.tsx \
  src/features/mobile-select/components/mobile-select-sheet.tsx \
  src/features/mobile-select/components/mobile-select-sheet.test.tsx \
  src/features/topbar/components/tab.tsx \
  src/features/topbar/components/tab.test.tsx \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md
```

Expected: no new errors.
