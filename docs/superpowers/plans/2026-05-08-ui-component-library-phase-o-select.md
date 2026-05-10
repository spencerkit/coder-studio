# UI Component Library Phase O Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Select` primitive in `components/ui` with a single public API that renders as a desktop dropdown or a mobile sheet, then migrate the bounded supervisor evaluator-provider selector family onto it.

**Architecture:** Implement `Select` under `packages/web/src/components/ui/select/` as a thin shell that resolves `forceMode` against shared `useViewport()`, then delegates to two internal renderers: a desktop dropdown listbox and a mobile sheet wrapper around the existing `MobileSelectSheet`. Keep selection state controlled in the public primitive (`value`, `onChange`, `options`) so both renderers stay behaviorally aligned. Phase O only migrates the supervisor objective dialog evaluator selector on desktop and mobile; it explicitly does not absorb richer searchable/action pickers like branch quick pick, terminal selector, or general `Popover` / `ActionMenu` / `Sheet` work.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, `clsx`, existing app tokens, existing `MobileSelectSheet`, shared `useViewport()` and dismiss helpers.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/select/index.tsx`
- `packages/web/src/components/ui/select/index.module.css`
- `packages/web/src/components/ui/select/index.test.tsx`
- `packages/web/src/components/ui/select/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- any `Popover`, `ActionMenu`, `Sheet`, or `Tooltip` work
- any searchable, creatable, multi-section, or action-item picker API beyond this bounded single-section `Select`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded `Select` caller inventory**

Current callers in scope:

- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
  - desktop evaluator selector currently uses raw `<select className="input">`
  - mobile evaluator selector currently uses a hand-rolled `.input.mobile-select-trigger` button
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
  - mobile evaluator options currently render through a direct `MobileSelectSheet`

Current non-goals:

- `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx` searchable/create flow
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx` terminal picker / selector dropdown
- `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx` richer mobile selection sheets
- any future generic popover/menu/sheet extraction

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Select`

**Files:**
- Create: `packages/web/src/components/ui/select/*`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <Select
    aria-label="Evaluator"
    options={[
      { label: "Claude", value: "claude" },
      { label: "Codex", value: "codex" },
    ]}
    value="claude"
    onChange={setValue}
  />
);
```

and assertions for:

- desktop mode renders a trigger button with `aria-haspopup="listbox"` and a popup `listbox`
- clicking the trigger opens the listbox and clicking an option calls `onChange` with the selected `value`
- keyboard behavior on desktop covers `Enter` or `Space` to open, `ArrowDown` / `ArrowUp` to move, `Enter` to commit, and `Escape` to close
- mobile mode renders the shared trigger shell and opens a sheet-backed option list with the same options
- caller-supplied legacy compatibility classes (`input`, `mobile-select-trigger`, `mobile-select-trigger__value`, `mobile-select-trigger__icon`) remain present on the rendered trigger/value/icon nodes
- invalid controlled values fall back to the first enabled option for displayed label and sheet/listbox selection semantics
- disabled options cannot be selected

- [ ] **Step 2: Implement the shared primitive**

Requirements:

- public API exports `Select` plus relevant prop types from the public barrel
- `Select` accepts controlled `value`, `onChange`, `options`, optional `placeholder`, optional `disabled`, optional `forceMode`, optional `className`, optional `valueClassName`, optional `iconClassName`, and pass-through button props including `aria-label` / `aria-describedby`
- `Select` keeps one option model shared across both renderers; options only need `label`, `value`, and optional `disabled`
- resolve renderer mode through `components/ui/_internal/use-viewport.ts`; do not use any feature-local viewport hook or fresh `matchMedia`
- desktop renderer stays self-contained inside the `Select` folder, uses shared dismiss behavior, exposes listbox semantics, and keeps touch-friendly trigger sizing via tokens
- mobile renderer reuses `MobileSelectSheet` internally instead of duplicating sheet logic in features
- CSS module owns the generic trigger/listbox shell plus legacy compatibility selectors for the bounded supervisor migration
- preserve migration safety by keeping the old global `.mobile-select-trigger*` and `select.input` compatibility blocks in `styles/components.css` only until ownership has moved into the primitive; once the primitive owns them, remove the bounded legacy block from global CSS
- do not add searchable/create/action-item APIs in this phase

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/select/index.test.tsx
```

Expected: all shared select tests pass.

## Task 3: Migrate Supervisor Evaluator Selector

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("button", { name: "Evaluator Claude" })).toHaveClass(
  "input",
  "mobile-select-trigger"
);
```

and preserve:

- desktop objective dialog still submits `evaluatorProviderId` during enable/edit flows
- desktop selector stays label-associated and keeps helper text wiring
- mobile supervisor detail still opens the evaluator picker inside the same sheet layer instead of rendering a second overlay
- mobile evaluator picker still updates the selected provider and returns to the detail flow
- the migrated trigger keeps bounded legacy compatibility classes on the trigger/value/icon nodes for zero-visual-regression coverage

- [ ] **Step 2: Replace raw selector markup with the shared primitive**

Requirements:

- import `Select` from the public UI barrel only
- keep supervisor dialog state ownership in feature code (`draftEvaluatorProviderId`, `updateDraft`, `confirm`)
- remove the `mobileEvaluatorPicker` prop branch from `ObjectiveDialogContent`; the component should render the same shared `Select` in both desktop and mobile contexts
- remove the dedicated evaluator-only `MobileSelectSheet` branch from `MobileSupervisorSheet`; the detail sheet should continue to render through one `MobileSheet`, with the shared `Select` opening its own mobile picker
- preserve the visible evaluator labels (`Claude`, `Codex`) and the existing helper copy
- keep bounded legacy compatibility classes by composing them through `Select` props instead of reintroducing raw button/select markup

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/select/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
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

- add `Select` to the UI barrel
- add `Select` to `components/ui/README.md` with its Tier 2 summary
- update `MIGRATION.md` to reflect this bounded select migration status and the remaining caller count for not-yet-migrated richer select-like families

- [ ] **Step 2: Run the full phase-o verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/select/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/select \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/supervisor/views/shared/objective-dialog-content.tsx \
  src/features/supervisor/views/shared/objective-dialog.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining bounded raw select callers**

Run:

```bash
rg -n "<select|mobile-select-trigger|MobileSelectSheet" \
  packages/web/src/features/supervisor \
  packages/web/src/components/ui \
  -g '!**/*.css' -g '!**/*.test.tsx'
```

Expected: remaining hits are the shared `Select` primitive itself, intentional mobile-select infrastructure, its tests/docs, and no remaining raw supervisor evaluator selector implementation.
