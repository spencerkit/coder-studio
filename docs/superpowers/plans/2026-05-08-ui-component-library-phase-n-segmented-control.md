# UI Component Library Phase N SegmentedControl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `SegmentedControl` primitive in `components/ui` and migrate the bounded settings selector families that currently hand-roll segmented button groups with duplicated selected-state styling.

**Architecture:** Implement `SegmentedControl` as an option-driven, controlled wrapper around the existing shared tabs semantics. It should expose a compact API for segmented selectors (`options`, `value`, `onChange`, `size`) while internally reusing the shared `Tabs`/`TabList`/`Tab` behavior for roving focus and ARIA tab semantics. This phase only migrates the bounded settings selector families: provider chooser, provider desktop detail subnav, and shortcuts category chooser. It explicitly does not replace already-migrated `Pill` usage in appearance settings, and it does not start `Select`, `Popover`, `ActionMenu`, or `Sheet`.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing app tokens.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/segmented-control/index.tsx`
- `packages/web/src/components/ui/segmented-control/index.module.css`
- `packages/web/src/components/ui/segmented-control/index.test.tsx`
- `packages/web/src/components/ui/segmented-control/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/settings/components/provider-settings.tsx`
- `packages/web/src/features/settings/components/provider-settings.test.tsx`
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/locales/zh.json`
- `packages/web/src/locales/en.json`

**No changes in this plan:**
- `packages/web/src/features/settings/components/settings-page.tsx` appearance `Pill` selectors
- any `Pill` implementation work
- any `Tabs` workspace caller migration already completed in phase M
- any `Select`, `Popover`, `ActionMenu`, `Sheet`, or `Tooltip` work

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded segmented-selector caller inventory**

Current callers in scope:

- `packages/web/src/features/settings/components/provider-settings.tsx`
  - top provider selector: `.settings-provider-tabs` / `.settings-provider-tab`
  - desktop detail subnav: `.settings-provider-subnav` / `.settings-provider-subnav-button`
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
  - category selector: `.shortcuts-category-tabs` / `.shortcuts-category-tab`

Current non-goals:

- `packages/web/src/features/settings/components/settings-page.tsx` theme / language / terminal renderer `Pill` selectors
- any other tab-like or pill-like families outside settings

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/provider-settings.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `SegmentedControl`

**Files:**
- Create: `packages/web/src/components/ui/segmented-control/*`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <SegmentedControl
    aria-label="Provider selector"
    className="settings-provider-tabs"
    onChange={setValue}
    optionClassName="settings-provider-tab"
    options={[
      { label: "Claude", value: "claude" },
      { label: "Codex", value: "codex" },
    ]}
    value="claude"
  />
);
```

and assertions for:

- the control renders a real `tablist` with `tab` children and controlled `aria-selected`
- clicking and keyboard navigation call `onChange` with the selected option `value`
- caller-supplied legacy compatibility classes (`settings-provider-tabs`, `settings-provider-tab`, `settings-provider-subnav`, `settings-provider-subnav-button`, `shortcuts-category-tab`) remain on rendered nodes
- size variants can be selected without callers hand-coding padding classes
- callers can optionally pass an explicit accessible label, and that label reaches the rendered tablist

- [ ] **Step 2: Implement the shared primitive**

Requirements:

- public API exports `SegmentedControl` and relevant prop types from the public barrel
- `SegmentedControl` accepts controlled `value`, `onChange`, `options`, optional `size`, optional `className`, optional `optionClassName`, and pass-through props including `aria-label`
- keep the primitive option-driven and presentational; no settings-specific state or translations inside the primitive
- reuse shared tab semantics for keyboard behavior and selected-state ARIA instead of inventing another control contract
- CSS module owns the generic segmented shell and the legacy compatibility selectors for the bounded settings families
- preserve legacy compatibility styling during migration, but do not keep the old global CSS blocks in `styles/components.css` once ownership has moved into the primitive

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/segmented-control/index.test.tsx
```

Expected: all shared segmented-control tests pass.

## Task 3: Migrate Settings Callers

**Files:**
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`
- Modify: `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("tablist", { name: "Providers" })).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "Claude" })).toHaveClass("settings-provider-tab");
```

and preserve:

- desktop provider settings still default to the base view and switch to config files explicitly
- switching providers on desktop preserves the active detail subview
- mobile provider settings still return to the base view when switching providers from config mode
- shortcuts desktop section still exposes the same bindings list, edit flow, reset flow, and reset-all action
- rendered provider and shortcuts selectors keep their legacy compatibility classes on the tablist/tab roots

- [ ] **Step 2: Replace raw segmented markup with the shared primitive**

Requirements:

- import `SegmentedControl` from the public UI barrel only
- keep feature state (`selectedProvider`, `desktopView`, `mobileView`, `activeCategory`) in feature code
- give each segmented control an explicit accessible name; add locale keys if no existing translation is precise enough
- keep `Textarea`, `ConfigEditor`, shortcut capture, reset actions, and all content branching ownership in feature code
- do not route appearance `Pill` selectors through `SegmentedControl`

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/segmented-control/index.test.tsx \
  src/features/settings/components/provider-settings.test.tsx \
  src/features/settings/components/settings-page.test.tsx
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

- add `SegmentedControl` to the UI barrel
- add `SegmentedControl` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect the bounded segmented-control migration status and remaining caller count

- [ ] **Step 2: Run the full phase-n verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/segmented-control/index.test.tsx \
  src/features/settings/components/provider-settings.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/segmented-control \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/settings/components/provider-settings.tsx \
  src/features/settings/components/provider-settings.test.tsx \
  src/features/settings/components/shortcuts-settings.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/locales/zh.json \
  src/locales/en.json
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining bounded raw segmented callers**

Run:

```bash
rg -n "settings-provider-tab|settings-provider-subnav-button|shortcuts-category-tab|shortcuts-category-tabs|settings-provider-tabs|settings-provider-subnav" packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared segmented-control primitive itself, its tests/docs, and migrated feature code intentionally composing the shared primitive. There should be no remaining raw button-map implementations for these bounded settings selector families.
