# PC Style Polish Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the remaining desktop settings chrome gaps and expand desktop UI review coverage with deeper workspace states.

**Architecture:** Keep the phase-1 page structure intact, then layer a desktop-only settings header shell on top of the existing settings route while preserving the mobile header path. Extend `ui-preview` with isolated desktop review scenes for workspace editor and diff states so future visual review covers more than empty and launcher states.

**Tech Stack:** React, TypeScript, Jotai, Vitest, Playwright `e2e-ui`, CSS tokens in `packages/web/src/styles`

---

### Task 1: Add a dedicated desktop settings header shell

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [x] **Step 1: Write the failing tests**

Add a desktop-only assertion in `settings-page.test.tsx` that checks:
- `.settings-header__desktop` renders on desktop
- `.settings-header .mobile-page-header` is absent on desktop
- the current section pill shows the active section label

Add CSS assertions in `components.theme.test.ts` that check:
- `.settings-header__desktop` uses a centered max-width layout
- `.settings-header__section-pill` uses elevated panel styling
- mobile header assertions still target `.mobile-page-header`

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts`

Expected:
- settings page test fails because desktop header selectors do not exist
- theme test fails because new desktop header selectors are missing

- [x] **Step 3: Implement the desktop settings header**

In `settings-page.tsx`:
- render `MobilePageHeader` only for mobile
- add a desktop header block with back action, product/title copy, active section summary, and a section pill using the active section icon

In `components.css`:
- keep existing mobile overrides intact
- add `.settings-header__desktop`, `.settings-header__copy`, `.settings-header__summary`, `.settings-header__section-pill`, and related desktop-only spacing/alignment rules

- [x] **Step 4: Re-run the focused tests and verify green**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts`

Expected:
- both test files pass with `0 failed`

### Task 2: Expand desktop UI review coverage to editor and diff states

**Files:**
- Modify: `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx`
- Modify: `packages/web/src/ui-preview/scene-metadata.ts`
- Modify: `packages/web/src/ui-preview/scene-metadata.test.ts`
- Modify: `packages/web/src/ui-preview/catalog.test.tsx`

- [x] **Step 1: Write the failing tests**

Add metadata assertions for two new scene ids:
- `workspace-editor-review`
- `workspace-diff-review`

Add catalog render tests that check:
- editor review renders a desktop review card plus code editor chrome
- diff review renders a desktop review card plus git diff content

- [x] **Step 2: Run the focused preview tests and verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`

Expected:
- metadata test fails because the new scene ids are not registered
- catalog test fails because the new scenes do not exist yet

- [x] **Step 3: Implement the new desktop review scenes**

In `desktop-review-scenes.tsx`:
- add helper state for a realistic code editor view
- add `workspace-editor-review` with a preloaded text editor surface
- add `workspace-diff-review` with a populated `GitDiffViewer`

In `scene-metadata.ts`:
- register both scenes as desktop-only review entries with `.desktop-review-card` capture selectors

- [x] **Step 4: Re-run the focused preview tests and verify green**

Run: `pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`

Expected:
- both preview test files pass with `0 failed`

### Task 3: Run regression verification for the phase-2 polish slice

**Files:**
- No code changes required unless regressions surface

- [x] **Step 1: Re-run targeted component and preview tests**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx src/features/workspace/index.test.tsx src/features/command-palette/components/command-palette.test.tsx`

Expected:
- all selected tests pass

- [x] **Step 2: Re-run targeted desktop captures**

Run: `pnpm --dir e2e-ui exec playwright test --config playwright.config.ts --project desktop --workers 4 --grep '(settings-light-theme-review|settings-density-review|workspace-editor-review|workspace-diff-review|workspace-topbar-review|workspace-terminal-empty-review|desktop-overlay-review|desktop-statusbar-review) \\[desktop/'`

Expected:
- desktop review capture matrix passes for the touched scenes

- [x] **Step 3: Rebuild the report**

Run: `pnpm --dir e2e-ui exec tsx report/build-report.ts`

Expected:
- report command exits `0`

## Verification Notes

- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts`
  - Result: `Test Files 2 passed (2)`, `Tests 102 passed (102)`
- `pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`
  - Result: `Test Files 2 passed (2)`, `Tests 25 passed (25)`
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx src/features/workspace/index.test.tsx src/features/command-palette/components/command-palette.test.tsx`
  - Result: `Test Files 6 passed (6)`, `Tests 149 passed (149)`
- `pnpm --dir e2e-ui exec playwright test --config playwright.config.ts --project desktop --workers 4 --grep '(settings-light-theme-review|settings-density-review|workspace-editor-review|workspace-diff-review|workspace-topbar-review|workspace-terminal-empty-review|desktop-overlay-review|desktop-statusbar-review) \\[desktop/'`
  - Result: `120 passed (7.8m)`
- `pnpm --dir e2e-ui exec tsx report/build-report.ts`
  - Result: exited `0`
