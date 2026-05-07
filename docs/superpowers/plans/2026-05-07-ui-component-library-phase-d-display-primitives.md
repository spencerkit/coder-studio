# UI Component Library Phase D Display Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `Pill`, `Kbd`, `StatusDot`, and `Spinner` as the next Tier 0 shared UI primitives, migrate a small set of real callers, and keep legacy compatibility intact.

**Architecture:** Follow the same parity-first slice pattern as `Button`, `Input`, and `Textarea`. Each component lives in its own folder under `packages/web/src/components/ui/`, uses CSS Modules plus temporary `:global()` legacy aliases, and is exported from the public barrel. Migrate only the selected settings, agent-panes, topbar, and workspace callers so the abstractions are proven without taking on every remaining badge/dot variant.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing `tokens.css`, existing global `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-07-ui-component-library-display-primitives-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/pill/index.tsx`
- `packages/web/src/components/ui/pill/index.module.css`
- `packages/web/src/components/ui/pill/index.test.tsx`
- `packages/web/src/components/ui/pill/README.md`
- `packages/web/src/components/ui/kbd/index.tsx`
- `packages/web/src/components/ui/kbd/index.module.css`
- `packages/web/src/components/ui/kbd/index.test.tsx`
- `packages/web/src/components/ui/kbd/README.md`
- `packages/web/src/components/ui/status-dot/index.tsx`
- `packages/web/src/components/ui/status-dot/index.module.css`
- `packages/web/src/components/ui/status-dot/index.test.tsx`
- `packages/web/src/components/ui/status-dot/README.md`
- `packages/web/src/components/ui/spinner/index.tsx`
- `packages/web/src/components/ui/spinner/index.module.css`
- `packages/web/src/components/ui/spinner/index.test.tsx`
- `packages/web/src/components/ui/spinner/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/topbar/components/connection-status.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

**No changes in this plan:**
- `packages/web/src/styles/components.css`
- `Tag`, `Badge`, `SegmentedControl`
- mobile-only status dot variants

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the current display primitive caller counts**

Baseline targets in this slice:

- `.settings-pill*`
- `.shortcuts-key`
- `.session-dot*`
- `.connection-status-dot*`
- `.animate-spin`

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected: all tests pass.

## Task 2: Implement `Pill` and `Kbd`

**Files:**
- Create: `packages/web/src/components/ui/pill/*`
- Create: `packages/web/src/components/ui/kbd/*`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/settings/components/shortcuts-settings.tsx`

- [ ] **Step 1: Write failing `Pill` tests**

Cover:

```tsx
render(<Pill>Dark</Pill>);
render(<Pill active>Dark</Pill>);
render(<Pill disabled>Dark</Pill>);
render(<Pill leadingIcon={<Check />} className="settings-pill" />);
```

- [ ] **Step 2: Implement `Pill`**

Requirements:

- button-based component
- `active`, `disabled`, `leadingIcon`
- legacy classes include `settings-pill`
- active state keeps `settings-pill-active` parity

- [ ] **Step 3: Write failing `Kbd` tests**

Cover:

```tsx
render(<Kbd>⌘+K</Kbd>);
render(<Kbd size="sm">Esc</Kbd>);
render(<Kbd interactive className="shortcuts-key">⌘+K</Kbd>);
```

- [ ] **Step 4: Implement `Kbd`**

Requirements:

- semantic `<kbd>`
- `size`, `interactive`
- preserve mono typography
- legacy/custom classes survive

- [ ] **Step 5: Migrate settings callers**

Change:

- appearance/theme/locale pills to `<Pill />`
- shortcut display keycaps to `<Kbd />`

- [ ] **Step 6: Update focused tests**

Assertions should confirm:

- selected appearance options still render shared pill compatibility classes
- shortcut keycap still renders and transitions into capture mode

## Task 3: Implement `StatusDot` and `Spinner`

**Files:**
- Create: `packages/web/src/components/ui/status-dot/*`
- Create: `packages/web/src/components/ui/spinner/*`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/topbar/components/connection-status.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

- [ ] **Step 1: Write failing `StatusDot` tests**

Cover:

```tsx
render(<StatusDot />);
render(<StatusDot tone="success" />);
render(<StatusDot tone="warning" pulse />);
render(<StatusDot size="lg" className="session-dot" />);
```

- [ ] **Step 2: Implement `StatusDot`**

Requirements:

- span-based visual primitive
- `tone`, `size`, `pulse`
- compatibility with `session-dot` / `connection-status-dot`

- [ ] **Step 3: Write failing `Spinner` tests**

Cover:

```tsx
render(<Spinner label="Loading" />);
render(<Spinner label="Loading" size="sm" />);
render(<Spinner label="Loading" className="animate-spin" />);
```

- [ ] **Step 4: Implement `Spinner`**

Requirements:

- accessible label
- size variants
- preserve `animate-spin` compatibility class

- [ ] **Step 5: Migrate selected callers**

Change:

- session header dots to `<StatusDot />`
- draft launcher idle dot to `<StatusDot />`
- connection status dot to `<StatusDot />`
- workspace launch modal loading icon to `<Spinner />`

- [ ] **Step 6: Update focused tests**

Assertions should confirm:

- session card still renders the correct dot classes/semantics
- workspace launch loading state still renders a spinner

## Task 4: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export all four components from the public barrel**

- [ ] **Step 2: Update the UI library README**

Mark `Pill`, `Kbd`, `StatusDot`, `Spinner` as implemented.

- [ ] **Step 3: Update migration inventory**

After this phase:

- `Pill` should count only real remaining legacy pill callers outside this slice
- `Kbd`, `StatusDot`, and `Spinner` should reflect real remaining callers outside this slice

- [ ] **Step 4: Run the targeted test set**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/pill/index.test.tsx \
  src/components/ui/kbd/index.test.tsx \
  src/components/ui/status-dot/index.test.tsx \
  src/components/ui/spinner/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/agent-panes/components/session-card.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

- [ ] **Step 5: Run lint**

```bash
pnpm lint
```

Expected: only the existing repo warnings, if any.
