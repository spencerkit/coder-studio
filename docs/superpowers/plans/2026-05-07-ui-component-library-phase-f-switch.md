# UI Component Library Phase F Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Switch` primitive, migrate the two notification toggles in `SettingsPage`, and preserve current save, disabled, and accessibility behavior.

**Architecture:** Implement `Switch` as a controlled, button-based shared primitive in `packages/web/src/components/ui/switch/`, styled with tokens and exported from the public barrel. Keep this slice narrowly scoped to the `GeneralSettings` notification toggles so the new API is proven against real settings persistence without pulling in unrelated checkbox patterns such as the config-drift banner.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing `tokens.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/switch/index.tsx`
- `packages/web/src/components/ui/switch/index.module.css`
- `packages/web/src/components/ui/switch/index.test.tsx`
- `packages/web/src/components/ui/switch/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`

**No changes in this plan:**
- `packages/web/src/styles/components.css`
- `packages/web/src/features/config-drift-banner/index.tsx`
- any checkbox patterns outside `SettingsPage`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the current switch caller counts**

Baseline targets in this slice:

- the two `.settings-toggle` notification controls in `SettingsPage`

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected: all tests pass.

## Task 2: Implement `Switch`

**Files:**
- Create: `packages/web/src/components/ui/switch/*`

- [ ] **Step 1: Write failing `Switch` tests**

Cover:

```tsx
render(<Switch checked={false} aria-label="Notifications" onCheckedChange={vi.fn()} />);
render(<Switch checked aria-label="Notifications" onCheckedChange={vi.fn()} />);
render(<Switch checked={false} disabled aria-label="Notifications" onCheckedChange={vi.fn()} />);
render(
  <Switch
    checked
    size="sm"
    className="settings-toggle"
    aria-label="Notifications"
    onCheckedChange={vi.fn()}
  />
);
```

- [ ] **Step 2: Implement `Switch`**

Requirements:

- button-based primitive with `role="switch"` and `aria-checked`
- controlled API: `checked`, `onCheckedChange`, `disabled`
- support `size?: "sm" | "md"` with `md` default
- preserve custom classes passed through `className`
- include an internal track/thumb structure so visuals do not depend on feature markup

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/switch/index.test.tsx
```

Expected: all `Switch` tests pass.

## Task 3: Migrate `SettingsPage` Notification Toggles

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write failing settings integration tests**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("switch", { name: "启用通知" })).toHaveAttribute("aria-checked", "true");
expect(screen.getByRole("switch", { name: "通知音效" })).toBeDisabled();
```

and interaction coverage that toggling the shared switch still issues the existing `settings.update` payloads.

- [ ] **Step 2: Migrate the notification toggles to `Switch`**

Requirements:

- replace the two inline checkbox/slider controls with shared `Switch`
- preserve current settings row layout and copy
- keep the `sound` toggle disabled whenever notifications are disabled
- preserve the existing `settings.update` payloads and notification preference sync logic
- keep the accessible names tied to the existing visible labels

- [ ] **Step 3: Run the focused settings test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/switch/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected: all tests pass.

## Task 4: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export `Switch` from the public barrel**

- [ ] **Step 2: Update the UI library README**

Mark `Switch` as implemented.

- [ ] **Step 3: Update migration inventory**

After this phase:

- `Switch` should reflect the bounded notification toggle callers in this slice
- caller count should be `0` if both selected settings toggles are migrated

- [ ] **Step 4: Run the targeted test set**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/switch/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

- [ ] **Step 5: Run targeted formatting/lint verification**

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/switch \
  src/features/settings/components/settings-page.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md
```

Expected: no new errors.
