# Typography Role Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse ordinary UI typography into one 12-role contract (`heading-1` to `heading-6`, `body-1` to `body-6`) and migrate shared components, base styles, and feature shells onto that contract.

**Architecture:** Add the 12 role tokens in `tokens.css`, keep only migration-only aliases for the old semantic token names, rebind `base.css` and shared UI modules to the new roles, and then lock the contract with stylesheet tests plus a guardrail that rejects raw or legacy typography in shared UI. Code/editor/diff surfaces remain exempt.

**Tech Stack:** TypeScript, React 19, Vitest, vanilla CSS custom properties, CSS Modules, Biome

**Spec reference:** `docs/superpowers/specs/2026-05-21-typography-role-convergence-design.md`

---

## File Structure

- Modify: `packages/web/src/styles/tokens.css`
  - Add the 12 role tokens and map the old semantic aliases onto them for migration.
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
  - Lock the role values and the PC/Mobile equality contract.
- Modify: `packages/web/src/styles/base.css`
  - Rebind root elements and helper classes to the new role tokens.
- Modify: `packages/web/src/styles/base.theme.test.ts`
  - Assert the base typography contract.
- Modify: `packages/web/src/components/ui/button/index.module.css`
- Modify: `packages/web/src/components/ui/input/index.module.css`
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
- Modify: `packages/web/src/components/ui/segmented-control/index.module.css`
- Modify: `packages/web/src/components/ui/kbd/index.module.css`
- Modify: `packages/web/src/components/ui/pill/index.module.css`
- Modify: `packages/web/src/components/ui/tag/index.module.css`
- Modify: `packages/web/src/components/ui/badge/index.module.css`
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
- Modify: `packages/web/src/components/ui/notice/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/drawer/index.module.css`
- Modify: `packages/web/src/components/ui/sheet/index.module.css`
- Modify: `packages/web/src/components/ui/toast/index.module.css`
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`
- Modify: `packages/web/src/components/ui/confirm-dialog/index.module.css`
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
- Modify: `packages/web/src/components/ui/switch/index.module.css`
- Modify: `packages/web/src/components/ui/popover/index.module.css`
- Modify: `packages/web/src/components/ui/action-menu/index.module.css`
- Modify: `packages/web/src/components/ui/progress-bar/index.module.css`
- Modify: `packages/web/src/components/ui/datetime-picker/index.module.css`
- Modify: `packages/web/src/components/ui/local-overlay/index.module.css`
- Modify: `packages/web/src/components/ui/workbench-layer/index.module.css`
- Modify: `packages/web/src/styles/components.css`
  - Rebind feature-shell and shared chrome text classes to the new roles.
- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Assert the migrated component and shell mappings.
- Modify: `packages/web/src/styles/typography.guard.test.ts`
  - Reject raw font sizes and legacy semantic tokens in shared UI, with code-surface exemptions.
- Modify: `packages/web/src/components/ui/README.md`
  - Update the public contract and the migration rules.
- Modify: `packages/web/src/components/ui/MIGRATION.md`
  - Record the shared-component migration status.

---

### Task 1: Define The 12-Role Token Contract

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Test: `packages/web/src/styles/tokens-touch.test.ts`

- [ ] **Step 1: Write the failing token assertions**

```ts
it("defines the 12-role typography contract on :root", () => {
  const root = getRuleBlock(":root");

  expect(root).toContain("--type-heading-1-size: 28px");
  expect(root).toContain("--type-heading-1-line-height: 1.1");
  expect(root).toContain("--type-heading-1-weight: var(--font-semibold)");
  expect(root).toContain("--type-heading-6-size: 14px");
  expect(root).toContain("--type-body-1-size: 18px");
  expect(root).toContain("--type-body-3-size: 14px");
  expect(root).toContain("--type-body-5-size: 12px");
  expect(root).toContain("--type-body-6-size: 11px");
});
```

- [ ] **Step 2: Run the token test to confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected: fail because the 12-role tokens do not exist yet.

- [ ] **Step 3: Implement the minimal token layer**

```css
  --type-heading-1-size: 28px;
  --type-heading-1-line-height: 1.1;
  --type-heading-1-weight: var(--font-semibold);
  --type-heading-2-size: 24px;
  --type-heading-2-line-height: 1.15;
  --type-heading-2-weight: var(--font-semibold);
  --type-heading-3-size: 20px;
  --type-heading-3-line-height: 1.2;
  --type-heading-3-weight: var(--font-semibold);
  --type-heading-4-size: 18px;
  --type-heading-4-line-height: 1.25;
  --type-heading-4-weight: var(--font-normal);
  --type-heading-5-size: 16px;
  --type-heading-5-line-height: 1.3;
  --type-heading-5-weight: var(--font-normal);
  --type-heading-6-size: 14px;
  --type-heading-6-line-height: 1.35;
  --type-heading-6-weight: var(--font-normal);

  --type-body-1-size: 18px;
  --type-body-1-line-height: 1.6;
  --type-body-1-weight: var(--font-normal);
  --type-body-2-size: 16px;
  --type-body-2-line-height: 1.6;
  --type-body-2-weight: var(--font-normal);
  --type-body-3-size: 14px;
  --type-body-3-line-height: 1.6;
  --type-body-3-weight: var(--font-normal);
  --type-body-4-size: 13px;
  --type-body-4-line-height: 1.5;
  --type-body-4-weight: var(--font-normal);
  --type-body-5-size: 12px;
  --type-body-5-line-height: 1.45;
  --type-body-5-weight: var(--font-normal);
  --type-body-6-size: 11px;
  --type-body-6-line-height: 1.4;
  --type-body-6-weight: var(--font-normal);

  --type-body-3-family: var(--font-sans);
  --type-body-5-family: var(--font-mono);

  --type-page-title-size: var(--type-heading-1-size);
  --type-section-title-size: var(--type-heading-4-size);
  --type-app-title-size: var(--type-heading-5-size);
  --type-body-size: var(--type-body-3-size);
  --type-body-strong-size: var(--type-body-3-size);
  --type-label-size: var(--type-body-6-size);
  --type-meta-size: var(--type-body-5-size);
  --type-kicker-size: var(--type-body-6-size);
```

Extend the mobile override block so the role contract stays identical on PC and mobile. The token test should assert the mobile block only changes touch targets, not typography.

- [ ] **Step 4: Re-run the token test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the token contract**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "feat(web): add 12-role typography tokens"
```

### Task 2: Rebind Base Typography Defaults

**Files:**
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Write the failing base-style assertions**

```ts
it("maps base text elements onto the 12-role typography contract", () => {
  expect(getRuleBlock("body")).toContain("font-size: var(--type-body-3-size)");
  expect(getRuleBlock("button")).toContain("font-size: var(--type-body-3-size)");
  expect(getRuleBlock("input")).toContain("font-size: var(--type-body-3-size)");
  expect(getRuleBlock("h1")).toContain("font-size: var(--type-heading-1-size)");
  expect(getRuleBlock("h4")).toContain("font-size: var(--type-heading-4-size)");
  expect(getRuleBlock("h6")).toContain("font-size: var(--type-heading-6-size)");
  expect(getRuleBlock("kbd")).toContain("font-size: var(--type-body-5-size)");
});
```

- [ ] **Step 2: Run the base test to confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected: fail because `base.css` still points at the older semantic tokens.

- [ ] **Step 3: Rebind `base.css` to the new role tokens**

```css
body {
  font-family: var(--font-sans);
  font-size: var(--type-body-3-size);
  line-height: var(--type-body-3-line-height);
  font-weight: var(--type-body-3-weight);
}

h1 { font-size: var(--type-heading-1-size); line-height: var(--type-heading-1-line-height); font-weight: var(--type-heading-1-weight); }
h2 { font-size: var(--type-heading-2-size); line-height: var(--type-heading-2-line-height); font-weight: var(--type-heading-2-weight); }
h3 { font-size: var(--type-heading-3-size); line-height: var(--type-heading-3-line-height); font-weight: var(--type-heading-3-weight); }
h4 { font-size: var(--type-heading-4-size); line-height: var(--type-heading-4-line-height); font-weight: var(--type-heading-4-weight); }
h5 { font-size: var(--type-heading-5-size); line-height: var(--type-heading-5-line-height); font-weight: var(--type-heading-5-weight); }
h6 { font-size: var(--type-heading-6-size); line-height: var(--type-heading-6-line-height); font-weight: var(--type-heading-6-weight); }

button,
input,
textarea,
select {
  font-size: var(--type-body-3-size);
  line-height: var(--type-body-3-line-height);
  font-weight: var(--type-body-3-weight);
}

code,
kbd,
samp {
  font-family: var(--font-mono);
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.page-kicker,
.section-kicker {
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
}

.page-title {
  font-size: var(--type-heading-1-size);
  line-height: var(--type-heading-1-line-height);
  font-weight: var(--type-heading-1-weight);
}

.meta-text,
.hint-text {
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}
```

- [ ] **Step 4: Re-run the base test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the base remap**

```bash
git add packages/web/src/styles/base.css packages/web/src/styles/base.theme.test.ts
git commit -m "feat(web): rebind base typography to role tokens"
```

### Task 3: Migrate Shared UI Modules

**Files:**
- Modify: all shared UI modules listed in the file structure above that currently set `font-size`, `line-height`, or `font-weight`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing assertions for the shared UI primitives**

```ts
it("maps shared UI primitives onto the 12-role typography contract", () => {
  expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain("font-size: var(--type-body-3-size)");
  expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain("font-size: var(--type-body-3-size)");
  expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain("font-size: var(--type-body-5-size)");
  expect(getLastRuleBlockFrom(pillStyles, ".root")).toContain("font-size: var(--type-body-6-size)");
  expect(getLastRuleBlockFrom(tagStyles, ".root")).toContain("font-size: var(--type-body-6-size)");
  expect(getLastRuleBlockFrom(tooltipStyles, ".tooltip")).toContain("font-size: var(--type-body-5-size)");
  expect(getLastRuleBlockFrom(modalStyles, ".title")).toContain("font-size: var(--type-heading-4-size)");
  expect(getLastRuleBlockFrom(emptyStateStyles, ".title")).toContain("font-size: var(--type-heading-5-size)");
});
```

- [ ] **Step 2: Run the component stylesheet test to confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: fail because the shared modules still use the old semantic tokens.

- [ ] **Step 3: Rebind the shared modules to the new role tokens**

Examples:

```css
.btn,
:global(.btn) {
  font-size: var(--type-body-3-size);
  line-height: var(--type-body-3-line-height);
  font-weight: var(--type-body-3-weight);
}

.input {
  font-size: var(--type-body-3-size);
  line-height: var(--type-body-3-line-height);
  font-weight: var(--type-body-3-weight);
}

.tab,
:global(.panel-tab),
:global(.worktree-tab) {
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.tooltip {
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.title {
  font-size: var(--type-heading-4-size);
  line-height: var(--type-heading-4-line-height);
  font-weight: var(--type-heading-4-weight);
}
```

Use the same pattern for the remaining shared modules in the file structure:
`segmented-control`, `kbd`, `pill`, `tag`, `badge`, `notice`, `modal`, `drawer`, `sheet`, `toast`, `confirm-dialog`, `status-dot`, `switch`, `popover`, `action-menu`, `progress-bar`, `datetime-picker`, `local-overlay`, and `workbench-layer`.

- [ ] **Step 4: Re-run the component stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the shared-module migration**

```bash
git add packages/web/src/components/ui packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate shared ui typography roles"
```

### Task 4: Rebind Feature Shells And Common Copy Classes

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing assertions for the feature-shell typography classes**

```ts
it("maps common feature shells onto the new typography roles", () => {
  expect(getLastRuleBlock(".page-title")).toContain("font-size: var(--type-heading-1-size)");
  expect(getLastRuleBlock(".page-kicker")).toContain("font-size: var(--type-body-6-size)");
  expect(getLastRuleBlock(".meta-text")).toContain("font-size: var(--type-body-5-size)");
  expect(getLastRuleBlock(".section-title")).toContain("font-size: var(--type-body-6-size)");
  expect(getLastRuleBlock(".mobile-select-sheet__section-title")).toContain("font-size: var(--type-heading-6-size)");
  expect(getLastRuleBlock(".supervisor-details-section-title")).toContain("font-size: var(--type-heading-6-size)");
});
```

- [ ] **Step 2: Run the stylesheet test to confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: fail because `components.css` still carries the older typography values.

- [ ] **Step 3: Rebind `components.css` to the new roles**

Update the common copy selectors so they use the role tokens directly:

```css
.page-title {
  font-size: var(--type-heading-1-size);
  line-height: var(--type-heading-1-line-height);
  font-weight: var(--type-heading-1-weight);
}

.page-kicker,
.section-kicker {
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
}

.meta-text,
.hint-text {
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}
```

Then update the feature-shell selectors that still carry explicit typography values, including:
`welcome-*`, `auth-*`, `not-found`, `mobile-select-sheet__section-title`, `supervisor-details-section-title`, `file-context-menu__section-title`, and any other `font-size` blocks surfaced by `rg`.

- [ ] **Step 4: Re-run the stylesheet test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit the feature-shell migration**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): rebind shared feature shells to role tokens"
```

### Task 5: Tighten The Guardrail And Verify The Migration Surface

**Files:**
- Modify: `packages/web/src/styles/typography.guard.test.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Add failing guard assertions**

```ts
it("rejects legacy semantic font sizes in shared UI modules", () => {
  for (const [file, source] of sharedUiSources) {
    expect(source, file).not.toMatch(/var\(--type-(page-title|section-title|app-title|body-strong|body|label|meta|kicker|display|code-inline)-/);
  }
});
```

- [ ] **Step 2: Run the guard test to confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/typography.guard.test.ts
```

Expected: fail until the shared modules are fully migrated.

- [ ] **Step 3: Update the guardrail and docs**

Keep the guard focused on:

```ts
const forbiddenSharedPattern = /font-size:\s*(?:\d+px|clamp\(|var\(--text-)/;
```

and add any new legacy semantic token names that should not survive in shared UI.

Update `packages/web/src/components/ui/README.md` and `packages/web/src/components/ui/MIGRATION.md` so they describe the 12-role contract and mark each shared component as migrated only when it consumes the new role tokens.

- [ ] **Step 4: Run the full typography-related test slice**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts src/styles/base.theme.test.ts src/styles/components.theme.test.ts src/styles/typography.guard.test.ts
```

Expected: all pass.

- [ ] **Step 5: Final audit and commit**

Run:

```bash
rg -n "var\\(--type-(page-title|section-title|app-title|body-strong|body|label|meta|kicker|display|code-inline)-|font-size:\\s*(?:\\d+px|clamp\\(|var\\(--text-)" packages/web/src/components/ui packages/web/src/styles
```

Expected: only code/editor/diff exemptions remain.

Then commit:

```bash
git add packages/web/src/styles packages/web/src/components/ui
git commit -m "feat(web): converge ordinary ui typography roles"
```
