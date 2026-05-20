# UI Foundations Beyond Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the non-typography UI foundation set into a shared theme-aware token system, covering size/density, state colors, spacing rhythm, surface/overlay, and radius roles across ordinary UI plus terminal, session, editor, and diff chrome.

**Architecture:** Add semantic tokens for each foundation category in `tokens.css`, keep base numeric scales underneath them, and rebind `base.css`, `components.css`, and shared UI modules to the semantic roles instead of local recipes. Ordinary UI and code-oriented surfaces share one top-level contract, while terminal/session/editor/diff get explicit domain sub-spec tokens where their chrome needs different density or overlay behavior. Lock the contract with stylesheet tests plus a guardrail that rejects raw recipes outside the approved code-surface exemptions.

**Tech Stack:** TypeScript, React 19, Vitest, CSS custom properties, CSS Modules, Monaco, xterm.js, Biome

**Spec reference:** `docs/superpowers/specs/2026-05-20-ui-foundations-non-typography-design.md`

---

## File Structure

- Modify: `packages/web/src/styles/tokens.css`
  - Add semantic tokens for size/density, state, spacing, surface, radius, and code-surface domain defaults.
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
  - Lock the token contract and the theme ownership split.
- Modify: `packages/web/src/styles/base.css`
  - Rebind global focus, loading shells, and generic chrome to semantic foundation tokens.
- Modify: `packages/web/src/styles/base.theme.test.ts`
  - Assert the new global shell and focus-ring mappings.
- Modify: `packages/web/src/styles/components.css`
  - Migrate shared surfaces, overlays, and code-oriented chrome to semantic tokens.
- Modify: `packages/web/src/styles/components.theme.test.ts`
  - Add assertions for shared UI modules and code-oriented surface selectors.
- Modify: `packages/web/src/styles/foundations.guard.test.ts`
  - Reject new raw foundation recipes in shared UI and global styles.
- Modify: `packages/web/src/components/ui/button/index.module.css`
- Modify: `packages/web/src/components/ui/icon-button/index.module.css`
- Modify: `packages/web/src/components/ui/input/index.module.css`
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
- Modify: `packages/web/src/components/ui/switch/index.module.css`
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
- Modify: `packages/web/src/components/ui/segmented-control/index.module.css`
- Modify: `packages/web/src/components/ui/kbd/index.module.css`
- Modify: `packages/web/src/components/ui/popover/index.module.css`
- Modify: `packages/web/src/components/ui/action-menu/index.module.css`
- Modify: `packages/web/src/components/ui/tag/index.module.css`
- Modify: `packages/web/src/components/ui/badge/index.module.css`
- Modify: `packages/web/src/components/ui/pill/index.module.css`
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
- Modify: `packages/web/src/components/ui/notice/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/drawer/index.module.css`
- Modify: `packages/web/src/components/ui/sheet/index.module.css`
- Modify: `packages/web/src/components/ui/toast/index.module.css`
- Modify: `packages/web/src/components/ui/local-overlay/index.module.css`
- Modify: `packages/web/src/components/ui/progress-bar/index.module.css`
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`

Likely no changes:

- `packages/web/src/theme/registry.ts`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/web/src/features/code-editor/components/monaco-host.tsx`

Do not change terminal/editor font-size plumbing in this plan. Font size stays user-configurable there.

---

### Task 1: Establish The Foundation Token Contract

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Test: `packages/web/src/styles/tokens-touch.test.ts`

- [ ] **Step 1: Write the failing token-contract tests**

Add assertions like these to `packages/web/src/styles/tokens-touch.test.ts`:

```ts
it("defines the shared foundation tokens on :root", () => {
  const root = getRuleBlock(":root");

  expect(root).toContain("--control-height-sm: 28px");
  expect(root).toContain("--control-height-md: 32px");
  expect(root).toContain("--control-height-lg: 40px");
  expect(root).toContain("--icon-button-size-sm: 28px");
  expect(root).toContain("--list-row-height-compact: 32px");
  expect(root).toContain("--toolbar-height-regular: 40px");
  expect(root).toContain("--panel-header-height: 40px");

  expect(root).toContain("--state-focus-ring-color: var(--border-focus)");
  expect(root).toContain("--state-focus-ring-width: 2px");
  expect(root).toContain("--state-selected-bg:");
  expect(root).toContain("--state-disabled-bg:");
  expect(root).toContain("--state-success-bg:");
  expect(root).toContain("--state-warning-bg:");
  expect(root).toContain("--state-error-bg:");
  expect(root).toContain("--state-info-bg:");

  expect(root).toContain("--gap-stack-xs:");
  expect(root).toContain("--gap-stack-md:");
  expect(root).toContain("--inset-panel:");
  expect(root).toContain("--inset-dialog:");

  expect(root).toContain("--surface-page-bg:");
  expect(root).toContain("--surface-panel-bg:");
  expect(root).toContain("--surface-elevated-bg:");
  expect(root).toContain("--surface-overlay-bg:");
  expect(root).toContain("--surface-overlay-shadow:");
  expect(root).toContain("--surface-overlay-backdrop:");

  expect(root).toContain("--radius-control:");
  expect(root).toContain("--radius-chip:");
  expect(root).toContain("--radius-pill:");
  expect(root).toContain("--radius-panel:");
  expect(root).toContain("--radius-overlay:");
  expect(root).toContain("--radius-local-overlay:");
  expect(root).toContain("--radius-flush:");
});
```

Add a second assertion that captures the ownership split:

```ts
it("keeps actively themed foundation roles and shared defaults visible in theme blocks", () => {
  const mintDark = getRuleBlock('[data-theme="mint-dark"]');
  const graphiteLight = getRuleBlock('[data-theme="graphite-light"]');

  expect(getCustomProperty(mintDark, "--state-focus-ring-color")).not.toBe(
    getCustomProperty(graphiteLight, "--state-focus-ring-color")
  );
  expect(getCustomProperty(mintDark, "--surface-overlay-bg")).not.toBe(
    getCustomProperty(graphiteLight, "--surface-overlay-bg")
  );
  expect(getCustomProperty(mintDark, "--radius-overlay")).toBe(
    getCustomProperty(graphiteLight, "--radius-overlay")
  );
  expect(getCustomProperty(mintDark, "--gap-stack-md")).toBe(
    getCustomProperty(graphiteLight, "--gap-stack-md")
  );
});
```

- [ ] **Step 2: Run the token tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:

- FAIL because `tokens.css` does not yet define the semantic foundation tokens.
- FAIL because the theme blocks do not yet expose the new state/surface roles.

- [ ] **Step 3: Implement the minimal token layer in `tokens.css`**

Add the new semantic layer near the existing spacing/radius sections:

```css
  --control-height-sm: 28px;
  --control-height-md: 32px;
  --control-height-lg: 40px;
  --icon-button-size-sm: 28px;
  --icon-button-size-md: 32px;
  --icon-button-size-lg: 40px;
  --list-row-height-compact: 32px;
  --list-row-height-regular: 40px;
  --toolbar-height-compact: 32px;
  --toolbar-height-regular: 40px;
  --panel-header-height: 40px;

  --state-focus-ring-color: var(--border-focus);
  --state-focus-ring-width: 2px;
  --state-hover-bg-subtle: var(--bg-hover);
  --state-hover-bg-strong: var(--bg-active);
  --state-active-bg: var(--bg-active);
  --state-selected-bg: color-mix(in srgb, var(--accent-blue) 12%, var(--bg-panel));
  --state-selected-border: color-mix(in srgb, var(--accent-blue) 22%, transparent);
  --state-disabled-bg: var(--bg-disabled);
  --state-disabled-border: var(--border);
  --state-disabled-text: var(--text-disabled);
  --state-success-bg: color-mix(in srgb, var(--color-success) 14%, transparent);
  --state-success-border: color-mix(in srgb, var(--color-success) 28%, transparent);
  --state-success-text: var(--color-success);
  --state-success-icon: var(--icon-success);
  --state-warning-bg: color-mix(in srgb, var(--color-warning) 14%, transparent);
  --state-warning-border: color-mix(in srgb, var(--color-warning) 28%, transparent);
  --state-warning-text: var(--color-warning);
  --state-warning-icon: var(--icon-warning);
  --state-error-bg: color-mix(in srgb, var(--color-error) 14%, transparent);
  --state-error-border: color-mix(in srgb, var(--color-error) 28%, transparent);
  --state-error-text: var(--color-error);
  --state-error-icon: var(--icon-error);
  --state-info-bg: color-mix(in srgb, var(--color-info) 14%, transparent);
  --state-info-border: color-mix(in srgb, var(--color-info) 28%, transparent);
  --state-info-text: var(--color-info);
  --state-info-icon: var(--icon-info);

  --gap-stack-xs: var(--sp-1);
  --gap-stack-sm: var(--sp-2);
  --gap-stack-md: var(--sp-3);
  --gap-stack-lg: var(--sp-4);
  --gap-cluster-sm: var(--sp-1);
  --gap-cluster-md: var(--sp-2);
  --inset-control-inline: var(--sp-3);
  --inset-control-block: var(--sp-2);
  --inset-row-inline: var(--sp-4);
  --inset-row-block: var(--sp-3);
  --inset-panel: var(--sp-4);
  --inset-dialog: var(--sp-6);
  --inset-drawer: var(--sp-4);
  --section-gap: var(--sp-6);
  --form-group-gap: var(--sp-3);

  --surface-page-bg: var(--bg-page);
  --surface-panel-bg: var(--bg-panel);
  --surface-elevated-bg: var(--bg-elevated);
  --surface-overlay-bg: color-mix(in srgb, var(--bg-elevated) 96%, transparent);
  --surface-overlay-border: var(--border);
  --surface-overlay-shadow: var(--shadow-lg);
  --surface-overlay-backdrop: color-mix(in srgb, var(--bg-page) 72%, black 28%);
  --surface-sticky-bg: color-mix(in srgb, var(--bg-page) 96%, var(--bg-surface) 4%);
  --overlay-width-sm: 360px;
  --overlay-width-md: 480px;
  --overlay-width-lg: 680px;
  --overlay-backdrop-opacity: 0.48;

  --radius-control: var(--radius-md);
  --radius-control-sm: var(--radius-sm);
  --radius-control-lg: var(--radius-lg);
  --radius-chip: var(--radius-full);
  --radius-tag: var(--radius-full);
  --radius-pill: var(--radius-full);
  --radius-panel: var(--radius-xl);
  --radius-overlay: var(--radius-xl);
  --radius-local-overlay: var(--radius-lg);
  --radius-flush: 0px;

  --terminal-panel-inset: var(--inset-panel);
  --terminal-toolbar-gap: var(--gap-cluster-md);
  --terminal-local-overlay-radius: var(--radius-local-overlay);
  --terminal-state-running-bg: var(--state-info-bg);
  --terminal-state-running-border: var(--state-info-border);
  --terminal-state-running-text: var(--state-info-text);
  --terminal-state-reconnecting-bg: var(--state-warning-bg);
  --terminal-state-reconnecting-border: var(--state-warning-border);
  --terminal-state-failed-bg: var(--state-error-bg);
  --terminal-state-failed-border: var(--state-error-border);
  --session-card-gap: var(--gap-stack-md);
  --session-row-gap: var(--gap-cluster-md);
  --session-state-radius: var(--radius-chip);
  --editor-pane-inset: var(--inset-panel);
  --editor-toolbar-inset: var(--inset-control-inline);
  --editor-peek-radius: var(--radius-overlay);
  --editor-selection-bg: var(--state-selected-bg);
  --editor-selection-inactive-bg: color-mix(in srgb, var(--state-selected-bg) 60%, transparent);
  --editor-diagnostic-warning-bg: var(--state-warning-bg);
  --editor-diagnostic-error-bg: var(--state-error-bg);
  --diff-section-gap: var(--section-gap);
  --diff-thread-inset: var(--inset-row-inline);
  --diff-thread-radius: var(--radius-panel);
  --diff-add-bg: var(--state-success-bg);
  --diff-modify-bg: var(--state-info-bg);
  --diff-delete-bg: var(--state-error-bg);
```

Keep the theme blocks responsible for the actively themed categories (`state` and `surface`) and leave the shared defaults identical where a family does not need different values yet.

- [ ] **Step 4: Re-run the token tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:

- PASS for the new foundation token contract.
- PASS for the theme ownership assertions.

- [ ] **Step 5: Commit the foundation token contract**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "feat(web): add semantic foundation token contract"
```

---

### Task 2: Rebind Base Chrome To Semantic Foundation Tokens

**Files:**
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Write the failing base-shell tests**

Add assertions like these to `packages/web/src/styles/base.theme.test.ts`:

```ts
it("routes focus and shell chrome through semantic foundation tokens", () => {
  expect(getRuleBlock(":focus-visible")).toContain(
    "outline: var(--state-focus-ring-width) solid var(--state-focus-ring-color)"
  );

  expect(getRuleBlock(".app-loading-shell")).toContain("background: var(--surface-page-bg)");
  expect(getRuleBlock(".app-loading-card")).toContain("background: var(--surface-overlay-bg)");
  expect(getRuleBlock(".app-loading-card")).toContain("box-shadow: var(--surface-overlay-shadow)");
  expect(getRuleBlock(".app-loading-card")).toContain("border-radius: var(--radius-overlay)");

  expect(getRuleBlock(".icon-chip")).toContain("border-radius: var(--radius-control)");
  expect(getRuleBlock(".icon-surface-warning")).toContain("background: var(--state-warning-bg)");
});
```

- [ ] **Step 2: Run the base tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected:

- FAIL because `base.css` still uses the older raw focus and shell recipes.

- [ ] **Step 3: Implement the minimal base.css rebinding**

Update `packages/web/src/styles/base.css` so the global chrome uses the new semantic roles:

```css
:focus-visible {
  outline: var(--state-focus-ring-width) solid var(--state-focus-ring-color);
  outline-offset: 2px;
}

.app-loading-shell {
  background: var(--surface-page-bg);
}

.app-loading-card {
  background: var(--surface-overlay-bg);
  border-radius: var(--radius-overlay);
  box-shadow: var(--surface-overlay-shadow);
}

.icon-chip {
  border-radius: var(--radius-control);
}

.icon-surface-warning {
  background: var(--state-warning-bg);
}
```

Keep the typography rules untouched here; this task is only about the non-typography base chrome.

- [ ] **Step 4: Re-run the base tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected:

- PASS for the global focus-ring and shell mappings.

- [ ] **Step 5: Commit the base chrome rebinding**

```bash
git add packages/web/src/styles/base.css packages/web/src/styles/base.theme.test.ts
git commit -m "feat(web): rebind base chrome to semantic foundations"
```

---

### Task 3: Migrate Shared Control And Navigation Primitives

**Files:**
- Modify: `packages/web/src/components/ui/button/index.module.css`
- Modify: `packages/web/src/components/ui/icon-button/index.module.css`
- Modify: `packages/web/src/components/ui/input/index.module.css`
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
- Modify: `packages/web/src/components/ui/switch/index.module.css`
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
- Modify: `packages/web/src/components/ui/segmented-control/index.module.css`
- Modify: `packages/web/src/components/ui/kbd/index.module.css`
- Modify: `packages/web/src/components/ui/popover/index.module.css`
- Modify: `packages/web/src/components/ui/action-menu/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing primitive tests**

Extend `packages/web/src/styles/components.theme.test.ts` with assertions like:

```ts
it("maps control and navigation primitives onto semantic density and radius roles", () => {
  expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain("height: var(--control-height-md)");
  expect(getLastRuleBlockFrom(buttonStyles, ".btn")).toContain("border-radius: var(--radius-control)");
  expect(getLastRuleBlockFrom(iconButtonStyles, ".icon-button")).toContain(
    "width: var(--icon-button-size-md)"
  );
  expect(getLastRuleBlockFrom(inputStyles, ".input")).toContain("height: var(--control-height-md)");
  expect(getLastRuleBlockFrom(textareaStyles, ".input")).toContain("border-radius: var(--radius-control)");
  expect(getLastRuleBlockFrom(switchStyles, ".switch")).toContain("border-radius: var(--radius-pill)");
  expect(getLastRuleBlockFrom(tabsStyles, ":global(.panel-tab)")).toContain(
    "border-radius: var(--radius-control)"
  );
  expect(getLastRuleBlockFrom(segmentedControlStyles, ".tab")).toContain(
    "gap: var(--gap-cluster-sm)"
  );
  expect(getLastRuleBlockFrom(kbdStyles, ".kbd")).toContain("border-radius: var(--radius-control-sm)");
  expect(getLastRuleBlockFrom(popoverStyles, ".content")).toContain("border-radius: var(--radius-overlay)");
  expect(getLastRuleBlockFrom(actionMenuStyles, ".menu")).toContain(
    "padding: var(--inset-panel)"
  );
});
```

- [ ] **Step 2: Run the primitive tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the primitive CSS modules still use raw spacing, sizing, and radius values.

- [ ] **Step 3: Refactor the primitives to consume semantic tokens**

Update the listed CSS modules so the primitives use shared density, spacing, radius, and state tokens instead of local recipes. The important replacements are:

```css
/* examples */
height: var(--control-height-md);
width: var(--icon-button-size-md);
gap: var(--gap-cluster-sm);
padding: var(--inset-control-block) var(--inset-control-inline);
border-radius: var(--radius-control);
border-radius: var(--radius-pill);
border-radius: var(--radius-overlay);
background: var(--state-selected-bg);
border-color: var(--state-selected-border);
```

Keep the primitive APIs and class names stable; this is a styling-only migration.

- [ ] **Step 4: Re-run the primitive tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the control and navigation primitive mappings.

- [ ] **Step 5: Commit the primitive migration**

```bash
git add \
  packages/web/src/components/ui/button/index.module.css \
  packages/web/src/components/ui/icon-button/index.module.css \
  packages/web/src/components/ui/input/index.module.css \
  packages/web/src/components/ui/textarea/index.module.css \
  packages/web/src/components/ui/switch/index.module.css \
  packages/web/src/components/ui/tabs/index.module.css \
  packages/web/src/components/ui/segmented-control/index.module.css \
  packages/web/src/components/ui/kbd/index.module.css \
  packages/web/src/components/ui/popover/index.module.css \
  packages/web/src/components/ui/action-menu/index.module.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate control primitives to semantic foundations"
```

---

### Task 4: Migrate Shared Feedback And Overlay Primitives

**Files:**
- Modify: `packages/web/src/components/ui/tag/index.module.css`
- Modify: `packages/web/src/components/ui/badge/index.module.css`
- Modify: `packages/web/src/components/ui/pill/index.module.css`
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
- Modify: `packages/web/src/components/ui/notice/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/drawer/index.module.css`
- Modify: `packages/web/src/components/ui/sheet/index.module.css`
- Modify: `packages/web/src/components/ui/toast/index.module.css`
- Modify: `packages/web/src/components/ui/local-overlay/index.module.css`
- Modify: `packages/web/src/components/ui/progress-bar/index.module.css`
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing feedback/overlay tests**

Add assertions like these to `packages/web/src/styles/components.theme.test.ts`:

```ts
it("maps feedback and overlay primitives onto semantic surface and state roles", () => {
  expect(getLastRuleBlockFrom(tagStyles, ":where(.tag)")).toContain("border-radius: var(--radius-tag)");
  expect(getLastRuleBlockFrom(badgeStyles, ":where(.badge)")).toContain("border-radius: var(--radius-chip)");
  expect(getLastRuleBlockFrom(pillStylesheet, ".pill")).toContain("border-radius: var(--radius-pill)");
  expect(getLastRuleBlockFrom(tooltipStyles, ".tooltip")).toContain("background: var(--surface-overlay-bg)");
  expect(getLastRuleBlockFrom(noticeStylesheet, ".notice")).toContain("border-radius: var(--radius-overlay)");
  expect(getLastRuleBlockFrom(modalStyles, ".card")).toContain("background: var(--surface-overlay-bg)");
  expect(getLastRuleBlockFrom(drawerStyles, ".drawer")).toContain("background: var(--surface-overlay-bg)");
  expect(getLastRuleBlockFrom(sheetStyles, ".sheet")).toContain("border-radius: var(--radius-overlay)");
  expect(getLastRuleBlockFrom(toastStyles, ".toast")).toContain("box-shadow: var(--surface-overlay-shadow)");
  expect(getLastRuleBlockFrom(localOverlayStyles, ".surface")).toContain(
    "border-radius: var(--radius-local-overlay)"
  );
  expect(getLastRuleBlockFrom(progressBarStyles, ".bar")).toContain("background: var(--state-info-bg)");
  expect(getLastRuleBlockFrom(statusDotStyles, ".dot")).toContain("border-radius: var(--radius-chip)");
  expect(getLastRuleBlockFrom(emptyStateStyles, ".card")).toContain("padding: var(--inset-dialog)");
});
```

- [ ] **Step 2: Run the feedback tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the feedback and overlay primitives still have raw spacing, surface, and radius recipes.

- [ ] **Step 3: Refactor the feedback and overlay primitives**

Update the listed CSS modules to consume the semantic surface, state, spacing, and radius roles. The key replacements are:

```css
border-radius: var(--radius-tag);
border-radius: var(--radius-chip);
border-radius: var(--radius-pill);
background: var(--surface-overlay-bg);
box-shadow: var(--surface-overlay-shadow);
background: var(--state-info-bg);
background: var(--state-success-bg);
background: var(--state-warning-bg);
background: var(--state-error-bg);
padding: var(--inset-dialog);
padding: var(--inset-panel);
gap: var(--form-group-gap);
```

Keep the current markup and component APIs intact.

- [ ] **Step 4: Re-run the feedback tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the feedback and overlay mappings.

- [ ] **Step 5: Commit the feedback migration**

```bash
git add \
  packages/web/src/components/ui/tag/index.module.css \
  packages/web/src/components/ui/badge/index.module.css \
  packages/web/src/components/ui/pill/index.module.css \
  packages/web/src/components/ui/tooltip/index.module.css \
  packages/web/src/components/ui/notice/index.module.css \
  packages/web/src/components/ui/modal/index.module.css \
  packages/web/src/components/ui/drawer/index.module.css \
  packages/web/src/components/ui/sheet/index.module.css \
  packages/web/src/components/ui/toast/index.module.css \
  packages/web/src/components/ui/local-overlay/index.module.css \
  packages/web/src/components/ui/progress-bar/index.module.css \
  packages/web/src/components/ui/status-dot/index.module.css \
  packages/web/src/components/ui/empty-state/index.module.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate feedback primitives to semantic foundations"
```

---

### Task 5: Add Code-Oriented Domain Sub-Spec Tokens

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing code-surface tests**

Extend `packages/web/src/styles/components.theme.test.ts` with assertions like these:

```ts
it("routes terminal, session, editor, and diff chrome through domain sub-spec tokens", () => {
  expect(getLastRuleBlock(".xterm-host-shell")).toContain("padding: var(--terminal-panel-inset)");
  expect(getLastRuleBlock(".xterm-host")).toContain("border-radius: var(--radius-local-overlay)");
  expect(getLastRuleBlock(".terminal-upload-overlay")).toContain(
    "border-radius: var(--terminal-local-overlay-radius)"
  );
  expect(getLastRuleBlock(".xterm-replay-overlay__card")).toContain("border-radius: var(--terminal-local-overlay-radius)");

  expect(getLastRuleBlock(".session-card")).toContain("gap: var(--session-card-gap)");
  expect(getLastRuleBlock(".session-card--running")).toContain("background: var(--terminal-state-running-bg)");
  expect(getLastRuleBlock(".session-dot-running")).toContain("background: var(--terminal-state-running-border)");

  expect(getLastRuleBlock(".workspace-git-editor")).toContain("padding: var(--editor-pane-inset)");
  expect(getLastRuleBlock(".code-editor-body")).toContain("background: var(--surface-panel-bg)");
  expect(getLastRuleBlock(".git-diff-line-added")).toContain("background: var(--diff-add-bg)");
  expect(getLastRuleBlock(".git-diff-line-removed")).toContain("background: var(--diff-delete-bg)");
  expect(getLastRuleBlock(".git-diff-empty")).toContain("border-radius: var(--diff-thread-radius)");
});
```

- [ ] **Step 2: Run the code-surface tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- FAIL because the code-oriented chrome still uses local padding, radius, and tint recipes.

- [ ] **Step 3: Implement the domain sub-spec defaults and bindings**

Update `packages/web/src/styles/tokens.css` with the domain tokens, then bind the existing code-surface selectors in `packages/web/src/styles/components.css` to those tokens. Keep the terminal/editor font-size plumbing untouched; this task is only about chrome, spacing, overlay, state, and radius.

Representative replacements:

```css
.xterm-host-shell {
  padding: var(--terminal-panel-inset);
}

.session-card {
  gap: var(--session-card-gap);
}

.workspace-git-editor {
  padding: var(--editor-pane-inset);
}

.git-diff-line-added {
  background: var(--diff-add-bg);
}

.git-diff-line-removed {
  background: var(--diff-delete-bg);
}
```

If a selector needs a new domain hook, add it in `components.css`; do not rework `monaco-host.tsx` or `xterm-host.tsx` unless a missing class hook blocks the CSS migration.

- [ ] **Step 4: Re-run the code-surface tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:

- PASS for the terminal/session/editor/diff domain sub-spec mappings.

- [ ] **Step 5: Commit the code-surface migration**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): add code-surface foundation sub-spec tokens"
```

---

### Task 6: Add Guardrails And Run The Final Audit

**Files:**
- Create: `packages/web/src/styles/foundations.guard.test.ts`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/typography.guard.test.ts` (only if the exemption list needs to mirror the new code-surface selectors)

- [ ] **Step 1: Write the failing guard tests**

Create `packages/web/src/styles/foundations.guard.test.ts` with a guard like this:

```ts
const rawFoundationPattern =
  /(?:background|border|box-shadow|outline|border-radius|gap|padding|height|width|z-index):\s*(?:rgba\(|\d+px|0|999px|9999px)/;

const exemptSelectors = [
  /\.xterm-/,
  /\.monaco-/,
  /\.code-editor/,
  /\.git-diff-/,
  /\.diff-/,
  /\.session-terminal/,
  /\.terminal-/,
];

it("keeps shared UI and base chrome on semantic foundation tokens", () => {
  expect(baseStyles).not.toMatch(rawFoundationPattern);
  expect(componentsStyles).not.toMatch(rawFoundationPattern);
  for (const [file, source] of sharedUiSources) {
    expect(source, file).not.toMatch(rawFoundationPattern);
  }
});
```

The guard should permit the code-surface exemptions above, but only for the code surfaces themselves, not for shared UI or global shell code.

- [ ] **Step 2: Run the guard tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/styles/foundations.guard.test.ts
```

Expected:

- FAIL until all raw recipes have been migrated or exempted correctly.

- [ ] **Step 3: Fix any remaining raw foundation recipes**

Use the guard output to remove the last ad hoc `rgba()`, `999px`, `9999px`, `gap: <number>px`, `padding: <number>px`, and `z-index: <number>` recipes from shared UI and global chrome. Keep the approved code-surface exemptions narrow.

- [ ] **Step 4: Run the final style audit**

Run:

```bash
rg -n "rgba\\(|border-radius:\\s*(?:999px|9999px)|z-index:\\s*\\d+|gap:\\s*\\d+px|padding:\\s*\\d+px" \
  packages/web/src/styles \
  packages/web/src/components/ui
```

Expected:

- Only token definitions and approved code-surface exemptions remain.

Then rerun the focused style suite:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/styles/foundations.guard.test.ts
```

Expected:

- PASS.

- [ ] **Step 5: Commit the guardrail**

```bash
git add packages/web/src/styles/foundations.guard.test.ts packages/web/src/styles/base.css packages/web/src/styles/components.css
git commit -m "feat(web): add foundation guardrails"
```

