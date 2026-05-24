# Semantic Color System Big-Bang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current mixed color APIs in `packages/web` with one semantic color system so components only consume sanctioned semantic/material/domain tokens and never hardcode or locally compute color behavior.

**Architecture:** Rebuild `packages/web/src/styles/tokens.css` into four layers: private reference colors, public semantic colors, material outputs that absorb glass/opacity runtime inputs, and domain/component-role tokens for git/diff/icon/control/status usage. Migrate consumers in `base.css`, `components.css`, and shared UI modules onto those tokens in slices, keep temporary migration aliases only inside `tokens.css`, then delete the old public token interface after all consumers are moved and the guard tests prove the boundary is closed.

**Tech Stack:** React 19, TypeScript, CSS custom properties, CSS Modules, Vitest, Vite, Testing Library, pnpm workspace scripts.

---

**Spec reference:** `docs/superpowers/specs/2026-05-24-semantic-color-system-big-bang-design.md`

**Git hygiene:** The current worktree is clean. Commit this plan on the current branch first, then create an isolated worktree under `.worktrees/` for implementation. Never revert unrelated edits if any appear later.

## File Structure

**Modified files**
- `packages/web/src/styles/tokens.css`
  - Rebuild the color contract into reference, semantic, material, and domain/component-role layers.
  - Keep migration-only aliases during the middle tasks and delete them in Task 8.
- `packages/web/src/styles/tokens-touch.test.ts`
  - Lock the new token layer, glass/high-contrast overrides, and legacy-token removal.
- `packages/web/src/styles/base.css`
  - Rebind links, selections, loading shells, and themed icon utilities to semantic/material/domain tokens.
- `packages/web/src/styles/base.theme.test.ts`
  - Assert the new base-shell and icon token usage.
- `packages/web/src/styles/components.css`
  - Migrate shared shells, workspace surfaces, feature surfaces, git/diff/status treatments, and remaining global consumers off raw colors and legacy tokens.
- `packages/web/src/styles/components.theme.test.ts`
  - Assert the migrated selectors and runtime-aware material behavior.
- `packages/web/src/styles/foundations.guard.test.ts`
  - Keep the existing shared-foundation guard working while color-specific guardrails move into the new test below.
- `packages/web/src/styles/color-system.guard.test.ts`
  - New migration guard that tracks raw color usage, forbidden runtime/material references, and legacy public token consumption until the final state is empty.
- `packages/web/src/components/ui/workbench-layer/index.module.css`
  - Replace direct backdrop runtime usage with material tokens.
- `packages/web/src/components/ui/button/index.module.css`
- `packages/web/src/components/ui/icon-button/index.module.css`
- `packages/web/src/components/ui/input/index.module.css`
- `packages/web/src/components/ui/textarea/index.module.css`
- `packages/web/src/components/ui/tabs/index.module.css`
- `packages/web/src/components/ui/segmented-control/index.module.css`
- `packages/web/src/components/ui/kbd/index.module.css`
- `packages/web/src/components/ui/switch/index.module.css`
- `packages/web/src/components/ui/spinner/index.module.css`
- `packages/web/src/components/ui/action-menu/index.module.css`
- `packages/web/src/components/ui/datetime-picker/index.module.css`
- `packages/web/src/components/ui/tag/index.module.css`
- `packages/web/src/components/ui/badge/index.module.css`
- `packages/web/src/components/ui/pill/index.module.css`
- `packages/web/src/components/ui/notice/index.module.css`
- `packages/web/src/components/ui/toast/index.module.css`
- `packages/web/src/components/ui/status-dot/index.module.css`
- `packages/web/src/components/ui/tooltip/index.module.css`
- `packages/web/src/components/ui/modal/index.module.css`
- `packages/web/src/components/ui/drawer/index.module.css`
- `packages/web/src/components/ui/local-overlay/index.module.css`
- `packages/web/src/components/ui/popover/index.module.css`
- `packages/web/src/components/ui/progress-bar/index.module.css`
- `packages/web/src/components/ui/empty-state/index.module.css`
- `packages/web/src/components/ui/confirm-dialog/index.module.css`
  - Rebind shared UI modules so they consume only semantic/domain/component-role tokens.
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/registry.test.ts`
  - Preserve Monaco/xterm/icon protocol colors as the sanctioned exception layer and keep transparent workspace editor backgrounds.
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- `packages/web/src/features/code-editor/components/monaco-diff-host.test.tsx`
  - Preserve the protocol exception boundary while keeping workspace-rendered content transparent and color-system compliant.

**Created files**
- `packages/web/src/styles/color-system.guard.test.ts`
  - Dedicated guardrail for raw colors, runtime-variable leaks, reference-token leaks, and legacy interface leaks.

**Testing commands used in this plan**
- `pnpm --filter @coder-studio/web exec vitest run src/styles/color-system.guard.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts src/styles/base.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx src/theme/registry.test.ts src/features/code-editor/components/monaco-host.test.tsx src/features/code-editor/components/monaco-diff-host.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run`
- `pnpm ci:test:workspace`
- `pnpm ci:typecheck`
- `pnpm ci:lint`

---

### Task 1: Add Migration Guardrails For The Color-System Rewrite

**Files:**
- Create: `packages/web/src/styles/color-system.guard.test.ts`
- Modify: `packages/web/src/styles/foundations.guard.test.ts`
- Test: `packages/web/src/styles/color-system.guard.test.ts`

- [ ] **Step 1: Write the failing migration guard**

Create `packages/web/src/styles/color-system.guard.test.ts` with an empty expected-inventory so the first run fails and shows the current leakage set:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = [
  "src/styles/base.css",
  "src/styles/components.css",
  "src/components/ui/workbench-layer/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/drawer/index.module.css",
  "src/components/ui/local-overlay/index.module.css",
  "src/components/ui/popover/index.module.css",
  "src/components/ui/progress-bar/index.module.css",
  "src/components/ui/empty-state/index.module.css",
  "src/components/ui/confirm-dialog/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);

const rawColorPattern =
  /#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(|\bblur\(\d/;
const runtimePattern = /--app-surface-opacity|--app-surface-backdrop-filter|data-appearance-glass/;
const privateRefPattern = /var\(--ref-/;
const legacyPublicPattern = /var\(--(?:bg-|accent-|color-|ws-)/;

function offenders(pattern: RegExp) {
  return files.filter(([, source]) => pattern.test(source)).map(([file]) => file).sort();
}

describe("color-system migration guard", () => {
  it("tracks the remaining raw-color consumers explicitly", () => {
    expect(offenders(rawColorPattern)).toEqual([]);
  });

  it("tracks the remaining runtime appearance consumers explicitly", () => {
    expect(offenders(runtimePattern)).toEqual([]);
  });

  it("forbids private reference tokens outside tokens.css", () => {
    expect(offenders(privateRefPattern)).toEqual([]);
  });

  it("tracks the remaining legacy public token consumers explicitly", () => {
    expect(offenders(legacyPublicPattern)).toEqual([]);
  });
});
```

Also update `packages/web/src/styles/foundations.guard.test.ts` so the shared UI list includes every module this migration touches:

```ts
const sharedUiSources = [
  "src/components/ui/button/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/popover/index.module.css",
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/badge/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/tooltip/index.module.css",
  "src/components/ui/notice/index.module.css",
  "src/components/ui/modal/index.module.css",
  "src/components/ui/drawer/index.module.css",
  "src/components/ui/toast/index.module.css",
  "src/components/ui/local-overlay/index.module.css",
  "src/components/ui/progress-bar/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/empty-state/index.module.css",
  "src/components/ui/confirm-dialog/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/spinner/index.module.css",
].map((file) => [file, readFileSync(`${process.cwd()}/${file}`, "utf8")] as const);
```

- [ ] **Step 2: Run the guard to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/color-system.guard.test.ts
```

Expected:
- FAIL because the repo still contains raw colors, runtime-variable leaks, and legacy token consumers.

- [ ] **Step 3: Convert the new test into an explicit migration inventory**

Replace the empty arrays with the exact current migration set so the test locks scope instead of staying red for the whole rewrite:

```ts
const expectedRawColorConsumers = [
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/pill/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

const expectedRuntimeConsumers = [
  "src/components/ui/workbench-layer/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

const expectedLegacyPublicConsumers = [
  "src/components/ui/action-menu/index.module.css",
  "src/components/ui/button/index.module.css",
  "src/components/ui/datetime-picker/index.module.css",
  "src/components/ui/icon-button/index.module.css",
  "src/components/ui/input/index.module.css",
  "src/components/ui/kbd/index.module.css",
  "src/components/ui/segmented-control/index.module.css",
  "src/components/ui/spinner/index.module.css",
  "src/components/ui/status-dot/index.module.css",
  "src/components/ui/switch/index.module.css",
  "src/components/ui/tabs/index.module.css",
  "src/components/ui/tag/index.module.css",
  "src/components/ui/textarea/index.module.css",
  "src/styles/base.css",
  "src/styles/components.css",
];

it("tracks the remaining raw-color consumers explicitly", () => {
  expect(offenders(rawColorPattern)).toEqual(expectedRawColorConsumers);
});

it("tracks the remaining runtime appearance consumers explicitly", () => {
  expect(offenders(runtimePattern)).toEqual(expectedRuntimeConsumers);
});

it("tracks the remaining legacy public token consumers explicitly", () => {
  expect(offenders(legacyPublicPattern)).toEqual(expectedLegacyPublicConsumers);
});
```

Leave the private-reference test hard-failing on `[]`; no consumer should be allowed to touch `--ref-*` during any phase.

- [ ] **Step 4: Run the guard again**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/color-system.guard.test.ts src/styles/foundations.guard.test.ts
```

Expected:
- PASS with the migration inventory fixed in place.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/color-system.guard.test.ts packages/web/src/styles/foundations.guard.test.ts
git commit -m "test(web): add semantic color migration guardrails"
```

### Task 2: Rebuild `tokens.css` Into Reference, Semantic, Material, And Domain Layers

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Test: `packages/web/src/styles/tokens-touch.test.ts`

- [ ] **Step 1: Write the failing token assertions**

Add these tests to `packages/web/src/styles/tokens-touch.test.ts` after the current workspace-material coverage:

```ts
  it("defines the semantic color system layers on :root", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--ref-fg-0:");
    expect(root).toContain("--ref-bg-0:");
    expect(root).toContain("--ref-border-0:");
    expect(root).toContain("--ref-status-success:");

    expect(root).toContain("--text-primary: var(--ref-fg-0)");
    expect(root).toContain("--surface-page: var(--ref-bg-0)");
    expect(root).toContain("--border-default: var(--ref-border-0)");
    expect(root).toContain("--status-success-fg: var(--ref-status-success)");

    expect(root).toContain("--material-panel:");
    expect(root).toContain("--material-overlay:");
    expect(root).toContain("--material-backdrop-filter:");
    expect(root).toContain("--workspace-sidebar-surface:");
    expect(root).toContain("--workspace-editor-toolbar-surface:");

    expect(root).toContain("--git-status-added-bg:");
    expect(root).toContain("--diff-added-bg:");
    expect(root).toContain("--icon-primary:");
    expect(root).toContain("--control-primary-bg:");
    expect(root).toContain("--field-ring:");
    expect(root).toContain("--tag-info-bg:");
    expect(root).toContain("--status-dot-running-ring-2:");
  });

  it("keeps the glass/high-contrast material outputs in the token layer", () => {
    const glassRoot = getRuleBlock(':root[data-appearance-glass="on"]');
    const highContrastDark = getRuleBlock(':root[data-theme="hc-dark"]');

    expect(glassRoot).toContain("--material-backdrop-filter: var(--app-surface-backdrop-filter, none)");
    expect(glassRoot).toContain("--material-panel: color-mix(");
    expect(glassRoot).toContain("--workspace-sidebar-surface: var(--material-elevated)");
    expect(glassRoot).toContain("--workspace-terminal-shell-surface: var(--material-elevated)");

    expect(highContrastDark).toContain("--material-backdrop-filter: none");
    expect(highContrastDark).toContain("--material-panel: var(--surface-panel)");
    expect(highContrastDark).toContain("--workspace-sidebar-surface: var(--surface-panel)");
  });

  it("keeps temporary legacy aliases inside tokens.css only during migration", () => {
    const root = getRuleBlock(":root");

    expect(root).toContain("--bg-page: var(--surface-page)");
    expect(root).toContain("--accent-blue: var(--status-info-fg)");
    expect(root).toContain("--color-error: var(--status-danger-fg)");
    expect(root).toContain("--ws-sidebar-bg: var(--workspace-sidebar-surface)");
  });
```

- [ ] **Step 2: Run the token test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:
- FAIL because the new `--ref-*`, `--material-*`, `--workspace-*`, and domain/component-role tokens do not exist yet.

- [ ] **Step 3: Rebuild `tokens.css` with the new layered contract**

At the top of `:root`, replace the current color definitions with this new structure. Keep spacing, typography, radius, z-index, and non-color foundation tokens intact:

```css
  /* Private reference layer */
  --ref-fg-0: #e5edf3;
  --ref-fg-1: #9fb0bc;
  --ref-fg-2: #728492;
  --ref-fg-3: #4a5b6a;
  --ref-fg-inverse: #0a1014;
  --ref-bg-0: #0a1014;
  --ref-bg-1: #11181f;
  --ref-bg-2: #0d141a;
  --ref-bg-3: #151f28;
  --ref-bg-4: #1a2632;
  --ref-bg-5: #1e3040;
  --ref-bg-6: #22303c;
  --ref-border-0: #1e2a35;
  --ref-border-1: #263545;
  --ref-border-2: #314454;
  --ref-border-focus: #6cb6ff;
  --ref-border-danger: #ff9eb0;
  --ref-status-success: #78d7b2;
  --ref-status-warning: #f1b86a;
  --ref-status-danger: #ff9eb0;
  --ref-status-info: #6cb6ff;

  /* Public semantic layer */
  --text-primary: var(--ref-fg-0);
  --text-secondary: var(--ref-fg-1);
  --text-tertiary: var(--ref-fg-2);
  --text-disabled: var(--ref-fg-3);
  --text-inverse: var(--ref-fg-inverse);
  --text-link: var(--ref-status-info);
  --text-link-hover: color-mix(in srgb, var(--ref-status-info) 82%, white 18%);

  --surface-page: var(--ref-bg-0);
  --surface-panel: color-mix(in srgb, var(--ref-bg-1) 94%, var(--ref-bg-0));
  --surface-elevated: color-mix(in srgb, var(--ref-bg-1) 98%, white 2%);
  --surface-input: var(--ref-bg-2);
  --surface-muted: var(--ref-bg-2);
  --surface-hover: var(--ref-bg-4);
  --surface-active: var(--ref-bg-5);
  --surface-disabled: var(--ref-bg-3);

  --border-default: var(--ref-border-0);
  --border-subtle: var(--ref-border-1);
  --border-strong: var(--ref-border-2);
  --border-focus: var(--ref-border-focus);
  --border-danger: var(--ref-border-danger);

  --status-success-fg: var(--ref-status-success);
  --status-success-bg: color-mix(in srgb, var(--ref-status-success) 18%, var(--surface-panel));
  --status-success-border: color-mix(in srgb, var(--ref-status-success) 48%, var(--border-default));
  --status-success-icon: var(--ref-status-success);
  --status-warning-fg: var(--ref-status-warning);
  --status-warning-bg: color-mix(in srgb, var(--ref-status-warning) 18%, var(--surface-panel));
  --status-warning-border: color-mix(in srgb, var(--ref-status-warning) 48%, var(--border-default));
  --status-warning-icon: var(--ref-status-warning);
  --status-danger-fg: var(--ref-status-danger);
  --status-danger-bg: color-mix(in srgb, var(--ref-status-danger) 18%, var(--surface-panel));
  --status-danger-border: color-mix(in srgb, var(--ref-status-danger) 48%, var(--border-default));
  --status-danger-icon: var(--ref-status-danger);
  --status-info-fg: var(--ref-status-info);
  --status-info-bg: color-mix(in srgb, var(--ref-status-info) 18%, var(--surface-panel));
  --status-info-border: color-mix(in srgb, var(--ref-status-info) 48%, var(--border-default));
  --status-info-icon: var(--ref-status-info);
```

Then define the material layer and the workspace outputs so runtime inputs are consumed only here:

```css
  --material-backdrop-filter: none;
  --material-panel: var(--surface-panel);
  --material-elevated: var(--surface-elevated);
  --material-overlay: color-mix(
    in srgb,
    var(--surface-elevated) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );
  --material-local-overlay: color-mix(
    in srgb,
    var(--surface-panel) calc(var(--app-surface-opacity, 0.92) * 100%),
    transparent
  );
  --material-shell-page: color-mix(
    in srgb,
    var(--surface-page) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );
  --material-shell-topbar: color-mix(
    in srgb,
    var(--surface-elevated) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );

  --workspace-sidebar-surface: var(--surface-panel);
  --workspace-activitybar-surface: var(--surface-panel);
  --workspace-statusbar-surface: var(--surface-panel);
  --workspace-session-surface: var(--surface-panel);
  --workspace-session-active-surface: var(--surface-elevated);
  --workspace-session-header-surface: var(--surface-elevated);
  --workspace-terminal-shell-surface: var(--surface-panel);
  --workspace-terminal-toolbar-surface: var(--surface-elevated);
  --workspace-terminal-tabs-surface: var(--surface-elevated);
  --workspace-editor-shell-surface: var(--surface-panel);
  --workspace-editor-toolbar-surface: var(--surface-elevated);
  --workspace-content-surface: transparent;
```

Then add domain/component-role tokens that consumers will use instead of local formulas:

```css
  --git-status-added-fg: var(--status-success-fg);
  --git-status-added-bg: var(--status-success-bg);
  --git-status-added-border: var(--status-success-border);
  --git-status-modified-fg: var(--status-warning-fg);
  --git-status-modified-bg: var(--status-warning-bg);
  --git-status-modified-border: var(--status-warning-border);
  --git-status-deleted-fg: var(--status-danger-fg);
  --git-status-deleted-bg: var(--status-danger-bg);
  --git-status-deleted-border: var(--status-danger-border);
  --git-status-untracked-fg: var(--status-info-fg);
  --git-status-untracked-bg: var(--status-info-bg);
  --git-status-untracked-border: var(--status-info-border);
  --git-status-renamed-fg: var(--status-info-fg);
  --git-status-renamed-bg: var(--status-info-bg);
  --git-status-renamed-border: var(--status-info-border);

  --diff-added-bg: var(--status-success-bg);
  --diff-added-border: var(--status-success-border);
  --diff-modified-bg: var(--status-info-bg);
  --diff-modified-border: var(--status-info-border);
  --diff-deleted-bg: var(--status-danger-bg);
  --diff-deleted-border: var(--status-danger-border);

  --icon-primary: var(--text-primary);
  --icon-secondary: var(--text-secondary);
  --icon-muted: var(--text-tertiary);
  --icon-success: var(--status-success-icon);
  --icon-warning: var(--status-warning-icon);
  --icon-error: var(--status-danger-icon);
  --icon-info: var(--status-info-icon);
  --icon-surface-subtle: color-mix(in srgb, var(--text-secondary) 18%, var(--surface-panel));
  --icon-surface-info: color-mix(in srgb, var(--status-info-fg) 24%, var(--surface-panel));

  --control-focus-ring: 0 0 0 calc(var(--state-focus-ring-width) * 2)
    color-mix(in srgb, var(--border-focus) 35%, transparent);
  --control-primary-bg: var(--status-info-fg);
  --control-primary-bg-hover: color-mix(in srgb, var(--status-info-fg) 84%, white 16%);
  --control-primary-fg: var(--text-inverse);
  --control-secondary-bg: color-mix(in srgb, var(--surface-panel) 84%, var(--status-info-fg) 16%);
  --control-secondary-bg-hover: color-mix(in srgb, var(--surface-hover) 72%, var(--status-info-fg) 28%);
  --control-secondary-border: color-mix(in srgb, var(--border-default) 70%, var(--status-info-fg) 30%);
  --control-secondary-border-hover: color-mix(in srgb, var(--border-subtle) 70%, var(--status-info-fg) 30%);
  --control-ghost-bg-hover: var(--surface-hover);
  --control-ghost-fg: var(--text-secondary);
  --control-danger-bg: var(--status-danger-fg);
  --control-danger-fg: var(--text-inverse);
  --control-spinner-track: color-mix(in srgb, currentColor 30%, var(--surface-page) 70%);

  --field-bg: var(--surface-page);
  --field-border: var(--border-default);
  --field-border-hover: var(--border-subtle);
  --field-ring: 0 0 0 var(--state-focus-ring-width)
    color-mix(in srgb, var(--border-focus) 40%, transparent);
  --field-invalid-ring: 0 0 0 1px color-mix(in srgb, var(--border-danger) 70%, transparent 30%);
  --kbd-surface: color-mix(in srgb, var(--surface-input) 82%, var(--surface-panel) 18%);
  --menu-danger-hover-bg: color-mix(in srgb, var(--status-danger-fg) 10%, var(--surface-panel));

  --tag-info-bg: color-mix(in srgb, var(--status-info-fg) 15%, transparent);
  --tag-info-fg: var(--status-info-fg);
  --tag-success-bg: color-mix(in srgb, var(--status-success-fg) 15%, transparent);
  --tag-success-fg: var(--status-success-fg);
  --tag-warning-bg: color-mix(in srgb, var(--status-warning-fg) 15%, transparent);
  --tag-warning-fg: var(--status-warning-fg);
  --tag-danger-bg: color-mix(in srgb, var(--status-danger-fg) 15%, transparent);
  --tag-danger-fg: var(--status-danger-fg);
  --tag-accent-bg: color-mix(in srgb, var(--text-secondary) 15%, transparent);
  --tag-accent-fg: var(--text-secondary);

  --status-dot-idle: var(--text-tertiary);
  --status-dot-starting: var(--status-warning-fg);
  --status-dot-running: var(--status-info-fg);
  --status-dot-complete: var(--status-success-fg);
  --status-dot-error: var(--status-danger-fg);
  --status-dot-running-ring-1: color-mix(in srgb, var(--status-info-fg) 26%, transparent);
  --status-dot-running-ring-2: color-mix(in srgb, var(--status-info-fg) 12%, transparent);
  --status-dot-running-ring-3: color-mix(in srgb, var(--status-info-fg) 22%, transparent);
```

Finally, add migration-only aliases at the bottom of each theme block and root block. These aliases are allowed only until Task 8:

```css
  /* Migration-only aliases; delete in Task 8. */
  --bg-page: var(--surface-page);
  --bg-surface: var(--surface-panel);
  --bg-input: var(--surface-input);
  --bg-hover: var(--surface-hover);
  --bg-active: var(--surface-active);
  --border: var(--border-default);
  --border-light: var(--border-subtle);
  --border-error: var(--border-danger);
  --accent-blue: var(--status-info-fg);
  --accent-green: var(--status-success-fg);
  --accent-amber: var(--status-warning-fg);
  --accent-pink: var(--status-danger-fg);
  --color-success: var(--status-success-fg);
  --color-warning: var(--status-warning-fg);
  --color-error: var(--status-danger-fg);
  --color-info: var(--status-info-fg);
  --ws-sidebar-bg: var(--workspace-sidebar-surface);
  --ws-activitybar-bg: var(--workspace-activitybar-surface);
  --ws-statusbar-bg: var(--workspace-statusbar-surface);
  --ws-session-bg: var(--workspace-session-surface);
  --ws-session-active-bg: var(--workspace-session-active-surface);
  --ws-session-header-bg: var(--workspace-session-header-surface);
  --ws-terminal-shell-bg: var(--workspace-terminal-shell-surface);
  --ws-terminal-toolbar-bg: var(--workspace-terminal-toolbar-surface);
  --ws-terminal-tabs-bg: var(--workspace-terminal-tabs-surface);
  --ws-editor-shell-bg: var(--workspace-editor-shell-surface);
  --ws-editor-toolbar-bg: var(--workspace-editor-toolbar-surface);
  --ws-backdrop-filter: var(--material-backdrop-filter);
```

Mirror the same variable schema in every theme selector:
- `:root, [data-theme="mint-dark"]`
- `[data-theme="mint-light"]`
- `[data-theme="graphite-dark"]`
- `[data-theme="graphite-light"]`
- `[data-theme="nord-dark"]`
- `[data-theme="nord-light"]`
- `[data-theme="hc-dark"]`
- `[data-theme="hc-light"]`

Use the current theme palettes as the source of truth while renaming them into the `--ref-*` layer. High-contrast themes must override the material outputs to solid surfaces and `--material-backdrop-filter: none`.

- [ ] **Step 4: Run the token test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts
```

Expected:
- PASS with the new layer assertions and migration aliases locked in.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "refactor(web): add layered semantic color tokens"
```

### Task 3: Migrate `base.css` To Semantic And Material Tokens

**Files:**
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Write the failing base assertions**

Update `packages/web/src/styles/base.theme.test.ts` so the loading shell, links, and icon utilities expect only final semantic/material tokens:

```ts
  it("keeps the app loading shell on semantic material tokens", () => {
    const shell = getRuleBlock(".app-loading-shell");
    const card = getRuleBlock(".app-loading-card");

    expect(shell).toContain("background: var(--material-shell-page)");
    expect(shell).toContain("backdrop-filter: var(--material-backdrop-filter)");
    expect(card).toContain("background: var(--material-overlay)");
    expect(card).toContain("backdrop-filter: var(--material-backdrop-filter)");
    expect(card).toContain("box-shadow: var(--surface-overlay-shadow)");
    expect(shell).not.toContain("--app-surface-opacity");
    expect(card).not.toContain("--app-surface-backdrop-filter");
  });

  it("maps links and themed icons onto semantic/domain tokens", () => {
    expect(getRuleBlock("a")).toContain("color: var(--text-link)");
    expect(getRuleBlock("a:hover")).toContain("color: var(--text-link-hover)");
    expect(getRuleBlock(".themed-icon--tone-warning")).toContain("color: var(--icon-warning)");
    expect(getRuleBlock(".themed-icon--surface-info")).toContain("background: var(--icon-surface-info)");
  });
```

- [ ] **Step 2: Run the base test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts
```

Expected:
- FAIL because `base.css` still uses `color-mix(...)`, `--app-surface-*`, and legacy accent tokens directly.

- [ ] **Step 3: Rebind `base.css` to the new tokens**

Update the relevant rules in `packages/web/src/styles/base.css`:

```css
a {
  color: var(--text-link);
  text-decoration: none;
  transition: color var(--duration-fast) var(--ease-out);
}

a:hover {
  color: var(--text-link-hover);
}

.app-loading-shell {
  flex: 1;
  display: grid;
  place-items: center;
  padding: var(--sp-8);
  background: var(--material-shell-page);
  backdrop-filter: var(--material-backdrop-filter);
}

.app-loading-card {
  width: min(520px, 100%);
  padding: var(--sp-8);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-overlay);
  background: var(--material-overlay);
  backdrop-filter: var(--material-backdrop-filter);
  box-shadow: var(--surface-overlay-shadow);
}

.themed-icon--tone-error {
  color: var(--icon-error);
}

.themed-icon--surface-subtle {
  background: var(--icon-surface-subtle);
}

.themed-icon--surface-info {
  background: var(--icon-surface-info);
}
```

Then shrink the migration inventory in `packages/web/src/styles/color-system.guard.test.ts` by removing `src/styles/base.css` from both `expectedRawColorConsumers` and `expectedRuntimeConsumers`. Also remove it from `expectedLegacyPublicConsumers`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/base.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- PASS with `base.css` removed from all migration-inventory lists.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/base.css packages/web/src/styles/base.theme.test.ts packages/web/src/styles/color-system.guard.test.ts
git commit -m "refactor(web): move base styles to semantic color tokens"
```

### Task 4: Centralize Shared Shell, Workspace, And Protocol Material Usage

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/components/ui/workbench-layer/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Write the failing workspace/material assertions**

Update `packages/web/src/styles/components.theme.test.ts` so shell consumers expect final material/workspace tokens instead of runtime inputs:

```ts
    expect(settingsContent).toContain("background: var(--material-shell-page)");
    expect(settingsSurface).toContain("background: var(--material-overlay)");
    expect(appTopbar).toContain("background: var(--material-shell-topbar)");
    expect(appTopbar).toContain("backdrop-filter: var(--material-backdrop-filter)");
    expect(workspaceSidebarPanel).toContain("background: var(--workspace-sidebar-surface)");
    expect(workspaceActivityBar).toContain("background: var(--workspace-activitybar-surface)");
    expect(workspaceStatusBar).toContain("background: var(--workspace-statusbar-surface)");
    expect(sessionCard).toContain("background: var(--workspace-session-surface)");
    expect(activeSessionCard).toContain("background: var(--workspace-session-active-surface)");
    expect(activeSessionHeader).toContain("background: var(--workspace-session-header-surface)");
    expect(terminalToolbar).toContain("background: var(--workspace-terminal-toolbar-surface)");
    expect(bottomTerminalTabs).toContain("background: var(--workspace-terminal-tabs-surface)");
    expect(bottomTerminal).toContain("background: var(--workspace-terminal-shell-surface)");
    expect(bottomTerminalContent).toContain("background: var(--workspace-content-surface)");
    expect(bottomTerminalXterm).toContain("background: var(--workspace-content-surface)");
    expect(xtermScreen).toContain("background: transparent");
    expect(mobileTopbar).toContain("background: var(--material-shell-topbar)");
    expect(mobileBottomStack).toContain("background: var(--material-overlay)");
```

Update the workbench-layer expectation too:

```ts
    expect(backdrop).toContain("background: var(--surface-overlay-backdrop)");
    expect(backdrop).toContain("backdrop-filter: var(--material-backdrop-filter)");
```

Update `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` so the xterm theme keeps a transparent workspace background:

```ts
    expect(theme.background).toBe("#00000000");
    expect(theme.foreground).toBeDefined();
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:
- FAIL because the shared shells still reference `--app-surface-*`, `--ws-*`, and local `color-mix(...)` formulas.

- [ ] **Step 3: Migrate shared shell and workspace consumers**

Update `packages/web/src/styles/components.css`:

```css
.settings-content {
  background: var(--material-shell-page);
}

.settings-content-surface {
  background: var(--material-overlay);
  backdrop-filter: var(--material-backdrop-filter);
}

.app-topbar,
.mobile-topbar {
  background: var(--material-shell-topbar);
  backdrop-filter: var(--material-backdrop-filter);
}

.workspace-sidebar-panel {
  background: var(--workspace-sidebar-surface);
  border-right: 1px solid color-mix(in srgb, var(--border-default) 72%, transparent);
  backdrop-filter: var(--material-backdrop-filter);
}

.workspace-activity-bar {
  background: var(--workspace-activitybar-surface);
  border-right-color: color-mix(in srgb, var(--border-default) 72%, transparent);
  backdrop-filter: var(--material-backdrop-filter);
}

.workspace-status-bar {
  background: var(--workspace-statusbar-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.session-card {
  background: var(--workspace-session-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.session-card.session-card--active {
  background: var(--workspace-session-active-surface);
}

.session-header,
.session-card.session-card--active > .panel-header,
.session-card.session-card--active .session-header {
  background: var(--workspace-session-header-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.terminal-toolbar {
  background: var(--workspace-terminal-toolbar-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.bottom-terminal-tabs {
  background: var(--workspace-terminal-tabs-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.workspace-bottom-panel > .bottom-terminal {
  background: var(--workspace-terminal-shell-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.bottom-terminal-content,
.bottom-terminal-xterm,
.bottom-terminal-empty,
.workspace-sidebar-panel__content,
.workspace-sidebar-view,
.workspace-sidebar-panel__body,
.workspace-body,
.workspace-main-stage,
.agent-panes,
.agent-pane,
.pane-layout,
.pane-layout-child {
  background: var(--workspace-content-surface);
}
```

Update `packages/web/src/components/ui/workbench-layer/index.module.css`:

```css
.backdrop,
:global(.workbench-layer-backdrop) {
  background: var(--surface-overlay-backdrop);
  backdrop-filter: var(--material-backdrop-filter);
}
```

Update `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` so the workspace theme background stays transparent and protocol colors remain in `theme/registry.ts`:

```ts
const theme = {
  ...resolvedTheme.terminalTheme,
  background: "#00000000",
};
```

Shrink `packages/web/src/styles/color-system.guard.test.ts` by removing:
- `src/styles/components.css` from `expectedRuntimeConsumers` only if all direct `--app-surface-*` usage is gone.
- `src/components/ui/workbench-layer/index.module.css` from `expectedRuntimeConsumers`.

Do not remove `src/styles/components.css` from `expectedRawColorConsumers` yet; the file still contains many feature-level formulas at this stage.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/features/terminal-panel/__tests__/xterm-host.test.tsx src/styles/color-system.guard.test.ts
```

Expected:
- PASS with runtime/material usage centralized in the token layer.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/components.css packages/web/src/components/ui/workbench-layer/index.module.css packages/web/src/styles/components.theme.test.ts packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx packages/web/src/styles/color-system.guard.test.ts
git commit -m "refactor(web): centralize workspace material tokens"
```

### Task 5: Migrate Shared Input And Control Modules

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/components/ui/button/index.module.css`
- Modify: `packages/web/src/components/ui/icon-button/index.module.css`
- Modify: `packages/web/src/components/ui/input/index.module.css`
- Modify: `packages/web/src/components/ui/textarea/index.module.css`
- Modify: `packages/web/src/components/ui/tabs/index.module.css`
- Modify: `packages/web/src/components/ui/segmented-control/index.module.css`
- Modify: `packages/web/src/components/ui/kbd/index.module.css`
- Modify: `packages/web/src/components/ui/switch/index.module.css`
- Modify: `packages/web/src/components/ui/spinner/index.module.css`
- Modify: `packages/web/src/components/ui/action-menu/index.module.css`
- Modify: `packages/web/src/components/ui/datetime-picker/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing module assertions**

Add targeted expectations to `packages/web/src/styles/components.theme.test.ts`:

```ts
  it("keeps shared controls on derived component-role tokens", () => {
    expect(buttonStyles).toContain("background: var(--control-primary-bg)");
    expect(buttonStyles).toContain("background: var(--control-secondary-bg)");
    expect(buttonStyles).toContain("border-color: var(--control-secondary-border)");
    expect(buttonStyles).toContain("box-shadow: var(--control-focus-ring)");

    expect(iconButtonStyles).toContain("background: var(--control-secondary-bg)");
    expect(iconButtonStyles).toContain("border-color: var(--control-secondary-border)");

    expect(inputStyles).toContain("background: var(--field-bg)");
    expect(inputStyles).toContain("border: 1px solid var(--field-border)");
    expect(inputStyles).toContain("box-shadow: var(--field-ring)");

    expect(textareaStyles).toContain("background: var(--field-bg)");
    expect(segmentedControlStylesheet).toContain("background: var(--control-secondary-bg)");
    expect(kbdStylesheet).toContain("background: var(--kbd-surface)");
    expect(statusDotStylesheet).not.toContain("color-mix(");
  });
```

- [ ] **Step 2: Run the module test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- FAIL because these modules still use `color-mix(...)` and legacy `--bg-*` / `--accent-*` tokens directly.

- [ ] **Step 3: Rebind the shared control modules**

Use the component-role tokens added in Task 2 and update the modules accordingly.

`packages/web/src/components/ui/button/index.module.css`

```css
.btn:focus-visible,
:global(.btn):focus-visible {
  box-shadow: 0 0 0 2px var(--surface-page), var(--control-focus-ring);
}

.primary,
:global(.btn-primary) {
  background: var(--control-primary-bg);
  color: var(--control-primary-fg);
}

.primary:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-primary):hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--control-primary-bg-hover);
}

.secondary,
:global(.btn-default),
:global(.btn-secondary) {
  background: var(--control-secondary-bg);
  border-color: var(--control-secondary-border);
  color: var(--text-primary);
}

.secondary:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-default):hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-secondary):hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--control-secondary-bg-hover);
  border-color: var(--control-secondary-border-hover);
}

.ghost:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-ghost):hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--control-ghost-bg-hover);
  color: var(--text-primary);
}

.danger,
:global(.btn-danger) {
  background: var(--control-danger-bg);
  color: var(--control-danger-fg);
}

.spinner {
  border: calc(var(--sp-1) / 2) solid var(--control-spinner-track);
  border-top-color: currentColor;
}
```

`packages/web/src/components/ui/icon-button/index.module.css`

```css
.filled {
  background: var(--control-secondary-bg);
  border-color: var(--control-secondary-border);
  color: var(--text-primary);
}

.filled:hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--control-secondary-bg-hover);
  border-color: var(--control-secondary-border-hover);
}
```

`packages/web/src/components/ui/input/index.module.css` and `packages/web/src/components/ui/textarea/index.module.css`

```css
.input {
  background: var(--field-bg);
  border: 1px solid var(--field-border);
}

.input:hover {
  border-color: var(--field-border-hover);
}

.input:focus,
.input:focus-visible {
  border-color: var(--border-focus);
  box-shadow: var(--field-ring);
}

.invalid:focus,
.invalid:focus-visible,
.input[aria-invalid="true"]:focus,
.input[aria-invalid="true"]:focus-visible {
  border-color: var(--border-danger);
  box-shadow: var(--field-invalid-ring);
}
```

`packages/web/src/components/ui/kbd/index.module.css`

```css
.root {
  background: var(--kbd-surface);
  border-color: var(--border-subtle);
  box-shadow: inset 0 -1px 0 var(--border-default);
}
```

`packages/web/src/components/ui/action-menu/index.module.css`

```css
.content {
  border: 1px solid var(--border-default);
  background: var(--material-overlay);
}

.item:hover,
.item:focus-visible {
  background: var(--surface-hover);
}

.itemDanger {
  color: var(--status-danger-fg);
}

.itemDanger:hover,
.itemDanger:focus-visible {
  background: var(--menu-danger-hover-bg);
}
```

`packages/web/src/components/ui/segmented-control/index.module.css`, `tabs/index.module.css`, `switch/index.module.css`, `spinner/index.module.css`, and `datetime-picker/index.module.css` should follow the same rule: replace every raw `color-mix(...)`, `--bg-*`, `--accent-*`, and `--color-*` reference with the new `--control-*`, `--field-*`, `--surface-*`, `--border-*`, and `--status-*` tokens.

Then remove these files from `expectedRawColorConsumers` and `expectedLegacyPublicConsumers` in `packages/web/src/styles/color-system.guard.test.ts`:
- `src/components/ui/action-menu/index.module.css`
- `src/components/ui/button/index.module.css`
- `src/components/ui/datetime-picker/index.module.css`
- `src/components/ui/icon-button/index.module.css`
- `src/components/ui/input/index.module.css`
- `src/components/ui/kbd/index.module.css`
- `src/components/ui/segmented-control/index.module.css`
- `src/components/ui/spinner/index.module.css`
- `src/components/ui/switch/index.module.css`
- `src/components/ui/tabs/index.module.css`
- `src/components/ui/textarea/index.module.css`

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- PASS with those shared controls removed from the migration inventory.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/components/ui/button/index.module.css packages/web/src/components/ui/icon-button/index.module.css packages/web/src/components/ui/input/index.module.css packages/web/src/components/ui/textarea/index.module.css packages/web/src/components/ui/tabs/index.module.css packages/web/src/components/ui/segmented-control/index.module.css packages/web/src/components/ui/kbd/index.module.css packages/web/src/components/ui/switch/index.module.css packages/web/src/components/ui/spinner/index.module.css packages/web/src/components/ui/action-menu/index.module.css packages/web/src/components/ui/datetime-picker/index.module.css packages/web/src/styles/components.theme.test.ts packages/web/src/styles/color-system.guard.test.ts
git commit -m "refactor(web): move shared controls to semantic color roles"
```

### Task 6: Migrate Status, Overlay, And Feedback Modules

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/components/ui/tag/index.module.css`
- Modify: `packages/web/src/components/ui/badge/index.module.css`
- Modify: `packages/web/src/components/ui/pill/index.module.css`
- Modify: `packages/web/src/components/ui/notice/index.module.css`
- Modify: `packages/web/src/components/ui/toast/index.module.css`
- Modify: `packages/web/src/components/ui/status-dot/index.module.css`
- Modify: `packages/web/src/components/ui/tooltip/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/drawer/index.module.css`
- Modify: `packages/web/src/components/ui/local-overlay/index.module.css`
- Modify: `packages/web/src/components/ui/popover/index.module.css`
- Modify: `packages/web/src/components/ui/progress-bar/index.module.css`
- Modify: `packages/web/src/components/ui/empty-state/index.module.css`
- Modify: `packages/web/src/components/ui/confirm-dialog/index.module.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing status/domain assertions**

Extend `packages/web/src/styles/components.theme.test.ts`:

```ts
  it("keeps status and overlay modules on semantic/domain tokens", () => {
    expect(tagStyles).toContain("background: var(--tag-info-bg)");
    expect(tagStyles).toContain("color: var(--tag-info-fg)");
    expect(badgeStyles).toContain("background: var(--status-info-fg)");
    expect(pillStylesheet).not.toContain("color-mix(");

    expect(noticeStylesheet).toContain("border-color: var(--status-info-border)");
    expect(noticeStylesheet).toContain("background: var(--status-info-bg)");
    expect(toastStyles).toContain("background: var(--material-overlay)");
    expect(statusDotStylesheet).toContain("background: var(--status-dot-current-color, var(--status-dot-idle))");
    expect(statusDotStylesheet).toContain("var(--status-dot-running-ring-2)");

    expect(modalStylesheet).toContain("background: var(--material-overlay)");
    expect(drawerStylesheet).toContain("background: var(--material-overlay)");
    expect(localOverlayStylesheet).toContain("background: var(--material-local-overlay)");
    expect(progressBarStylesheet).not.toContain("color-mix(");
    expect(confirmDialogStyles).not.toContain("color-mix(");
  });
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- FAIL because the status/feedback modules still use raw formulas and legacy tokens.

- [ ] **Step 3: Rebind the modules to domain/component-role tokens**

`packages/web/src/components/ui/tag/index.module.css`

```css
:where(.blue),
:global(:where(.badge-blue)) {
  background: var(--tag-info-bg);
  color: var(--tag-info-fg);
}

:where(.green),
:global(:where(.badge-green)) {
  background: var(--tag-success-bg);
  color: var(--tag-success-fg);
}

:where(.amber),
:global(:where(.badge-amber)) {
  background: var(--tag-warning-bg);
  color: var(--tag-warning-fg);
}

:where(.pink),
:global(:where(.badge-pink)) {
  background: var(--tag-danger-bg);
  color: var(--tag-danger-fg);
}

:where(.purple),
:global(:where(.badge-purple)),
:where(.neutral),
:global(:where(.badge-gray)) {
  background: var(--tag-accent-bg);
  color: var(--tag-accent-fg);
}
```

`packages/web/src/components/ui/badge/index.module.css`

```css
:where(.badge),
:global(:where(.topbar-unread)) {
  background: var(--status-info-fg);
  color: var(--text-inverse);
}
```

`packages/web/src/components/ui/notice/index.module.css`

```css
.notice {
  border: 1px solid var(--border-default);
  background: var(--material-elevated);
}

.info {
  border-color: var(--status-info-border);
  background: var(--status-info-bg);
}

.success {
  border-color: var(--status-success-border);
  background: var(--status-success-bg);
}

.warning {
  border-color: var(--status-warning-border);
  background: var(--status-warning-bg);
}

.error {
  border-color: var(--status-danger-border);
  background: var(--status-danger-bg);
}
```

`packages/web/src/components/ui/status-dot/index.module.css`

```css
.dot {
  background: var(--status-dot-current-color, var(--status-dot-idle));
  box-shadow: 0 0 0 1px var(--status-dot-current-ring, transparent);
}

:global(.session-dot-starting),
:global(.connection-status-dot-connecting),
:global(.connection-status-dot-reconnecting) {
  --status-dot-current-color: var(--status-dot-starting);
}

:global(.session-dot-running) {
  --status-dot-current-color: var(--status-dot-running);
  --status-dot-current-ring: var(--status-dot-running-ring-1);
  box-shadow:
    0 0 0 1px var(--status-dot-running-ring-1),
    0 0 0 5px var(--status-dot-running-ring-2),
    0 0 12px var(--status-dot-running-ring-3);
}

:global(.connection-status-dot-connected) {
  --status-dot-current-color: var(--status-dot-running);
}

:global(.session-dot-complete) {
  --status-dot-current-color: var(--status-dot-complete);
}

:global(.connection-status-dot-disconnected) {
  --status-dot-current-color: var(--status-dot-error);
}
```

For `toast`, `tooltip`, `modal`, `drawer`, `local-overlay`, `popover`, `progress-bar`, `empty-state`, and `confirm-dialog`, apply the same rule: replace raw formulas with the new `--material-*`, `--surface-*`, `--status-*`, `--border-*`, and `--tag-*` tokens. Keep `transparent`, `currentColor`, `inherit`, and `none` as the only non-token color keywords.

Then remove these files from `expectedRawColorConsumers` and `expectedLegacyPublicConsumers` in `packages/web/src/styles/color-system.guard.test.ts`:
- `src/components/ui/pill/index.module.css`
- `src/components/ui/tag/index.module.css`
- `src/components/ui/badge/index.module.css`
- `src/components/ui/notice/index.module.css`
- `src/components/ui/toast/index.module.css`
- `src/components/ui/status-dot/index.module.css`
- `src/components/ui/tooltip/index.module.css`
- `src/components/ui/modal/index.module.css`
- `src/components/ui/drawer/index.module.css`
- `src/components/ui/local-overlay/index.module.css`
- `src/components/ui/popover/index.module.css`
- `src/components/ui/progress-bar/index.module.css`
- `src/components/ui/empty-state/index.module.css`
- `src/components/ui/confirm-dialog/index.module.css`

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- PASS with the feedback/overlay modules removed from the migration inventory.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/components/ui/tag/index.module.css packages/web/src/components/ui/badge/index.module.css packages/web/src/components/ui/pill/index.module.css packages/web/src/components/ui/notice/index.module.css packages/web/src/components/ui/toast/index.module.css packages/web/src/components/ui/status-dot/index.module.css packages/web/src/components/ui/tooltip/index.module.css packages/web/src/components/ui/modal/index.module.css packages/web/src/components/ui/drawer/index.module.css packages/web/src/components/ui/local-overlay/index.module.css packages/web/src/components/ui/popover/index.module.css packages/web/src/components/ui/progress-bar/index.module.css packages/web/src/components/ui/empty-state/index.module.css packages/web/src/components/ui/confirm-dialog/index.module.css packages/web/src/styles/components.theme.test.ts packages/web/src/styles/color-system.guard.test.ts
git commit -m "refactor(web): move status and overlay modules to semantic tokens"
```

### Task 7: Migrate Remaining Global Feature Consumers In `components.css`

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing feature-surface assertions**

Add focused coverage for the remaining feature/global selectors that currently still rely on raw formulas:

```ts
  it("routes git, diff, banners, and feature shells through domain tokens", () => {
    const worktreeCleanChip = getLastRuleBlock(".worktree-chip-status.worktree-clean");
    const worktreeDirtyChip = getLastRuleBlock(".worktree-chip-status.worktree-dirty");
    const addedLine = getLastRuleBlock(".git-diff-line-added");
    const removedLine = getLastRuleBlock(".git-diff-line-removed");
    const editorHeader = getLastRuleBlock(".code-editor-header");
    const mobileBottomStack = getLastRuleBlock(".mobile-shell__bottom-stack");

    expect(worktreeCleanChip).toContain("color: var(--git-status-added-fg)");
    expect(worktreeCleanChip).toContain("background: var(--git-status-added-bg)");
    expect(worktreeDirtyChip).toContain("color: var(--git-status-modified-fg)");
    expect(worktreeDirtyChip).toContain("background: var(--git-status-modified-bg)");
    expect(addedLine).toContain("background: var(--diff-added-bg)");
    expect(removedLine).toContain("background: var(--diff-deleted-bg)");
    expect(editorHeader).toContain("background: var(--workspace-editor-toolbar-surface)");
    expect(mobileBottomStack).toContain("background: var(--material-overlay)");
  });
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- FAIL because `components.css` still contains raw color formulas and legacy token usage outside the workspace slice.

- [ ] **Step 3: Remove the remaining raw formulas from `components.css`**

Migrate the remaining selectors to domain/component-role tokens. The exact selectors will come from the migration inventory locked in Task 1.

Representative replacements:

```css
.worktree-chip-status.worktree-clean {
  color: var(--git-status-added-fg);
  background: var(--git-status-added-bg);
  border-color: var(--git-status-added-border);
}

.worktree-chip-status.worktree-dirty {
  color: var(--git-status-modified-fg);
  background: var(--git-status-modified-bg);
  border-color: var(--git-status-modified-border);
}

.git-diff-line-added {
  background: var(--diff-added-bg);
  border-color: var(--diff-added-border);
}

.git-diff-line-removed {
  background: var(--diff-deleted-bg);
  border-color: var(--diff-deleted-border);
}

.code-editor-header {
  background: var(--workspace-editor-toolbar-surface);
  backdrop-filter: var(--material-backdrop-filter);
}

.mobile-shell__bottom-stack {
  background: var(--material-overlay);
  backdrop-filter: var(--material-backdrop-filter);
}
```

When a selector currently bakes its own accent mix, add a new derived token in `tokens.css` and consume that token instead of leaving any `color-mix(...)` in `components.css`.

After the migration, `packages/web/src/styles/color-system.guard.test.ts` should have:
- `expectedRuntimeConsumers = []`
- `expectedLegacyPublicConsumers = []`
- `expectedRawColorConsumers = ["src/styles/components.css"]`

That state means `components.css` is the only remaining raw-color consumer and Task 8 can focus on deleting the last migration aliases.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- PASS with `components.css` as the only remaining raw-color inventory entry.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts packages/web/src/styles/color-system.guard.test.ts
git commit -m "refactor(web): migrate global feature surfaces to semantic colors"
```

### Task 8: Remove Legacy Public Color Interfaces And Finish Verification

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Modify: `packages/web/src/styles/color-system.guard.test.ts`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/styles/tokens-touch.test.ts`
- Test: `packages/web/src/styles/color-system.guard.test.ts`
- Test: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing final-state assertions**

Update `packages/web/src/styles/tokens-touch.test.ts` so migration aliases are now forbidden:

```ts
  it("does not expose the legacy public color interface after migration", () => {
    const root = getRuleBlock(":root");

    expect(root).not.toContain("--bg-page:");
    expect(root).not.toContain("--bg-surface:");
    expect(root).not.toContain("--accent-blue:");
    expect(root).not.toContain("--accent-green:");
    expect(root).not.toContain("--accent-amber:");
    expect(root).not.toContain("--accent-pink:");
    expect(root).not.toContain("--color-success:");
    expect(root).not.toContain("--color-warning:");
    expect(root).not.toContain("--color-error:");
    expect(root).not.toContain("--color-info:");
    expect(root).not.toContain("--ws-sidebar-bg:");
    expect(root).not.toContain("--ws-terminal-shell-bg:");
  });
```

Update `packages/web/src/styles/color-system.guard.test.ts` so the final expected inventories are all empty:

```ts
const expectedRawColorConsumers: string[] = [];
const expectedRuntimeConsumers: string[] = [];
const expectedLegacyPublicConsumers: string[] = [];
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/tokens-touch.test.ts src/styles/color-system.guard.test.ts
```

Expected:
- FAIL because `tokens.css` still carries the migration aliases and `components.css` is still listed as a raw-color consumer.

- [ ] **Step 3: Delete the migration aliases and clean the last remaining raw-color usage**

Remove the migration-only alias block from `packages/web/src/styles/tokens.css` completely:

```css
  /* Delete this entire migration-only alias block in the final task. */
  --bg-page: var(--surface-page);
  --bg-surface: var(--surface-panel);
  --bg-input: var(--surface-input);
  --bg-hover: var(--surface-hover);
  --bg-active: var(--surface-active);
  --border: var(--border-default);
  --border-light: var(--border-subtle);
  --border-error: var(--border-danger);
  --accent-blue: var(--status-info-fg);
  --accent-green: var(--status-success-fg);
  --accent-amber: var(--status-warning-fg);
  --accent-pink: var(--status-danger-fg);
  --color-success: var(--status-success-fg);
  --color-warning: var(--status-warning-fg);
  --color-error: var(--status-danger-fg);
  --color-info: var(--status-info-fg);
  --ws-sidebar-bg: var(--workspace-sidebar-surface);
  --ws-activitybar-bg: var(--workspace-activitybar-surface);
  --ws-statusbar-bg: var(--workspace-statusbar-surface);
  --ws-session-bg: var(--workspace-session-surface);
  --ws-session-active-bg: var(--workspace-session-active-surface);
  --ws-session-header-bg: var(--workspace-session-header-surface);
  --ws-terminal-shell-bg: var(--workspace-terminal-shell-surface);
  --ws-terminal-toolbar-bg: var(--workspace-terminal-toolbar-surface);
  --ws-terminal-tabs-bg: var(--workspace-terminal-tabs-surface);
  --ws-editor-shell-bg: var(--workspace-editor-shell-surface);
  --ws-editor-toolbar-bg: var(--workspace-editor-toolbar-surface);
  --ws-backdrop-filter: var(--material-backdrop-filter);
```

Then finish the remaining `components.css` cleanup so the raw-color inventory reaches zero. Every lingering `color-mix(...)`, `rgba(...)`, hardcoded hex, `--bg-*`, `--accent-*`, `--color-*`, and `--ws-*` consumer outside `tokens.css`, `theme/registry.ts`, and the protocol exception in `xterm-host.tsx` must be removed.

- [ ] **Step 4: Run the full verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run
pnpm ci:test:workspace
pnpm ci:typecheck
pnpm ci:lint
```

Expected:
- All tests PASS
- Typecheck PASS
- Lint PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts packages/web/src/styles/color-system.guard.test.ts packages/web/src/styles/base.theme.test.ts packages/web/src/styles/components.theme.test.ts
git commit -m "refactor(web): finalize semantic color system"
```

## Self-Review

- **Spec coverage:** The plan covers the required layering (`tokens.css`), runtime/material centralization, workspace and overlay migration, shared module migration, git/diff/icon/status convergence, and final legacy-interface removal with hard guardrails.
- **Placeholder scan:** No `TODO`, `TBD`, or “handle appropriately” placeholders remain. Every task names files, tests, commands, and representative code to write.
- **Type consistency:** The same final token names are used throughout the plan:
  - private refs: `--ref-*`
  - public semantics: `--text-*`, `--surface-*`, `--border-*`, `--status-*`
  - material: `--material-*`, `--workspace-*`
  - domain/component roles: `--git-*`, `--diff-*`, `--icon-*`, `--control-*`, `--field-*`, `--tag-*`, `--status-dot-*`

Plan complete and saved to `docs/superpowers/plans/2026-05-24-semantic-color-system-big-bang.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints
