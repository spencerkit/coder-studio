# Header System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify all web headers into three fixed public components: `PageHeader`, `PanelHeader`, and `DialogHeader`.

**Architecture:** Keep `PageHeader` as the shared navigation header, add a new `PanelHeader` for dense surface chrome, and make modal headers the canonical `DialogHeader`. Existing page-specific headers should be migrated onto these primitives without introducing any new ad hoc header shapes.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS modules / global component CSS

---

### Task 1: Extend the shared page header primitive

**Files:**
- Modify: `packages/web/src/features/shared/components/page-header.tsx`
- Modify: `packages/web/src/features/shared/components/page-header.test.tsx`
- Modify: `packages/web/src/features/shared/components/mobile-page-header.tsx`
- Modify: `packages/web/src/features/shared/components/mobile-page-header.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("supports primary and secondary levels with distinct title sizing hooks", () => {
    render(
      <>
        <PageHeader title="Primary" level="primary" onBack={vi.fn()} />
        <PageHeader title="Secondary" level="secondary" onBack={vi.fn()} />
      </>
    );

    expect(document.querySelectorAll(".page-header--primary").length).toBe(1);
    expect(document.querySelectorAll(".page-header--secondary").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/features/shared/components/page-header.test.tsx -t "supports primary and secondary levels with distinct title sizing hooks" -v`
Expected: FAIL because `level` and the modifier classes do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
export interface PageHeaderProps {
  title: string;
  level?: "primary" | "secondary";
  onBack?: () => void;
  backLabel?: string;
  backAriaLabel?: string;
  kicker?: ReactNode;
  rightSlot?: ReactNode;
  titleAs?: PageHeaderTitleElement;
  className?: string;
}

export function PageHeader({
  title,
  level = "secondary",
  onBack,
  backLabel = "Back",
  backAriaLabel,
  kicker,
  rightSlot,
  titleAs = "h2",
  className,
}: PageHeaderProps) {
  const TitleTag = titleAs;

  return (
    <div className={clsx("page-header", `page-header--${level}`, className)}>
      <div className="page-header__leading">
        {onBack ? (
          <button
            type="button"
            className="page-header__back"
            onClick={onBack}
            aria-label={backAriaLabel ?? backLabel}
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        ) : null}
        <div className="page-header__copy">
          {kicker ? <div className="page-header__kicker">{kicker}</div> : null}
          <TitleTag className="page-header__title">{title}</TitleTag>
        </div>
      </div>
      {rightSlot ? <div className="page-header__actions">{rightSlot}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest packages/web/src/features/shared/components/page-header.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/shared/components/page-header.tsx packages/web/src/features/shared/components/page-header.test.tsx packages/web/src/features/shared/components/mobile-page-header.tsx packages/web/src/features/shared/components/mobile-page-header.test.tsx packages/web/src/styles/components.css
git commit -m "feat(web): add header levels to shared page header"
```

### Task 2: Add a dedicated PanelHeader primitive and migrate dense panel chrome

**Files:**
- Create: `packages/web/src/features/shared/components/panel-header.tsx`
- Create: `packages/web/src/features/shared/components/panel-header.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelHeader } from "./panel-header";

describe("PanelHeader", () => {
  it("renders title, meta, and right-side actions in a dense panel layout", () => {
    render(
      <PanelHeader
        title="Files"
        meta="3 items"
        actions={<button type="button">New File</button>}
      />
    );

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(within(document.querySelector(".panel-header") as HTMLElement).getByRole("button")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/features/shared/components/panel-header.test.tsx -v`
Expected: FAIL because the component does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
export interface PanelHeaderProps {
  title: string;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, meta, status, actions, className }: PanelHeaderProps) {
  return (
    <div className={clsx("panel-header", className)}>
      <div className="panel-header__copy">
        <div className="panel-header__title">{title}</div>
        {meta || status ? <div className="panel-header__meta">{meta ?? status}</div> : null}
      </div>
      {actions ? <div className="panel-header__actions">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest packages/web/src/features/shared/components/panel-header.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Migrate panel chrome to the new primitive**

Replace the hand-written headers in:

- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`

Keep the existing surface behavior, but move header layout and sizing into `PanelHeader` and shared CSS classes.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/shared/components/panel-header.tsx packages/web/src/features/shared/components/panel-header.test.tsx packages/web/src/features/agent-panes/views/shared/session-card.tsx packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx packages/web/src/styles/components.css
git commit -m "feat(web): introduce shared panel header"
```

### Task 3: Make modal headers the canonical DialogHeader

**Files:**
- Modify: `packages/web/src/components/ui/modal/index.tsx`
- Modify: `packages/web/src/components/ui/modal/index.module.css`
- Modify: `packages/web/src/components/ui/modal/index.test.tsx`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/modal/README.md`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DialogHeader, ModalTitle } from "."; // new public alias

describe("Modal dialog header", () => {
  it("exports a dialog header alias with the same modal chrome", () => {
    render(
      <DialogHeader>
        <ModalTitle>Workspace details</ModalTitle>
      </DialogHeader>
    );

    expect(screen.getByText("Workspace details")).toBeInTheDocument();
    expect(document.querySelector(".modal-header")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/components/ui/modal/index.test.tsx -v`
Expected: FAIL because `DialogHeader` is not exported yet.

- [ ] **Step 3: Write the minimal implementation**

```tsx
export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx(styles.header, "modal-header", className)} />;
}

export { DialogHeader as ModalHeader };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest packages/web/src/components/ui/modal/index.test.tsx -v`
Expected: PASS.

- [ ] **Step 5: Migrate supervisor dialog to the dialog header contract**

Update `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx` so it uses the canonical dialog header structure for icon, title, description, and close action instead of an ad hoc header block.

- [ ] **Step 6: Update exports and docs**

Expose `DialogHeader` from `packages/web/src/components/ui/index.ts` and describe the preserved compatibility class names in `packages/web/src/components/ui/modal/README.md`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/ui/modal/index.tsx packages/web/src/components/ui/modal/index.module.css packages/web/src/components/ui/modal/index.test.tsx packages/web/src/components/ui/index.ts packages/web/src/components/ui/modal/README.md packages/web/src/features/supervisor/views/shared/objective-dialog.tsx
git commit -m "feat(web): add dialog header alias"
```

### Task 4: Migrate settings and lock the header contract with coverage

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/shared/components/page-header.test.tsx`
- Modify: `packages/web/src/features/shared/components/mobile-page-header.test.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/components/ui/modal/index.test.tsx`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "./settings-page";

describe("SettingsPage", () => {
  it("renders the page header through the shared PageHeader contract on desktop", () => {
    render(
      <SettingsPage />
    );

    expect(document.querySelector(".settings-header")).toBeTruthy();
    expect(document.querySelector(".page-header")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest packages/web/src/features/settings/components/settings-page.tsx -v`
Expected: FAIL until the desktop settings header is migrated to `PageHeader`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
<header className="settings-header">
  <PageHeader
    level={isMobile ? "secondary" : "secondary"}
    title={headerTitle}
    titleAs="h1"
    onBack={handleBack}
    backLabel={t("action.back")}
  />
</header>
```

- [ ] **Step 4: Update coverage for the contract**

Add or adjust tests so the project now verifies:

- `PageHeader` primary / secondary rendering
- `PanelHeader` dense layout expectations
- `DialogHeader` export / modal compatibility
- mobile page header still suppresses kicker on narrow layouts

- [ ] **Step 5: Run the targeted test set**

Run:

```bash
pnpm vitest packages/web/src/features/shared/components/page-header.test.tsx packages/web/src/features/shared/components/mobile-page-header.test.tsx packages/web/src/features/shared/components/panel-header.test.tsx packages/web/src/components/ui/modal/index.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/shared/components/page-header.test.tsx packages/web/src/features/shared/components/mobile-page-header.test.tsx packages/web/src/features/agent-panes/components/session-card.test.tsx packages/web/src/components/ui/modal/index.test.tsx packages/web/src/styles/components.theme.test.ts
git commit -m "feat(web): migrate settings header to shared contract"
```

---

**Execution notes**

- Keep all new public header usage inside the shared primitives.
- Do not introduce any new `*-header` business-only component during implementation.
- Prefer compatibility aliases during migration, but remove ad hoc layout logic as each surface is moved.
