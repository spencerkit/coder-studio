# UI Component Library Phase C Input + Textarea Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue adopting the shared `Input` and `Textarea` primitives across remaining legacy form fields in settings and workspace features.

**Architecture:** Reuse the already-landed `Input` and `Textarea` components as-is. This phase does not expand their API. It only migrates concrete callers that currently rely on raw legacy `.input` styling or raw `<textarea>` markup, preserving feature-specific class names and existing tests.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, CSS Modules for shared components, existing feature CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-07-ui-component-library-input-textarea-adoption-design.md`

---

## File Structure

**Modified files:**
- `packages/web/src/features/settings/components/provider-settings.tsx`
- `packages/web/src/features/settings/components/provider-settings.test.tsx`
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- `packages/web/src/components/ui/MIGRATION.md`

**No changes in this plan:**
- `packages/web/src/components/ui/input/*`
- `packages/web/src/components/ui/textarea/*`
- `packages/web/src/styles/components.css`
- `select.input`, `mobile-select-trigger`, search inputs, command palette inputs

## Task 1: Migrate Settings Callers

**Files:**
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`
- Modify: `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [x] **Step 1: Replace legacy provider textarea**

Change:

```tsx
- <textarea className="input settings-provider-args-input" ... />
+ <Textarea className="settings-provider-args-input" ... />
```

- [x] **Step 2: Replace legacy shortcuts capture input**

Change:

```tsx
- <input className="input shortcuts-capture" ... />
+ <Input className="shortcuts-capture" ... />
```

- [x] **Step 3: Replace legacy supervisor timeout input**

Change:

```tsx
- <input className="input settings-input-compact" type="number" ... />
+ <Input className="settings-input-compact" type="number" ... />
```

- [x] **Step 4: Add or update focused tests**

Assertions should confirm the migrated controls still render and keep the compatibility classes:

- `启动命令参数` textarea has `input textarea settings-provider-args-input`
- `supervisor-evaluation-timeout` input has `input settings-input-compact`

## Task 2: Migrate Workspace Callers

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-status-bar.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

- [x] **Step 1: Replace file-create modal input**

Change the modal path field to `<Input />`.

- [x] **Step 2: Replace git auth username/password inputs**

Change both auth prompt fields to `<Input />`.

- [x] **Step 3: Replace git commit textarea**

Change:

```tsx
- <textarea className="git-commit-input" rows={1} ... />
+ <Textarea className="git-commit-input" rows={1} ... />
```

- [x] **Step 4: Add or update focused tests**

Assertions should confirm:

- file-create modal path field has class `input`
- git auth username/password fields have class `input`
- git commit box renders as textbox with class `input textarea git-commit-input`

## Task 3: Update Migration Inventory and Verify

**Files:**
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [x] **Step 1: Update real caller counts**

After this phase:

- `Input` should only count real remaining legacy callers outside this slice
- `Textarea` should only count real remaining raw textarea callers outside this slice

Do not count `select.input` or `button.input` toward `Input`.

- [x] **Step 2: Run the targeted test set**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/input/index.test.tsx \
  src/components/ui/textarea/index.test.tsx \
  src/features/settings/components/provider-settings.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-status-bar.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

- [x] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: only the existing two warnings in `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`.
