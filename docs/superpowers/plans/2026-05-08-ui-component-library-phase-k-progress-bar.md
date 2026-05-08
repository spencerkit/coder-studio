# UI Component Library Phase K ProgressBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `ProgressBar` component in `components/ui` and migrate the bounded session-card progress strip to it without changing the existing session-state mapping or legacy class compatibility.

**Architecture:** Implement `ProgressBar` as a presentational primitive under `packages/web/src/components/ui/progress-bar/` with value/max and tone variants, plus an optional indeterminate mode reserved for future callers. Keep progress calculation and session-state-to-tone mapping in feature code. The shared primitive only owns layout, ARIA progress semantics, tone styling, and the legacy `session-progress*` compatibility classes needed by the migrated caller.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing app tokens.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/progress-bar/index.tsx`
- `packages/web/src/components/ui/progress-bar/index.module.css`
- `packages/web/src/components/ui/progress-bar/index.test.tsx`
- `packages/web/src/components/ui/progress-bar/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/supervisor/*`
- `packages/web/src/features/notifications/*`
- any queue/progress data plumbing
- any tooltip/select/sheet/popover work
- removal of unrelated progress-like legacy styles such as `.agent-progress`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded progress caller inventory**

Current bounded caller in this slice:

- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`

Current non-goals:

- changing `getProgressWidth()` session-state heuristics
- reintroducing supervisor progress track UI
- migrating old `.agent-progress` patterns
- collapsing unrelated progress CSS duplicates outside the selected caller

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/agent-panes/components/session-card.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `ProgressBar`

**Files:**
- Create: `packages/web/src/components/ui/progress-bar/*`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(<ProgressBar value={42} max={100} tone="info" />);
```

and assertions for:

- root exposes `role="progressbar"` plus `aria-valuemin`, `aria-valuemax`, and `aria-valuenow` in determinate mode
- indeterminate mode omits `aria-valuenow`
- compatibility classes such as `session-progress`, `session-progress-bar`, and tone-specific legacy classes are present
- inline width style is derived from `value / max` and clamped to the valid range
- `className` still composes onto the root

- [ ] **Step 2: Implement `ProgressBar`**

Requirements:

- public API exports `ProgressBar` and relevant tone/prop types
- `ProgressBar` accepts `value`, `max`, `tone`, `indeterminate`, `className`, optional `fillClassName`, and pass-through div props
- determinate mode clamps invalid ratios into `0..100`
- indeterminate mode renders the fill without a width percentage style
- output keeps legacy compatibility classes needed by the migrated caller: `session-progress`, `session-progress-bar`, `session-progress-idle`, `session-progress-starting`, `session-progress-running`, `session-progress-complete`
- CSS module owns the generic progress track/fill styling migrated from `components.css`
- keep styling/behavior presentation-only; no session-state logic in the shared primitive

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/progress-bar/index.test.tsx
```

Expected: all shared progress-bar tests pass.

## Task 3: Migrate SessionCard

**Files:**
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
const bar = document.querySelector(".session-progress");
expect(bar).toHaveAttribute("role", "progressbar");
expect(document.querySelector(".session-progress-bar.session-progress-running")).toHaveAttribute(
  "style",
  expect.stringContaining("width: 42%")
);
```

and preserve:

- current provider/state tags
- read-only terminal behavior
- header actions
- active-session persistence
- legacy progress classes on the migrated bar

- [ ] **Step 2: Replace raw progress markup with shared primitive**

Requirements:

- import `ProgressBar` from the public UI barrel
- keep `getProgressWidth()` and session-state mapping in `session-card.tsx`
- replace the raw `session-progress` shell with the shared primitive
- preserve current DOM hooks/classes required by tests and styles

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/progress-bar/index.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx
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

- add `ProgressBar` to the UI barrel
- add `ProgressBar` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect progress-bar migration status and caller count

- [ ] **Step 2: Run the full phase-k verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/progress-bar/index.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/progress-bar \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/agent-panes/views/shared/session-card.tsx \
  src/features/agent-panes/components/session-card.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining raw session progress callers**

Run:

```bash
rg -n "session-progress|ProgressBar" packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared progress-bar primitive itself, its tests/docs, and feature code intentionally using the shared primitive.
