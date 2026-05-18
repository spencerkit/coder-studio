# Overlay Governance Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the missing overlay primitives and migrate the current fragmented desktop and runtime overlay surfaces onto the governed `Modal / Drawer / WorkbenchLayer / LocalOverlay` model in one coordinated convergence pass.

**Architecture:** Keep the existing shared dialog and mobile sheet primitives as the base, then add the three missing governed families: `Drawer`, `WorkbenchLayer`, and `LocalOverlay`. After the primitives exist, migrate the inventoried desktop feature-owned overlays, convert oversized modal-like surfaces into drawers, and replace local runtime overlay shells with the shared host-scoped primitive. This plan intentionally does not add a general overlay manager; it finishes the convergence through shared primitives, token governance, and bounded migrations.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, existing CSS Modules and `styles/components.css`, existing `tokens.css`, shared UI primitives under `packages/web/src/components/ui`

**Spec reference:** `docs/superpowers/specs/2026-05-19-overlay-governance-design.md`

---

## File Structure

**Create:**
- `packages/web/src/components/ui/drawer/index.tsx`
  - Shared desktop/mobile governed drawer shell for the desktop right-side blocking surface.
- `packages/web/src/components/ui/drawer/index.module.css`
  - Drawer shell styles and compatibility hooks.
- `packages/web/src/components/ui/drawer/index.test.tsx`
  - Shared drawer behavior tests.
- `packages/web/src/components/ui/drawer/README.md`
  - Usage contract and governance notes.
- `packages/web/src/components/ui/workbench-layer/index.tsx`
  - Shared global command-surface shell for command palette and launcher overlays.
- `packages/web/src/components/ui/workbench-layer/index.module.css`
  - Workbench shell styles and layering rules.
- `packages/web/src/components/ui/workbench-layer/index.test.tsx`
  - Shared workbench shell behavior tests.
- `packages/web/src/components/ui/workbench-layer/README.md`
  - Usage contract and governance notes.
- `packages/web/src/components/ui/local-overlay/index.tsx`
  - Shared host-scoped runtime overlay shell for local blocking dialogs and status overlays.
- `packages/web/src/components/ui/local-overlay/index.module.css`
  - Shared local runtime overlay styles.
- `packages/web/src/components/ui/local-overlay/index.test.tsx`
  - Shared local overlay behavior tests.
- `packages/web/src/components/ui/local-overlay/README.md`
  - Usage contract and governance notes.

**Modify:**
- `packages/web/src/components/ui/index.ts`
  - Export `Drawer`, `WorkbenchLayer`, and `LocalOverlay`.
- `packages/web/src/components/ui/README.md`
  - Document the new governed overlay families and their allowed use cases.
- `packages/web/src/components/ui/MIGRATION.md`
  - Add the new overlay families and update migration status for the converged callers.
- `packages/web/src/styles/tokens.css`
  - Add semantic z-index tokens for local overlay, drawer, and workbench layer.
- `packages/web/src/styles/components.css`
  - Remove or reduce feature-owned overlay style blocks once callers move to shared primitives.
- `packages/web/src/styles/base.theme.test.ts`
  - Verify overlay token presence where theme-sensitive token contracts are checked.
- `packages/web/src/styles/components.theme.test.ts`
  - Verify new overlay layering contracts and shared overlay shell styling.
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
  - Migrate desktop path from `Modal` to shared `Drawer`.
- `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
  - Update desktop behavior assertions for the drawer path.
- `packages/web/src/features/workspace/views/shared/worktree-manager-surface.tsx`
  - Migrate desktop managed surface from `Modal` shell to shared `Drawer`.
- `packages/web/src/features/workspace/views/shared/worktree-manager-surface.test.tsx`
  - Update desktop behavior assertions for the drawer path.
- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - Replace desktop feature-owned overlay with shared `WorkbenchLayer`.
- `packages/web/src/features/command-palette/components/command-palette.test.tsx`
  - Update command palette overlay assertions.
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - Replace desktop feature-owned overlay with shared `WorkbenchLayer`.
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
  - Update launcher overlay assertions.
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
  - Replace runtime overlay markup with `LocalOverlay`.
- `packages/web/src/features/terminal-panel/views/shared/xterm-placeholder.tsx`
  - Align placeholder/replay surface with the same local overlay contract.
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
  - Add or update local overlay behavior assertions.

**No changes in this plan:**
- `packages/web/src/components/ui/popover/*`
- `packages/web/src/components/ui/tooltip/*`
- `packages/web/src/components/ui/select/*`
- `packages/web/src/components/ui/action-menu/*`
- `packages/web/src/components/ui/toast/*`
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx`
- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- any general-purpose overlay manager or stack registry beyond the bounded primitives above

## Task 1: Lock the token and migration baseline

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/components/ui/MIGRATION.md`
- Test: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing token and migration contract assertions**

Add token coverage for the new semantic overlay slots:

```ts
it("defines semantic overlay z-index tokens for governed layers", () => {
  expect(tokensStylesheet).toContain("--z-local-overlay:");
  expect(tokensStylesheet).toContain("--z-drawer-backdrop:");
  expect(tokensStylesheet).toContain("--z-drawer:");
  expect(tokensStylesheet).toContain("--z-workbench-backdrop:");
  expect(tokensStylesheet).toContain("--z-workbench:");
});
```

Add `components.theme.test.ts` coverage that expects shared overlay families to own semantic z-index usage:

```ts
it("uses semantic z-index tokens for governed overlay families", () => {
  expect(stylesheet).not.toContain("z-index: 10");
  expect(stylesheet).not.toContain("z-index: 100");
  expect(readFileSync(`${process.cwd()}/src/components/ui/drawer/index.module.css`, "utf8")).toContain(
    "var(--z-drawer)"
  );
  expect(
    readFileSync(`${process.cwd()}/src/components/ui/workbench-layer/index.module.css`, "utf8")
  ).toContain("var(--z-workbench)");
  expect(
    readFileSync(`${process.cwd()}/src/components/ui/local-overlay/index.module.css`, "utf8")
  ).toContain("var(--z-local-overlay)");
});
```

Add a migration inventory row assertion after the file exists:

```md
| Drawer | 🟢 complete | new | 0 | 2026-05-19 |
| WorkbenchLayer | 🟢 complete | `command-palette-overlay`, `launch-overlay` | 0 | 2026-05-19 |
| LocalOverlay | 🟢 complete | `paste-dialog-overlay`, `xterm-replay-overlay` | 0 | 2026-05-19 |
```

- [ ] **Step 2: Run the token/style tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts
```

Expected:

- FAIL because the new z-index tokens do not exist yet
- FAIL because the new shared overlay stylesheets do not exist yet

- [ ] **Step 3: Add the semantic overlay tokens and migration placeholders**

In `packages/web/src/styles/tokens.css`, add the new overlay tokens in the z-index block:

```css
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-local-overlay: 240;
  --z-modal-backdrop: 300;
  --z-modal: 310;
  --z-drawer-backdrop: 320;
  --z-drawer: 330;
  --z-workbench-backdrop: 340;
  --z-workbench: 350;
  --z-popover: 360;
  --z-tooltip: 370;
  --z-toast: 380;
```

In `packages/web/src/components/ui/MIGRATION.md`, add pending rows for `Drawer`, `WorkbenchLayer`, and `LocalOverlay` with caller counts matching the spec before implementation begins.

- [ ] **Step 4: Run the token/style tests to verify the token additions pass and the style-file assertions still fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts
```

Expected:

- PASS for token presence assertions
- FAIL for shared overlay stylesheet assertions until the primitives are implemented

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/styles/tokens.css \
  packages/web/src/components/ui/MIGRATION.md \
  packages/web/src/styles/base.theme.test.ts \
  packages/web/src/styles/components.theme.test.ts
git commit -m "chore: add governed overlay token baseline"
```

## Task 2: Implement the shared `Drawer` primitive

**Files:**
- Create: `packages/web/src/components/ui/drawer/index.tsx`
- Create: `packages/web/src/components/ui/drawer/index.module.css`
- Create: `packages/web/src/components/ui/drawer/index.test.tsx`
- Create: `packages/web/src/components/ui/drawer/README.md`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write the failing `Drawer` tests**

Cover a bounded desktop usage like:

```tsx
render(
  <Drawer open onOpenChange={vi.fn()} title="Worktree details">
    <div>Body</div>
  </Drawer>
);
```

Add assertions for:

- `role="dialog"` plus `aria-modal="true"`
- portal rendering into `document.body`
- right-side placement shell
- focus entering the drawer and restoring on close
- `Escape` dismissal
- optional `dismissible={false}` preventing backdrop close
- support for header actions and footer content

- [ ] **Step 2: Run the focused drawer tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/drawer/index.test.tsx
```

Expected:

- FAIL because `Drawer` does not exist yet

- [ ] **Step 3: Implement the minimal shared drawer shell**

In `packages/web/src/components/ui/drawer/index.tsx`, compose the existing portal/focus-trap/dismiss helpers used by `Modal` into a right-side shell.

Use an API like:

```tsx
export interface DrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly dismissible?: boolean;
  readonly initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  readonly headerActions?: ReactNode;
}
```

Implement the shell with:

```tsx
<Portal>
  <div className={clsx(styles.backdrop, "drawer-backdrop")} onClick={...}>
    <section
      aria-modal="true"
      role="dialog"
      className={clsx(styles.panel, "drawer-panel", className)}
      onKeyDown={...}
      ref={panelRef}
      tabIndex={-1}
    >
      <header className={styles.header}>...</header>
      <div className={styles.body}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  </div>
</Portal>
```

In `index.module.css`, bind the backdrop and panel to the new semantic tokens:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-drawer-backdrop);
  display: flex;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.48);
}

.panel {
  width: min(720px, 100vw);
  height: 100%;
  z-index: var(--z-drawer);
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-surface);
  box-shadow: var(--shadow-xl);
}
```

Export `Drawer` from `packages/web/src/components/ui/index.ts` and document the bounded use case in `README.md`.

- [ ] **Step 4: Run the focused drawer tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/drawer/index.test.tsx
```

Expected:

- PASS for focus, dismissal, and shell assertions

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/components/ui/drawer \
  packages/web/src/components/ui/index.ts
git commit -m "feat: add governed drawer primitive"
```

## Task 3: Migrate desktop worktree surfaces to `Drawer`

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-manager-surface.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-manager-surface.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing feature assertions**

Add desktop-path assertions like:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(document.querySelector(".drawer-panel")).toBeTruthy();
expect(document.querySelector(".modal-card-lg")).toBeNull();
```

Also assert:

- `WorktreeModal` still uses `Sheet` on mobile
- `WorktreeManagerSurface` still supports list/create/delete flows
- desktop header actions still exist

- [ ] **Step 2: Run the targeted worktree tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/worktree-manager-surface.test.tsx
```

Expected:

- FAIL because desktop worktree surfaces still use the old modal shell

- [ ] **Step 3: Replace the desktop modal shells with `Drawer`**

In `worktree-modal.tsx`, change the desktop path from:

```tsx
<Modal open onOpenChange={onClose} size="lg">...</Modal>
```

to:

```tsx
<Drawer
  open
  onOpenChange={(open) => {
    if (!open) {
      onClose();
    }
  }}
  title={worktree.name}
  headerActions={
    <IconButton
      aria-label={t("action.close")}
      icon={<X size={14} />}
      onClick={onClose}
      size="sm"
    />
  }
>
  <WorktreeDetailPanel workspaceId={resolvedWorkspaceId} worktree={worktree} />
</Drawer>
```

In `worktree-manager-surface.tsx`, replace both desktop shells:

- remove the `Modal`-owned desktop shell
- remove or hard-cap `desktopPreviewInline` as preview-only, not a governed business dialog
- use a single `Drawer` shell for the interactive desktop managed surface

Example:

```tsx
<Drawer
  className="worktree-manager-surface"
  open
  onOpenChange={(open) => {
    if (!open) {
      onClose();
    }
  }}
  title={title}
  initialFocus={() => (view === "create" ? branchInputRef.current : null)}
  headerActions={...}
>
  {body}
</Drawer>
```

Move any `.modal-card`-shaped feature selectors in `styles/components.css` to feature-owned drawer selectors instead of raw modal class dependencies.

- [ ] **Step 4: Run the targeted worktree tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/drawer/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/worktree-manager-surface.test.tsx
```

Expected:

- PASS for desktop drawer behavior and preserved mobile sheet behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/workspace/views/shared/worktree-modal.tsx \
  packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx \
  packages/web/src/features/workspace/views/shared/worktree-manager-surface.tsx \
  packages/web/src/features/workspace/views/shared/worktree-manager-surface.test.tsx \
  packages/web/src/styles/components.css
git commit -m "refactor: move worktree desktop surfaces to drawer"
```

## Task 4: Implement the shared `WorkbenchLayer` primitive

**Files:**
- Create: `packages/web/src/components/ui/workbench-layer/index.tsx`
- Create: `packages/web/src/components/ui/workbench-layer/index.module.css`
- Create: `packages/web/src/components/ui/workbench-layer/index.test.tsx`
- Create: `packages/web/src/components/ui/workbench-layer/README.md`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write the failing `WorkbenchLayer` tests**

Cover:

```tsx
render(
  <WorkbenchLayer open onOpenChange={vi.fn()}>
    <div>Palette</div>
  </WorkbenchLayer>
);
```

Assertions:

- `role="dialog"` or equivalent workbench-region semantics
- portal rendering into `document.body`
- centered shell with workbench backdrop token usage
- outside click dismissal
- `Escape` dismissal
- no enforced footer semantics

- [ ] **Step 2: Run the focused workbench tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/workbench-layer/index.test.tsx
```

Expected:

- FAIL because `WorkbenchLayer` does not exist yet

- [ ] **Step 3: Implement the shared workbench shell**

Use a small API:

```tsx
export interface WorkbenchLayerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly dismissible?: boolean;
  readonly initialFocus?: HTMLElement | null | (() => HTMLElement | null);
}
```

Implement a portal-backed centered shell without modal footer/header assumptions:

```tsx
<Portal>
  <div className={clsx(styles.backdrop, "workbench-layer-backdrop")} onClick={...}>
    <div
      aria-modal="true"
      role="dialog"
      className={clsx(styles.surface, "workbench-layer", className)}
      onKeyDown={...}
      ref={surfaceRef}
      tabIndex={-1}
    >
      {children}
    </div>
  </div>
</Portal>
```

In `index.module.css`, use:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-workbench-backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-4);
  background: rgba(0, 0, 0, 0.56);
}

.surface {
  width: min(100%, 760px);
  max-height: calc(100vh - var(--sp-8));
  z-index: var(--z-workbench);
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}
```

- [ ] **Step 4: Run the focused workbench tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/workbench-layer/index.test.tsx
```

Expected:

- PASS for shared workbench shell behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/components/ui/workbench-layer \
  packages/web/src/components/ui/index.ts
git commit -m "feat: add governed workbench layer primitive"
```

## Task 5: Migrate desktop command and launcher surfaces to `WorkbenchLayer`

**Files:**
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing feature assertions**

Add desktop assertions such as:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(document.querySelector(".workbench-layer")).toBeTruthy();
expect(document.querySelector(".command-palette-overlay")).toBeNull();
```

Also assert:

- command palette keyboard navigation still works
- launcher close button and footer action still work
- mobile `Sheet` branches remain unchanged

- [ ] **Step 2: Run the targeted command/launcher tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected:

- FAIL because the desktop branches still use feature-owned overlay shells

- [ ] **Step 3: Replace desktop shells with `WorkbenchLayer`**

In `command-palette.tsx`, change the desktop return path from:

```tsx
<div className="command-palette-overlay" onClick={() => setIsOpen(false)}>
  <div className="command-palette command-palette--desktop" ...>
```

to:

```tsx
<WorkbenchLayer open onOpenChange={setIsOpen} initialFocus={() => inputRef.current}>
  <div className="command-palette command-palette--desktop" onKeyDown={handleKeyDown}>
    ...
  </div>
</WorkbenchLayer>
```

In `workspace-launch-modal.tsx`, change the desktop return path from:

```tsx
<div className="launch-overlay" onClick={onClose}>
  <div className="launch-modal" onClick={(event) => event.stopPropagation()}>
```

to:

```tsx
<WorkbenchLayer open onOpenChange={(open) => {
  if (!open) {
    onClose();
  }
}}>
  <div className="launch-modal">
    ...
  </div>
</WorkbenchLayer>
```

Move the overlay chrome from `components.css` into `workbench-layer/index.module.css` and keep feature-owned internal layout classes like `command-palette-*` and `launch-*` local to the features.

- [ ] **Step 4: Run the targeted command/launcher tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/workbench-layer/index.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected:

- PASS for shared workbench shell and preserved feature behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  packages/web/src/styles/components.css
git commit -m "refactor: move desktop command surfaces to workbench layer"
```

## Task 6: Implement the shared `LocalOverlay` primitive

**Files:**
- Create: `packages/web/src/components/ui/local-overlay/index.tsx`
- Create: `packages/web/src/components/ui/local-overlay/index.module.css`
- Create: `packages/web/src/components/ui/local-overlay/index.test.tsx`
- Create: `packages/web/src/components/ui/local-overlay/README.md`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write the failing `LocalOverlay` tests**

Cover a host-scoped usage like:

```tsx
render(
  <div data-testid="host" style={{ position: "relative" }}>
    <LocalOverlay open>
      <div>Uploading…</div>
    </LocalOverlay>
  </div>
);
```

Assertions:

- renders inside host flow instead of portal-to-body
- uses scoped absolute positioning
- supports optional `role="dialog"` and non-dialog status modes
- does not lock document scroll
- optional dismiss action only when supplied

- [ ] **Step 2: Run the focused local overlay tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/local-overlay/index.test.tsx
```

Expected:

- FAIL because `LocalOverlay` does not exist yet

- [ ] **Step 3: Implement the shared local overlay shell**

Use a bounded API:

```tsx
export interface LocalOverlayProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly mode?: "status" | "dialog";
  readonly onDismiss?: () => void;
  readonly ariaLabelledBy?: string;
}
```

Implement:

```tsx
if (!open) {
  return null;
}

return (
  <div
    className={clsx(styles.overlay, "local-overlay", className)}
    role={mode === "dialog" ? "dialog" : "status"}
    aria-modal={mode === "dialog" ? "true" : undefined}
    aria-live={mode === "status" ? "polite" : undefined}
    aria-labelledby={ariaLabelledBy}
  >
    <div className={clsx(styles.card, "local-overlay__card")}>{children}</div>
  </div>
);
```

In `index.module.css`:

```css
.overlay {
  position: absolute;
  inset: 0;
  z-index: var(--z-local-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
}

.card {
  max-width: min(24rem, calc(100% - var(--sp-4)));
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--bg-surface);
  box-shadow: var(--shadow-xl);
}
```

- [ ] **Step 4: Run the focused local overlay tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/local-overlay/index.test.tsx
```

Expected:

- PASS for scoped overlay behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/components/ui/local-overlay \
  packages/web/src/components/ui/index.ts
git commit -m "feat: add governed local runtime overlay primitive"
```

## Task 7: Migrate terminal runtime overlays to `LocalOverlay`

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-placeholder.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing terminal overlay assertions**

Add assertions like:

```tsx
expect(document.querySelector(".local-overlay")).toBeTruthy();
expect(document.querySelector(".paste-dialog-overlay")).toBeNull();
```

Also assert:

- upload busy state still blocks interaction visually
- paste dialog still exposes `role="dialog"` semantics
- replay placeholder still renders its title/body copy

- [ ] **Step 2: Run the targeted terminal tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- FAIL because terminal overlay markup still uses feature-owned shells

- [ ] **Step 3: Replace terminal overlay markup with `LocalOverlay`**

In `xterm-host.tsx`, replace the raw upload busy block:

```tsx
{uploadBusy ? (
  <LocalOverlay open className="terminal-upload-overlay" mode="status">
    <div>Uploading…</div>
  </LocalOverlay>
) : null}
```

Replace the paste dialog overlay:

```tsx
{showPasteDialog ? (
  <LocalOverlay open mode="dialog" ariaLabelledBy="paste-dialog-title">
    <div className="paste-dialog">
      ...
    </div>
  </LocalOverlay>
) : null}
```

Replace the replay/status shell:

```tsx
{showReplayOverlay ? (
  <LocalOverlay open className={replayClassName} mode="status">
    <div className="xterm-replay-overlay__card">
      ...
    </div>
  </LocalOverlay>
) : null}
```

In `xterm-placeholder.tsx`, align the placeholder root to the same shared overlay structure if it remains a host-scoped blocking layer.

Remove or minimize raw overlay style blocks in `components.css` that are now owned by the shared primitive, leaving only feature-specific card/body/title styling.

- [ ] **Step 4: Run the targeted terminal tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/local-overlay/index.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- PASS for shared local overlay semantics and preserved terminal runtime behavior

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/views/shared/xterm-placeholder.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/styles/components.css
git commit -m "refactor: move terminal runtime overlays to local overlay"
```

## Task 8: Docs, inventory, enforcement, and final verification

**Files:**
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Update the shared UI docs and migration inventory**

In `packages/web/src/components/ui/README.md`, add rows for:

- `Drawer`
- `WorkbenchLayer`
- `LocalOverlay`

with notes that:

- `Drawer` is for desktop complex edit/detail surfaces
- `WorkbenchLayer` is for global command surfaces only
- `LocalOverlay` is for host-scoped runtime overlays only

In `packages/web/src/components/ui/MIGRATION.md`, update the rows to complete status with `0` callers left in the governed inventory.

- [ ] **Step 2: Add the final style contract assertions**

In `packages/web/src/styles/components.theme.test.ts`, add assertions such as:

```ts
it("does not leave governed desktop overlays on raw feature-owned backdrops", () => {
  expect(stylesheet).not.toContain(".command-palette-overlay {");
  expect(stylesheet).not.toContain(".launch-overlay {");
  expect(stylesheet).not.toContain(".paste-dialog-overlay {");
});
```

and:

```ts
it("keeps shared overlay families on semantic z-index tokens", () => {
  const drawerStyles = readFileSync(`${process.cwd()}/src/components/ui/drawer/index.module.css`, "utf8");
  const workbenchStyles = readFileSync(
    `${process.cwd()}/src/components/ui/workbench-layer/index.module.css`,
    "utf8"
  );
  const localOverlayStyles = readFileSync(
    `${process.cwd()}/src/components/ui/local-overlay/index.module.css`,
    "utf8"
  );

  expect(drawerStyles).toContain("var(--z-drawer-backdrop)");
  expect(drawerStyles).toContain("var(--z-drawer)");
  expect(workbenchStyles).toContain("var(--z-workbench-backdrop)");
  expect(workbenchStyles).toContain("var(--z-workbench)");
  expect(localOverlayStyles).toContain("var(--z-local-overlay)");
});
```

- [ ] **Step 3: Run the full overlay convergence verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/drawer/index.test.tsx \
  src/components/ui/workbench-layer/index.test.tsx \
  src/components/ui/local-overlay/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/worktree-manager-surface.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts
```

Expected:

- PASS for all overlay primitive, feature, and style-contract coverage

- [ ] **Step 4: Run focused lint/format verification**

Run:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/drawer \
  src/components/ui/workbench-layer \
  src/components/ui/local-overlay \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/tokens.css \
  src/styles/components.css \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/features/workspace/views/shared/worktree-modal.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/worktree-manager-surface.tsx \
  src/features/workspace/views/shared/worktree-manager-surface.test.tsx \
  src/features/command-palette/components/command-palette.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  src/features/terminal-panel/views/shared/xterm-host.tsx \
  src/features/terminal-panel/views/shared/xterm-placeholder.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected:

- biome reports no issues

- [ ] **Step 5: Re-scan for remaining governed overlay violations**

Run:

```bash
rg -n 'command-palette-overlay|launch-overlay|paste-dialog-overlay|z-index:\\s*(10|100)|className=\"[^\"]*(overlay|modal|drawer)\"' \
  packages/web/src \
  -g '!**/*.test.tsx' \
  -g '!**/*.test.ts'
```

Expected:

- no remaining governed desktop/runtime overlay violations
- remaining hits, if any, belong only to explicitly excluded shell families or preview/test fixtures

- [ ] **Step 6: Commit**

```bash
git add \
  packages/web/src/components/ui/README.md \
  packages/web/src/components/ui/MIGRATION.md \
  packages/web/src/styles/base.theme.test.ts \
  packages/web/src/styles/components.theme.test.ts
git commit -m "docs: finalize overlay governance convergence"
```
