# UI Component Library Phase B Input + Textarea Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `Input` and `Textarea` as the next two shared UI primitives, migrate one real caller for each, and keep legacy `.input` / `.textarea` compatibility intact.

**Architecture:** Follow the same narrow-slice pattern as `Button`. Each component lives in its own folder under `packages/web/src/components/ui/`, uses CSS Modules plus temporary `:global()` legacy aliases, and is exported from the public barrel. Migrate only the auth password input and the supervisor objective textarea so the abstractions are proven without taking on the remaining 8 input callers.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing `tokens.css`, existing global `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-07-ui-component-library-input-textarea-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/input/index.tsx`
- `packages/web/src/components/ui/input/index.module.css`
- `packages/web/src/components/ui/input/index.test.tsx`
- `packages/web/src/components/ui/input/README.md`
- `packages/web/src/components/ui/textarea/index.tsx`
- `packages/web/src/components/ui/textarea/index.module.css`
- `packages/web/src/components/ui/textarea/index.test.tsx`
- `packages/web/src/components/ui/textarea/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/auth/index.tsx`
- `packages/web/src/features/auth/index.test.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`

**No changes in this plan:**
- `packages/web/src/styles/components.css`
- Any remaining `.input` callers outside auth and objective dialog
- Tier 1 / Tier 2 components

## Task 1: Capture Baseline

**Files:** none

- [x] **Step 1: Record the current `.input` caller count**

Run:

```bash
pnpm --filter @coder-studio/web exec sh -lc \
  "rg -n 'className=.*(^|[^A-Za-z0-9_-])input([^A-Za-z0-9_-]|$)' src --glob '*.tsx' | wc -l"
```

Expected: `10`

- [x] **Step 2: Record the current `textarea.input` caller count**

Run:

```bash
pnpm --filter @coder-studio/web exec sh -lc \
  "rg -n 'className=\"input textarea\"|className=\"textarea input\"|<textarea[^>]*className=.*input.*textarea|<textarea[^>]*className=.*textarea.*input' src --glob '*.tsx' | wc -l"
```

Expected: `1`

- [x] **Step 3: Run the characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/auth/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/components/ui/button/index.test.tsx
```

Expected: all tests pass.

## Task 2: Implement `Input`

**Files:**
- Create: `packages/web/src/components/ui/input/index.tsx`
- Create: `packages/web/src/components/ui/input/index.module.css`
- Create: `packages/web/src/components/ui/input/index.test.tsx`
- Create: `packages/web/src/components/ui/input/README.md`
- Modify: `packages/web/src/features/auth/index.tsx`
- Modify: `packages/web/src/features/auth/index.test.tsx`

- [x] **Step 1: Write failing `Input` tests**

Cover:

```tsx
render(<Input placeholder="Password" />);
render(<Input size="sm" />);
render(<Input size="lg" />);
render(<Input invalid aria-label="Password" />);
render(<Input className="auth-input" type="password" />);
```

Assertions:

- native role is `textbox`
- `aria-invalid="true"` when `invalid`
- legacy classes include `input`
- custom class survives

- [x] **Step 2: Implement the component**

Requirements:

```tsx
export type InputSize = "sm" | "md" | "lg";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly size?: InputSize;
  readonly invalid?: boolean;
}
```

Implementation details:

- `forwardRef<HTMLInputElement, InputProps>()`
- default `size="md"`
- `className` combines local module class, size class, legacy `input`, caller class
- `invalid` adds private class and `aria-invalid`

- [x] **Step 3: Implement CSS parity**

Base rules come from legacy `.input`:

```css
height: var(--input-height-md);
padding: 0 var(--sp-3);
background: var(--bg-page);
border: 1px solid var(--border);
border-radius: var(--radius-md);
color: var(--text-primary);
font-family: var(--font-sans);
font-size: var(--text-base);
```

Need:

- local base class + `:global(.input)`
- hover/focus-visible parity
- `sm` and `lg` size classes from input-height tokens
- invalid border/focus state using `--border-error`

- [x] **Step 4: Migrate auth password input**

Change:

```tsx
- <input className="input auth-input" type="password" ... />
+ <Input className="auth-input" type="password" ... />
```

Keep behavior unchanged:

- value
- onChange
- placeholder
- disabled logic

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/input/index.test.tsx \
  src/features/auth/index.test.tsx
```

Expected: PASS

## Task 3: Implement `Textarea`

**Files:**
- Create: `packages/web/src/components/ui/textarea/index.tsx`
- Create: `packages/web/src/components/ui/textarea/index.module.css`
- Create: `packages/web/src/components/ui/textarea/index.test.tsx`
- Create: `packages/web/src/components/ui/textarea/README.md`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`

- [x] **Step 1: Write failing `Textarea` tests**

Cover:

```tsx
render(<Textarea aria-label="Objective" />);
render(<Textarea size="lg" />);
render(<Textarea invalid aria-label="Objective" />);
render(<Textarea autoResize aria-label="Objective" />);
render(<Textarea className="textarea-pane" />);
```

Assertions:

- native role is textbox
- `aria-invalid="true"` when `invalid`
- legacy classes include both `input` and `textarea`
- `autoResize` mutates inline height after value change

- [x] **Step 2: Implement the component**

Requirements:

```tsx
export type TextareaSize = "md" | "lg";

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  readonly size?: TextareaSize;
  readonly invalid?: boolean;
  readonly autoResize?: boolean;
}
```

Implementation details:

- `forwardRef<HTMLTextAreaElement, TextareaProps>()`
- default `size="md"`
- add legacy classes `input textarea`
- when `autoResize`, reset `style.height = "auto"` then set to `scrollHeight`

- [x] **Step 3: Implement CSS parity**

Base rules come from:

```css
textarea.input {
  height: auto;
  min-height: 88px;
  padding: var(--sp-3);
  resize: vertical;
}

.textarea {
  resize: vertical;
  min-height: 80px;
}
```

Need:

- module base + `:global(.textarea)` alias
- md/lg min-height sizing that does not regress `rows={5}` use cases
- invalid border/focus state parity with `Input`

- [x] **Step 4: Migrate objective dialog textarea**

Change:

```tsx
- <textarea className="input textarea" rows={5} ... />
+ <Textarea rows={5} ... />
```

Do not modify:

- evaluator select
- mobile trigger
- dialog shell behavior

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/textarea/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx
```

Expected: PASS

## Task 4: Integrate Public Exports and Docs

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [x] **Step 1: Export both components from the public barrel**

Add named exports for:

```ts
export type { InputProps, InputSize } from "./input";
export { Input } from "./input";
export type { TextareaProps, TextareaSize } from "./textarea";
export { Textarea } from "./textarea";
```

- [x] **Step 2: Update the UI library README**

Add `Input` and `Textarea` to the implemented component table and note that new code must not add raw `className="input"` / `className="input textarea"` usage.

- [x] **Step 3: Update migration inventory**

Set:

- `Input` to `🟡 in-flight` with `Callers left = 8`
- `Textarea` to `🟡 in-flight` with `Callers left = 2`
- `Last update = 2026-05-07`

`Button` row should remain unchanged.

## Task 5: Final Verification

**Files:** none

- [x] **Step 1: Run the full targeted UI slice**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/button/index.test.tsx \
  src/components/ui/input/index.test.tsx \
  src/components/ui/textarea/index.test.tsx \
  src/features/auth/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/hooks/use-viewport.test.ts \
  src/app.test.tsx
```

Expected: PASS

- [x] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: no new errors; the two existing warnings in `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` may remain.

- [x] **Step 3: Sanity-check auth preview**

Confirm the auth password field still fills the full card width and still matches the existing `.auth-input.input` height override.

- [x] **Step 4: Commit**

Example:

```bash
git add docs/superpowers/specs/2026-05-07-ui-component-library-input-textarea-design.md \
  docs/superpowers/plans/2026-05-07-ui-component-library-phase-b-input-and-textarea.md \
  packages/web/src/components/ui \
  packages/web/src/features/auth/index.tsx \
  packages/web/src/features/auth/index.test.tsx \
  packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx
git commit -m "feat: add ui input and textarea primitives"
```
