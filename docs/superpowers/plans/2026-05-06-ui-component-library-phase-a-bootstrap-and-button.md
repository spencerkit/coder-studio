# UI Component Library Phase A Bootstrap + Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap `packages/web/src/components/ui/` as the new home for shared UI primitives, centralize `useViewport()` into a single source of truth, and land `Button` as the first production component with one real caller migrated.

**Architecture:** Keep this first plan intentionally narrow. Do not attempt Tier 0 in bulk. Create the UI library skeleton (`README.md`, `MIGRATION.md`), move viewport logic into `components/ui/_internal/use-viewport.ts` with a compatibility re-export from `src/hooks/use-viewport.ts`, then add `Button` with CSS Modules and `clsx`. Migrate exactly one simple caller (`features/auth/index.tsx`) so the pattern is proven before the rest of Tier 0.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, Jotai, vanilla CSS Modules, existing `tokens.css`, new `clsx` dependency.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md` §2, §3, §4, §5, §6, §7, §8.

**Out of scope for this plan (deferred):**
- `IconButton`, `Input`, `Textarea`, `Tag`, `Badge`, `Pill`, `StatusDot`, `Kbd`, `Spinner`, `Switch`
- All Tier 1 and Tier 2 components
- `portal.tsx`, `focus-trap.ts`, `dismiss.ts`, `render-with-viewport.tsx`
- Deleting the legacy `.btn` block from `styles/components.css`
- Migrating any Button caller other than `features/auth/index.tsx`
- Adding `@floating-ui/react`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/README.md` — project-level rules for the new UI library
- `packages/web/src/components/ui/MIGRATION.md` — 24-row migration inventory; source of truth for caller counts and deletion timing
- `packages/web/src/components/ui/_internal/use-viewport.ts` — single source of truth for `(max-width: 899px), (pointer: coarse)` viewport detection
- `packages/web/src/components/ui/_internal/use-viewport.test.tsx` — tests the combined media query and live updates
- `packages/web/src/components/ui/button/index.tsx` — first shared primitive; variant/size/loading API
- `packages/web/src/components/ui/button/index.module.css` — Button styles copied from the legacy `.btn` block, plus local hashed classes and temporary `:global()` aliases
- `packages/web/src/components/ui/button/index.test.tsx` — Button unit tests
- `packages/web/src/components/ui/button/README.md` — Button usage contract
- `packages/web/src/components/ui/index.ts` — public barrel export for `Button`

**Modified files:**
- `packages/web/package.json` — add `clsx`
- `pnpm-lock.yaml` — lockfile update for `clsx`
- `packages/web/src/hooks/use-viewport.ts` — compatibility re-export from the new `_internal` hook
- `packages/web/src/hooks/use-viewport.test.ts` — keep the legacy import path covered after the behavioral change
- `packages/web/src/app.test.tsx` — coarse-pointer expectation flips from desktop to mobile
- `packages/web/src/features/auth/index.tsx` — replace raw submit `<button className="btn btn-primary btn-lg auth-submit">` with `<Button>`

**No changes in this plan:**
- `packages/web/src/styles/components.css` (legacy `.btn` block stays in place for now)
- `packages/web/src/app.tsx` (behavior changes through the hook re-export only)
- `packages/web/src/features/welcome`, `features/workspace`, `features/settings`, `features/supervisor`, `features/terminal-panel`
- Backend / server / core packages

---

## Task 1: Capture Baseline and Lock Scope

**Files:** none (verification-only)

- [ ] **Step 1: Record the current Button caller count**

Run from repo root:
```bash
pnpm --filter @coder-studio/web exec sh -lc \
  "rg -n 'className=.*(^|[^A-Za-z0-9_-])btn([^A-Za-z0-9_-]|$)' src --glob '*.tsx' | wc -l"
```

Expected: `31`.

This count intentionally covers both plain string classNames and template-string classNames such as
``className={`btn ${isDanger ? "btn-danger" : "btn-primary"}`}``.

If the count is not `31`, stop and update the plan before proceeding. `MIGRATION.md` in later tasks depends on this number.

- [ ] **Step 2: Run the three suites that characterize the first migration seam**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/hooks/use-viewport.test.ts \
  src/app.test.tsx \
  src/features/auth/index.test.tsx
```

Expected: all tests pass.

This is the characterization baseline for the viewport hook and the login submit button. If any suite is red before any code changes, stop and surface the failure instead of continuing.

- [ ] **Step 3: Capture a pre-migration Button screenshot baseline**

Run from repo root:
```bash
pnpm --dir e2e exec playwright screenshot --device="Desktop Chrome" \
  "file://$(pwd)/packages/web/auth-preview.html" \
  /tmp/ui-button-auth-submit-before.png
```

Expected: PASS, and `/tmp/ui-button-auth-submit-before.png` exists.

This file is a disposable local artifact. Do not add it to git. It is the visual baseline for the auth submit button before the `Button` migration.

- [ ] **Step 4: Record the current commit hash for rollback**

```bash
git rev-parse HEAD
```

Expected: a single 40-character SHA.

Write the SHA down in your scratchpad. Do not commit in this task.

---

## Task 2: Create the UI Library Skeleton and Migration Inventory

**Files:**
- Create: `packages/web/src/components/ui/README.md`
- Create: `packages/web/src/components/ui/MIGRATION.md`

**Goal:** Establish the two documents every later component PR will update.

- [ ] **Step 1: Create `packages/web/src/components/ui/README.md`**

Create this file exactly:

```md
# Coder Studio UI

## 总则
- 已落地的基础组件统一从 public barrel（当前文件路径为 `src/components/ui/index.ts`）引入，不允许深链到组件子路径。
- 所有颜色、间距、字号、圆角、阴影、动效必须来自 `src/styles/tokens.css`。
- 业务代码禁止新增 `btn btn-*`、`input` 这类旧式全局 className；未迁移的遗留调用点只允许原样保留，不允许扩散。
- PC / 移动差异默认由 token 或共享内部逻辑解决，业务代码不直接写 `matchMedia`。

## 已实现组件
当前 phase 只会先落 `Button`。公共导出完成后，这里会改成可用组件列表。

## 迁移状态
见 `./MIGRATION.md`。
```

- [ ] **Step 2: Create `packages/web/src/components/ui/MIGRATION.md`**

Create this file exactly:

```md
# UI Component Migration Inventory

| Component | Status | Legacy classes | Callers left | Last update |
|---|---|---|---:|---|
| Button | ⚫ not-started | `.btn .btn-*` | 31 | 2026-05-06 |
| IconButton | ⚫ not-started | `.btn` icon-only | — | — |
| Input | ⚫ not-started | `.input` | — | — |
| Textarea | ⚫ not-started | `.input.textarea` | — | — |
| Tag | ⚫ not-started | `.badge .badge-*` | — | — |
| Badge | ⚫ not-started | `.badge` | — | — |
| Pill | ⚫ not-started | `.settings-pill*` | — | — |
| StatusDot | ⚫ not-started | token-backed dot patterns | — | — |
| Kbd | ⚫ not-started | `kbd` | — | — |
| Spinner | ⚫ not-started | `.animate-spin` | — | — |
| Switch | ⚫ not-started | new | — | — |
| Modal | ⚫ not-started | `.modal-overlay .modal-card .modal-*` | — | — |
| ConfirmDialog | ⚫ not-started | modal convenience wrapper | — | — |
| Toast | ⚫ not-started | `.toast*` | — | — |
| Tooltip | ⚫ not-started | new | — | — |
| ProgressBar | ⚫ not-started | `--progress-height` patterns | — | — |
| Notice | ⚫ not-started | `.settings-page__notice*` | — | — |
| EmptyState | ⚫ not-started | feature-specific empty state blocks | — | — |
| Tabs | ⚫ not-started | tab / pill patterns across features | — | — |
| SegmentedControl | ⚫ not-started | `.settings-pill*` | — | — |
| Select | ⚫ not-started | `.input`, `.mobile-select-*` | — | — |
| Popover | ⚫ not-started | new | — | — |
| ActionMenu | ⚫ not-started | new | — | — |
| Sheet | ⚫ not-started | mobile sheet shells | — | — |
```

- [ ] **Step 3: Verify both files are tracked correctly**

Run:
```bash
git status --short packages/web/src/components/ui/README.md packages/web/src/components/ui/MIGRATION.md
```

Expected:
```text
?? packages/web/src/components/ui/README.md
?? packages/web/src/components/ui/MIGRATION.md
```

- [ ] **Step 4: Commit the bootstrap docs**

```bash
git add packages/web/src/components/ui/README.md packages/web/src/components/ui/MIGRATION.md
git commit -m "docs: add web ui migration inventory"
```

Expected: one new commit containing exactly the two new markdown files.

---

## Task 3: Centralize `useViewport()` in `components/ui/_internal`

**Files:**
- Create: `packages/web/src/components/ui/_internal/use-viewport.ts`
- Create: `packages/web/src/components/ui/_internal/use-viewport.test.tsx`
- Modify: `packages/web/src/hooks/use-viewport.ts`
- Modify: `packages/web/src/hooks/use-viewport.test.ts`
- Modify: `packages/web/src/app.test.tsx`

**Goal:** One hook implementation, one combined media query, no immediate import churn in features.

- [ ] **Step 1: Write the failing tests first**

Create `packages/web/src/components/ui/_internal/use-viewport.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewport } from "./use-viewport";

type MediaListener = () => void;

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

const createMatchMediaHarness = (initialMatches: boolean) => {
  let matches = initialMatches;
  const listeners = new Set<MediaListener>();

  const matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: (_event: string, listener: MediaListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: MediaListener) => {
      listeners.delete(listener);
    },
    addListener: (listener: MediaListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: MediaListener) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => true,
  }));

  return {
    matchMedia,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

const Probe = () => {
  return <div data-testid="viewport">{useViewport()}</div>;
};

describe("useViewport", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("returns desktop when the combined viewport query does not match", () => {
    const harness = createMatchMediaHarness(false);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(window.matchMedia).toHaveBeenCalledWith(VIEWPORT_QUERY);
    expect(screen.getByTestId("viewport")).toHaveTextContent("desktop");
  });

  it("returns mobile when the combined viewport query matches", () => {
    const harness = createMatchMediaHarness(true);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);

    expect(screen.getByTestId("viewport")).toHaveTextContent("mobile");
  });

  it("updates subscribers when the media query match changes", () => {
    const harness = createMatchMediaHarness(false);
    window.matchMedia = harness.matchMedia as unknown as typeof window.matchMedia;

    render(<Probe />);
    expect(screen.getByTestId("viewport")).toHaveTextContent("desktop");

    act(() => {
      harness.setMatches(true);
    });

    expect(screen.getByTestId("viewport")).toHaveTextContent("mobile");
  });
});
```

Then update the third test in `packages/web/src/app.test.tsx` so coarse-pointer devices are treated as mobile. Replace the existing third test with this exact block:

```tsx
it("renders MobileShell on wide coarse-pointer devices", () => {
  setMatchMediaMock((query) => query.includes("pointer: coarse"));
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);

  render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  expect(screen.getByTestId("mobile-shell")).toBeInTheDocument();
  expect(screen.queryByTestId("desktop-shell")).not.toBeInTheDocument();
});
```

Replace `packages/web/src/hooks/use-viewport.test.ts` with this exact compatibility test:

```ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewport } from "./use-viewport";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

describe("useViewport compatibility re-export", () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("keeps wide coarse-pointer devices on the mobile branch through the legacy import path", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === VIEWPORT_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(matchMedia).toHaveBeenCalledWith(VIEWPORT_QUERY);
    expect(result.current).toBe("mobile");
  });
});
```

- [ ] **Step 2: Run the targeted tests and confirm they fail**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/_internal/use-viewport.test.tsx \
  src/hooks/use-viewport.test.ts \
  src/app.test.tsx
```

Expected: FAIL.

Accept either failure mode:
- `Failed to resolve import "./use-viewport"` from the new test file, because the file does not exist yet
- the updated compatibility test or updated coarse-pointer `app.test.tsx` assertion failing because the old hook still returns `desktop`

Do not proceed until the suite is red.

- [ ] **Step 3: Implement the shared hook and compatibility re-export**

Create `packages/web/src/components/ui/_internal/use-viewport.ts`:

```ts
import { useSyncExternalStore } from "react";

export type Viewport = "mobile" | "desktop";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

const getServerSnapshot = (): Viewport => {
  return "desktop";
};

const getSnapshot = (): Viewport => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "desktop";
  }

  return window.matchMedia(VIEWPORT_QUERY).matches ? "mobile" : "desktop";
};

const subscribe = (onStoreChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const mediaQueryList = window.matchMedia(VIEWPORT_QUERY);
  const handleChange = () => {
    onStoreChange();
  };

  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", handleChange);
    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }

  mediaQueryList.addListener(handleChange);
  return () => {
    mediaQueryList.removeListener(handleChange);
  };
};

export const useViewport = (): Viewport => {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
```

Replace `packages/web/src/hooks/use-viewport.ts` with this exact content:

```ts
export { useViewport } from "../components/ui/_internal/use-viewport";
export type { Viewport } from "../components/ui/_internal/use-viewport";
```

- [ ] **Step 4: Run the targeted tests again and confirm they pass**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/_internal/use-viewport.test.tsx \
  src/hooks/use-viewport.test.ts \
  src/app.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the viewport refactor**

```bash
git add \
  packages/web/src/components/ui/_internal/use-viewport.ts \
  packages/web/src/components/ui/_internal/use-viewport.test.tsx \
  packages/web/src/hooks/use-viewport.ts \
  packages/web/src/hooks/use-viewport.test.ts \
  packages/web/src/app.test.tsx
git commit -m "refactor: centralize web viewport hook"
```

Expected: one commit containing exactly the hook migration and the updated tests.

---

## Task 4: Add the First Public Primitive — `Button`

**Files:**
- Modify: `packages/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/web/src/components/ui/button/index.tsx`
- Create: `packages/web/src/components/ui/button/index.module.css`
- Create: `packages/web/src/components/ui/button/index.test.tsx`
- Create: `packages/web/src/components/ui/button/README.md`
- Create: `packages/web/src/components/ui/index.ts`

**Goal:** Land a production-ready Button API without touching any feature caller yet.

- [ ] **Step 1: Write the failing Button tests first**

Create `packages/web/src/components/ui/button/index.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from ".";

describe("Button", () => {
  it("renders a secondary button by default", () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeEnabled();
  });

  it("supports the four visual variants", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Secondary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghost" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Danger" })).toBeInTheDocument();
  });

  it("supports the three size options", () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </>
    );

    expect(screen.getByRole("button", { name: "Small" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Medium" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Large" })).toBeInTheDocument();
  });

  it("disables click handlers while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <Button loading onClick={onClick}>
        Create
      </Button>
    );

    const button = screen.getByRole("button", { name: "Create" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick when enabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<Button onClick={onClick}>Run</Button>);

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders leading and trailing icons", () => {
    render(
      <Button
        leadingIcon={<span data-testid="leading-icon">L</span>}
        trailingIcon={<span data-testid="trailing-icon">R</span>}
      >
        Open
      </Button>
    );

    expect(screen.getByTestId("leading-icon")).toBeInTheDocument();
    expect(screen.getByTestId("trailing-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("renders as an anchor when as='a'", () => {
    render(
      <Button as="a" href="/settings">
        Settings
      </Button>
    );

    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings"
    );
  });
});
```

- [ ] **Step 2: Run the Button tests and confirm they fail**

```bash
pnpm --filter @coder-studio/web exec vitest run src/components/ui/button/index.test.tsx
```

Expected: FAIL with `Failed to resolve import "."` from `src/components/ui/button/index.test.tsx`, because `index.tsx` does not exist yet.

- [ ] **Step 3: Add `clsx`**

Run:
```bash
pnpm --filter @coder-studio/web add clsx
```

Expected: `packages/web/package.json` gains `"clsx"`, and `pnpm-lock.yaml` updates.

The dependency section in `packages/web/package.json` should now include this exact line:

```json
"clsx": "^2.1.1"
```

- [ ] **Step 4: Implement `Button`, its CSS Module, README, and the public barrel export**

Create `packages/web/src/components/ui/button/index.tsx`:

```tsx
import clsx from "clsx";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./index.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonBaseProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly loading?: boolean;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
}

type ButtonElementProps = ButtonBaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> & {
    readonly as?: "button";
  };

type AnchorElementProps = ButtonBaseProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonBaseProps> & {
    readonly as: "a";
  };

export type ButtonProps = ButtonElementProps | AnchorElementProps;

const variantClassMap: Record<ButtonVariant, string> = {
  primary: styles.primary,
  secondary: styles.secondary,
  ghost: styles.ghost,
  danger: styles.danger,
};

const sizeClassMap: Record<ButtonSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
};

const ButtonContent = ({
  children,
  leadingIcon,
  loading,
  trailingIcon,
}: Pick<ButtonBaseProps, "children" | "leadingIcon" | "loading" | "trailingIcon">) => {
  return (
    <>
      {loading ? <span aria-hidden="true" className={clsx(styles.spinner, "animate-spin")} /> : null}
      {leadingIcon ? (
        <span aria-hidden="true" className={styles.icon}>
          {leadingIcon}
        </span>
      ) : null}
      <span className={styles.label}>{children}</span>
      {trailingIcon ? (
        <span aria-hidden="true" className={styles.icon}>
          {trailingIcon}
        </span>
      ) : null}
    </>
  );
};

export const Button = (props: ButtonProps) => {
  const {
    as = "button",
    children,
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    leadingIcon,
    trailingIcon,
  } = props;

  const classNames = clsx(
    styles.btn,
    variantClassMap[variant],
    sizeClassMap[size],
    loading ? styles.loading : undefined,
    className
  );

  const content = (
    <ButtonContent
      children={children}
      leadingIcon={leadingIcon}
      loading={loading}
      trailingIcon={trailingIcon}
    />
  );

  if (as === "a") {
    const {
      as: _as,
      children: _children,
      className: _className,
      leadingIcon: _leadingIcon,
      loading: _loading,
      size: _size,
      trailingIcon: _trailingIcon,
      variant: _variant,
      ...anchorProps
    } = props as AnchorElementProps;

    return (
      <a
        {...anchorProps}
        aria-busy={loading ? "true" : undefined}
        className={classNames}
      >
        {content}
      </a>
    );
  }

  const {
    as: _as,
    children: _children,
    className: _className,
    disabled,
    leadingIcon: _leadingIcon,
    loading: _loading,
    size: _size,
    trailingIcon: _trailingIcon,
    type,
    variant: _variant,
    ...buttonProps
  } = props as ButtonElementProps;

  return (
    <button
      {...buttonProps}
      aria-busy={loading ? "true" : undefined}
      className={classNames}
      disabled={disabled || loading}
      type={type ?? "button"}
    >
      {content}
    </button>
  );
};
```

Create `packages/web/src/components/ui/button/index.module.css`:

```css
.btn,
:global(.btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  height: var(--btn-height-md);
  min-height: var(--touch-target-min);
  padding: 0 var(--sp-4);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
  transition:
    background var(--duration-normal) var(--ease-out),
    border-color var(--duration-normal) var(--ease-out),
    color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out),
    transform var(--duration-fast) var(--ease-out);
  cursor: pointer;
}

.btn:focus-visible,
:global(.btn):focus-visible {
  box-shadow:
    0 0 0 calc(var(--sp-1) / 2) var(--bg-page),
    0 0 0 var(--sp-1) var(--border-focus);
}

.btn:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn):hover:not(:disabled):not([aria-disabled="true"]) {
  transform: translateY(calc(var(--sp-1) / -4));
}

.btn:disabled,
.btn[aria-disabled="true"],
:global(.btn):disabled,
:global(.btn[aria-disabled="true"]) {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.primary,
:global(.btn-primary) {
  background: var(--accent-blue);
  color: var(--text-inverse);
}

.primary:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-primary):hover:not(:disabled):not([aria-disabled="true"]) {
  background: color-mix(in srgb, var(--accent-blue) 84%, var(--bg-surface) 16%);
}

.secondary,
:global(.btn-default),
:global(.btn-secondary) {
  background: color-mix(in srgb, var(--bg-surface) 84%, var(--accent-blue) 16%);
  border-color: color-mix(in srgb, var(--border) 70%, var(--accent-blue) 30%);
  color: var(--text-primary);
}

.secondary:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-default):hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-secondary):hover:not(:disabled):not([aria-disabled="true"]) {
  background: color-mix(in srgb, var(--bg-hover) 72%, var(--accent-blue) 28%);
  border-color: color-mix(in srgb, var(--border-light) 70%, var(--accent-blue) 30%);
}

.ghost,
:global(.btn-ghost) {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}

.ghost:hover:not(:disabled):not([aria-disabled="true"]),
:global(.btn-ghost):hover:not(:disabled):not([aria-disabled="true"]) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.danger,
:global(.btn-danger) {
  background: var(--accent-pink);
  color: var(--text-inverse);
}

.sm,
:global(.btn-sm) {
  height: var(--btn-height-sm);
  min-height: var(--touch-target-min);
  padding: 0 var(--sp-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}

.lg,
:global(.btn-lg) {
  height: var(--btn-height-lg);
  min-height: var(--touch-target-min);
  padding: 0 var(--sp-6);
  border-radius: var(--radius-lg);
  font-size: var(--text-lg);
}

.label {
  display: inline-flex;
  align-items: center;
}

.icon {
  display: inline-flex;
  align-items: center;
}

.loading {
  pointer-events: none;
}

.spinner {
  width: var(--sp-3);
  height: var(--sp-3);
  border: calc(var(--sp-1) / 2) solid color-mix(in srgb, currentColor 30%, var(--bg-page) 70%);
  border-top-color: currentColor;
  border-radius: var(--radius-full);
}
```

Create `packages/web/src/components/ui/button/README.md`:

````md
# Button

## 使用
从 `src/components/ui/index.ts` 的 public barrel 导入后使用：

```tsx
<Button variant="primary" size="md">保存</Button>
```

## Props
| Prop | Type | Default | 说明 |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "ghost" \| "danger"` | `"secondary"` | 视觉变体 |
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | 尺寸 |
| `loading` | `boolean` | `false` | 显示 spinner，并禁用 button 点击 |
| `leadingIcon` | `ReactNode` | `undefined` | 文本前图标 |
| `trailingIcon` | `ReactNode` | `undefined` | 文本后图标 |
| `as` | `"button" \| "a"` | `"button"` | 渲染元素 |

## 注意
- `danger` 只用于破坏性操作。
- `loading` 只会对原生 `<button>` 强制 `disabled`；对于 `<a>`，只会加 `aria-busy`。
- 新代码不要再写 `btn btn-*`。
````

Create `packages/web/src/components/ui/index.ts`:

```ts
export { Button } from "./button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./button";
```

- [ ] **Step 5: Run the Button tests and confirm they pass**

```bash
pnpm --filter @coder-studio/web exec vitest run src/components/ui/button/index.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the Button primitive**

```bash
git add \
  packages/web/package.json \
  pnpm-lock.yaml \
  packages/web/src/components/ui/button/index.tsx \
  packages/web/src/components/ui/button/index.module.css \
  packages/web/src/components/ui/button/index.test.tsx \
  packages/web/src/components/ui/button/README.md \
  packages/web/src/components/ui/index.ts
git commit -m "feat: add web button primitive"
```

Expected: one commit containing the new dependency, the new component, the tests, and the barrel export.

---

## Task 5: Migrate the Login Submit Button as the Reference Caller

**Files:**
- Modify: `packages/web/src/features/auth/index.tsx`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

**Goal:** Prove the new `Button` works in a real feature and codify the first migration count drop.

- [ ] **Step 1: Re-run the existing login page tests as the pre-refactor characterization gate**

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/auth/index.test.tsx
```

Expected: PASS.

Do not add a new LoginPage behavior test here. This is a behavior-preserving refactor, and the existing auth suite already exercises the submit button's enabled/disabled and submit behavior.

- [ ] **Step 2: Replace the raw submit button with `<Button>` and update the migration docs**

In `packages/web/src/features/auth/index.tsx`, add the new import directly below the atom imports. Use the current repo-relative path to the public barrel; do not deep-import from `components/ui/button`:

```tsx
import { Button } from "../../components/ui";
```

Then replace the raw submit button block:

```tsx
<button
  className="btn btn-primary btn-lg auth-submit"
  type="submit"
  disabled={checkingStatus || submitting || !password.trim()}
>
  {submitLabel}
</button>
```

with this exact JSX:

```tsx
<Button
  className="auth-submit"
  variant="primary"
  size="lg"
  type="submit"
  disabled={checkingStatus || submitting || !password.trim()}
>
  {submitLabel}
</Button>
```

In `packages/web/src/components/ui/README.md`, replace the `## 已实现组件` section with this exact content:

```md
## 已实现组件
| Component | Tier | Public API | Notes |
|---|---|---|---|
| Button | 0 | `src/components/ui/index.ts` named export only | `primary / secondary / ghost / danger` × `sm / md / lg` |
```

In `packages/web/src/components/ui/MIGRATION.md`, update the `Button` row to this exact line:

```md
| Button | 🟡 in-flight | `.btn .btn-*` | 30 | 2026-05-06 |
```

- [ ] **Step 3: Verify the feature still behaves the same, and verify the caller count dropped by one**

Run:
```bash
pnpm --filter @coder-studio/web exec vitest run src/features/auth/index.test.tsx src/app.test.tsx
```

Expected: PASS.

Then run:
```bash
pnpm --filter @coder-studio/web exec sh -lc \
  "rg -n 'className=.*(^|[^A-Za-z0-9_-])btn([^A-Za-z0-9_-]|$)' src --glob '*.tsx' | wc -l"
```

Expected: `30`.

- [ ] **Step 4: Capture the post-migration auth-preview screenshot and compare it to baseline**

Run from repo root:
```bash
pnpm --dir e2e exec playwright screenshot --device="Desktop Chrome" \
  "file://$(pwd)/packages/web/auth-preview.html" \
  /tmp/ui-button-auth-submit-after.png
```

Expected: PASS, and `/tmp/ui-button-auth-submit-after.png` exists.

Compare `/tmp/ui-button-auth-submit-before.png` and `/tmp/ui-button-auth-submit-after.png`. Accept only subpixel antialiasing drift. Reject spacing, height, radius, color, or alignment changes around `.auth-submit`.

- [ ] **Step 5: Commit the first real migration**

```bash
git add \
  packages/web/src/features/auth/index.tsx \
  packages/web/src/components/ui/README.md \
  packages/web/src/components/ui/MIGRATION.md
git commit -m "refactor: adopt button in login page"
```

Expected: one commit containing exactly the login page migration and the updated UI docs.

---

## Task 6: Final Verification for Plan 1A

**Files:** none (verification-only)

- [ ] **Step 1: Run the full web package test suite**

```bash
pnpm --filter @coder-studio/web test
```

Expected: PASS.

- [ ] **Step 2: Run web-only typecheck**

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run repo lint**

```bash
pnpm lint
```

Expected: no errors, and no new diagnostics in touched files.

Two pre-existing warnings are acceptable if they are still the only diagnostics:
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx:1355`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx:1680`

If lint output changes beyond those existing warnings, stop and investigate before continuing.

- [ ] **Step 4: Review the final diff and verify scope stayed tight**

```bash
git diff --stat HEAD~4..HEAD
git diff --name-only HEAD~4..HEAD
```

Expected changed files:
```text
packages/web/package.json
pnpm-lock.yaml
packages/web/src/app.test.tsx
packages/web/src/hooks/use-viewport.ts
packages/web/src/hooks/use-viewport.test.ts
packages/web/src/features/auth/index.tsx
packages/web/src/components/ui/README.md
packages/web/src/components/ui/MIGRATION.md
packages/web/src/components/ui/index.ts
packages/web/src/components/ui/_internal/use-viewport.ts
packages/web/src/components/ui/_internal/use-viewport.test.tsx
packages/web/src/components/ui/button/index.tsx
packages/web/src/components/ui/button/index.module.css
packages/web/src/components/ui/button/index.test.tsx
packages/web/src/components/ui/button/README.md
```

No other files should change in Plan 1A.

---

## Self-Review Against the Spec

### Coverage check
- `components/ui/` bootstrap docs: covered by Task 2 and Task 5
- single `useViewport()` source of truth: covered by Task 3
- legacy `src/hooks/use-viewport` import path remains covered after the behavioral change: covered by Task 1 and Task 3
- first typed primitive `Button`: covered by Task 4
- one real caller migration: covered by Task 5
- visual before/after checkpoint for the reference migration: covered by Task 1 and Task 5
- no `components.css` deletion yet: preserved by scope and verification in Task 6
- TDD / characterization-first flow: Task 3 and Task 4 are red → green; Task 5 uses characterization tests for a pure refactor

### Placeholder scan
- No `TODO`, `TBD`, `implement later`, `similar to Task N`, or ellipsis-style code placeholders remain.
- All code-bearing steps include exact file content or exact replacement blocks.

### Type consistency check
- `ButtonVariant`: `primary | secondary | ghost | danger` in both tests and implementation
- `ButtonSize`: `sm | md | lg` in both tests and implementation
- `Button` public barrel export matches the component file names
- `useViewport()` returns only `"mobile" | "desktop"` everywhere

### Intentional deferrals
- `portal.tsx`, `focus-trap.ts`, `dismiss.ts`, `render-with-viewport.tsx`, and all non-Button primitives are intentionally deferred to later plans; this is not a gap in this plan.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-06-ui-component-library-phase-a-bootstrap-and-button.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
