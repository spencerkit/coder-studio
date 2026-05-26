# Welcome Step-First Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the welcome page so the two-step workspace flow dominates the screen, desktop actions no longer wrap awkwardly, and short mobile screens can scroll.

**Architecture:** Keep shared welcome shell primitives for auth/not-found intact, then layer a welcome-page-specific layout on top. Update tests first to lock the new DOM and layout contract before changing JSX, copy, and CSS.

**Tech Stack:** React 19, React Router, Jotai, CSS tokens, Vitest, Testing Library

---

### Task 1: Lock the new welcome-page contract in tests

**Files:**
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Test: `packages/web/src/features/welcome/index.test.tsx`

- [ ] Add assertions for a step-first layout with a dedicated workflow section and compact supporting summary.
- [ ] Verify the new test fails before implementation.
- [ ] Keep modal-open and settings-navigation coverage intact.

### Task 2: Implement the step-first welcome layout

**Files:**
- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] Replace the action-wrap layout with a structured hero, workflow, and secondary summary.
- [ ] Keep the primary action opening the workspace launch modal.
- [ ] Keep the secondary action navigating to settings.
- [ ] Reduce welcome-page supporting content from prominent cards to compact summary items.

### Task 3: Rework welcome styling for desktop and short mobile screens

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] Add a welcome-page-specific grid layout for desktop.
- [ ] Add a scrollable mobile shell with tighter spacing and a single-column workflow.
- [ ] Preserve shared auth/not-found shells by limiting changes to welcome-page-specific selectors where possible.
- [ ] Update theme/style assertions for the mobile scroll contract.

### Task 4: Verify targeted regression coverage

**Files:**
- Test: `packages/web/src/features/welcome/index.test.tsx`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] Run `pnpm --filter @coder-studio/web test -- src/features/welcome/index.test.tsx src/styles/components.theme.test.ts`
- [ ] Confirm the updated welcome page behavior and style contract pass together.
