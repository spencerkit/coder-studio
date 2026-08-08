# Welcome Page Environment Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the current Local/WSL window environment on the desktop welcome page and let users open another environment without making environment selection a prerequisite for opening a workspace.

**Architecture:** Move the selector out of the top-bar feature into a shared `desktop-environment` feature, then give the shared component `topbar` and `welcome` trigger variants. Both variants retain one launch/progress/error state machine and one popover; the welcome variant adds inline loading and retry feedback inside the first workflow card.

**Tech Stack:** React 19, TypeScript, CSS Modules, Jotai-backed i18n, Testing Library, Vitest, Biome, pnpm monorepo scripts.

**Execution note:** The user explicitly requested development on the current `feature/desktop` branch, so do not create a worktree.

---

## File Map

### Create or move

- `packages/web/src/features/desktop-environment/index.ts` — public feature export.
- `packages/web/src/features/desktop-environment/components/environment-switcher.tsx` — shared environment data, launch state, popover, and trigger variants; moved from `features/topbar`.
- `packages/web/src/features/desktop-environment/components/environment-switcher.module.css` — top-bar and welcome trigger styling; moved from `features/topbar` and extended.
- `packages/web/src/features/desktop-environment/components/environment-switcher.test.tsx` — selector behavior and variant coverage; moved from `features/topbar` and extended.

### Modify

- `packages/web/src/features/topbar/index.tsx` — import the shared selector and request the `topbar` variant.
- `packages/web/src/features/welcome/index.tsx` — render the `welcome` variant inside Step 1 on desktop.
- `packages/web/src/features/welcome/index.test.tsx` — verify placement, primary-action independence, and mobile omission.
- `packages/web/src/locales/en.json` — English welcome-environment state and action labels.
- `packages/web/src/locales/zh.json` — matching Chinese labels.

### Preserve

- `packages/desktop/**` and the Desktop preload/IPC contract — no protocol changes.
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx` — workspace selection stays independent.
- Existing untracked files under `docs/` — stage only files named by each task.

---

### Task 1: Rehome the Environment Selector Without Behavior Changes

**Files:**

- Create: `packages/web/src/features/desktop-environment/index.ts`
- Move: `packages/web/src/features/topbar/components/environment-switcher.tsx`
- Move: `packages/web/src/features/topbar/components/environment-switcher.module.css`
- Move: `packages/web/src/features/topbar/components/environment-switcher.test.tsx`
- Modify: `packages/web/src/features/topbar/index.tsx`

- [ ] **Step 1: Run the selector and top-bar baseline tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/topbar/components/environment-switcher.test.tsx \
  src/features/topbar/index.test.tsx
```

Expected: both files pass before the move.

- [ ] **Step 2: Move the selector files into the shared feature**

Move the three existing files while preserving history:

```bash
mkdir -p packages/web/src/features/desktop-environment/components
git mv packages/web/src/features/topbar/components/environment-switcher.tsx \
  packages/web/src/features/desktop-environment/components/environment-switcher.tsx
git mv packages/web/src/features/topbar/components/environment-switcher.module.css \
  packages/web/src/features/desktop-environment/components/environment-switcher.module.css
git mv packages/web/src/features/topbar/components/environment-switcher.test.tsx \
  packages/web/src/features/desktop-environment/components/environment-switcher.test.tsx
```

The relative imports from `components/environment-switcher.tsx` and its test remain at the same directory depth and should continue to resolve.

- [ ] **Step 3: Add the feature export and update TopBar**

Create `packages/web/src/features/desktop-environment/index.ts`:

```ts
export { EnvironmentSwitcher } from "./components/environment-switcher";
export type { EnvironmentSwitcherVariant } from "./components/environment-switcher";
```

Update `packages/web/src/features/topbar/index.tsx`:

```ts
import { EnvironmentSwitcher } from "../desktop-environment";
```

Remove the old `./components/environment-switcher` import. Keep the render call unchanged for this task:

```tsx
<EnvironmentSwitcher />
```

- [ ] **Step 4: Run the moved selector and top-bar tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/desktop-environment/components/environment-switcher.test.tsx \
  src/features/topbar/index.test.tsx
```

Expected: all existing tests pass with no behavior changes.

- [ ] **Step 5: Commit the structural change**

```bash
git add \
  -A -- \
  packages/web/src/features/desktop-environment \
  packages/web/src/features/topbar
git commit -m "refactor(web): share desktop environment selector"
```

Expected: the commit contains only the selector move, feature export, and TopBar import update.

---

### Task 2: Add the Welcome Trigger and Persistent Launch Feedback

**Files:**

- Modify: `packages/web/src/features/desktop-environment/components/environment-switcher.tsx`
- Modify: `packages/web/src/features/desktop-environment/components/environment-switcher.module.css`
- Modify: `packages/web/src/features/desktop-environment/components/environment-switcher.test.tsx`
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Extend the test renderer for trigger variants**

In `environment-switcher.test.tsx`, change the helper to accept a variant:

```tsx
import type { EnvironmentSwitcherVariant } from "./environment-switcher";

function renderSwitcher(
  variant: EnvironmentSwitcherVariant = "topbar",
  locale: "en" | "zh" = "en"
) {
  const store = createStore();
  store.set(localeAtom, locale);
  return render(
    <Provider store={store}>
      <EnvironmentSwitcher variant={variant} />
    </Provider>
  );
}
```

Do not change the existing test calls; their default remains the top-bar behavior.

- [ ] **Step 2: Write failing welcome-variant tests**

Add these cases to `environment-switcher.test.tsx`:

```tsx
it("renders the active environment as optional welcome-page context", async () => {
  installDesktopApi();
  renderSwitcher("welcome");

  expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
  expect(screen.getByText("Current window environment")).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Open another environment from Local: Windows",
    })
  ).toBeInTheDocument();
});

it("localizes the welcome environment context in Chinese", async () => {
  installDesktopApi();
  renderSwitcher("welcome", "zh");

  expect(await screen.findByText("Local: Windows")).toBeInTheDocument();
  expect(screen.getByText("当前窗口环境")).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "从 Local: Windows 打开另一个运行环境",
    })
  ).toBeInTheDocument();
});

it("keeps welcome launch feedback reachable after the popover closes", async () => {
  const user = userEvent.setup();
  const { openEnvironment } = installDesktopApi();
  const opening = deferred<{ status: "opened" }>();
  openEnvironment.mockReturnValueOnce(opening.promise);
  renderSwitcher("welcome");

  const trigger = await screen.findByRole("button", {
    name: "Open another environment from Local: Windows",
  });
  await user.click(trigger);
  await user.click(await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ }));
  await user.click(trigger);

  expect(screen.queryByRole("dialog", { name: "Coder Studio environment" })).toBeNull();
  expect(screen.getByText("Opening WSL: Ubuntu-24.04…")).toBeInTheDocument();

  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "Coder Studio environment" })).toBeInTheDocument();

  opening.resolve({ status: "opened" });
  await waitFor(() => expect(screen.queryByText("Opening WSL: Ubuntu-24.04…")).toBeNull());
  expect(screen.getByText("Local: Windows")).toBeInTheDocument();
});

it("offers inline retry for the last failed environment", async () => {
  const user = userEvent.setup();
  const { openEnvironment } = installDesktopApi();
  openEnvironment
    .mockRejectedValueOnce(new Error("Unable to launch WSL instance"))
    .mockResolvedValueOnce({ status: "opened" });
  renderSwitcher("welcome");

  await user.click(
    await screen.findByRole("button", {
      name: "Open another environment from Local: Windows",
    })
  );
  await user.click(await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to launch WSL instance");
  const trigger = screen.getByRole("button", {
    name: "Open another environment from Local: Windows",
  });
  await user.click(trigger);
  await user.click(trigger);
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to launch WSL instance");

  const retry = await screen.findByRole("button", {
    name: "Retry opening WSL: Ubuntu-24.04",
  });
  await user.click(retry);

  expect(openEnvironment).toHaveBeenNthCalledWith(2, "wsl:ubuntu");
});

it("omits both variants outside Windows Desktop", () => {
  const { container: missingBridge } = renderSwitcher("welcome");
  expect(missingBridge).toBeEmptyDOMElement();

  installDesktopApi();
  Object.defineProperty(window, "coderStudioDesktop", {
    configurable: true,
    value: { ...window.coderStudioDesktop, platform: "linux" },
  });
  const { container: nonWindows } = renderSwitcher("welcome");
  expect(nonWindows).toBeEmptyDOMElement();
});
```

Also return `api` from `installDesktopApi` and add an initial-loading test by deferring `listEnvironments` and `getActiveEnvironment` before render:

```tsx
it("shows a stable checking state while welcome environment data loads", async () => {
  const { api } = installDesktopApi();
  const environments = deferred<DesktopEnvironmentSummary[]>();
  const activeEnvironment = deferred<DesktopEnvironmentSummary>();
  vi.mocked(api.listEnvironments).mockReturnValueOnce(environments.promise);
  vi.mocked(api.getActiveEnvironment).mockReturnValueOnce(activeEnvironment.promise);

  renderSwitcher("welcome");

  expect(await screen.findByText("Checking environment…")).toBeInTheDocument();
  expect(screen.getByTestId("welcome-environment-context")).toBeInTheDocument();

  environments.resolve([nativeEnvironment, wslEnvironment]);
  activeEnvironment.resolve(nativeEnvironment);
  expect(await screen.findByText("Current window environment")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/desktop-environment/components/environment-switcher.test.tsx
```

Expected: FAIL because `EnvironmentSwitcherVariant`, the `variant` prop, welcome markup, persistent inline status, and retry action do not exist.

- [ ] **Step 4: Add localized labels**

Extend `desktop_environment` in `packages/web/src/locales/en.json`:

```json
"current_window_environment": "Current window environment",
"open_another_from": "Open another environment from {environment}",
"opening_named": "Opening {environment}…",
"open_failed_named": "Could not open {environment}",
"retry_named": "Retry opening {environment}"
```

Add matching keys to `packages/web/src/locales/zh.json`:

```json
"current_window_environment": "当前窗口环境",
"open_another_from": "从 {environment} 打开另一个运行环境",
"opening_named": "正在打开 {environment}…",
"open_failed_named": "未能打开 {environment}",
"retry_named": "重新尝试打开 {environment}"
```

Keep the existing `title`, `select`, `checking`, `preparing`, and status keys intact.

- [ ] **Step 5: Add variant and retry state to the shared component**

In `environment-switcher.tsx`, introduce the public type and prop:

```ts
export type EnvironmentSwitcherVariant = "topbar" | "welcome";

interface EnvironmentSwitcherProps {
  variant?: EnvironmentSwitcherVariant;
}

export function EnvironmentSwitcher({ variant = "topbar" }: EnvironmentSwitcherProps) {
```

Separate refresh failures from launch failures so opening the popover does not erase retry state:

```ts
interface EnvironmentLaunchFailure {
  environment: DesktopEnvironmentSummary;
  message: string;
}

const [refreshError, setRefreshError] = useState<string | null>(null);
const [launchFailure, setLaunchFailure] = useState<EnvironmentLaunchFailure | null>(null);
```

Initialize `loading` from bridge availability so the welcome trigger does not briefly claim Local before the first Desktop request completes:

```ts
const [loading, setLoading] = useState(api?.platform === "win32");
```

Update `refresh` to clear and set only `refreshError`. At the start of `openEnvironment`, clear stale launch failure state:

```ts
setLaunchFailure(null);
setOpeningId(environment.id);
```

In its `catch`, preserve the target for retry:

```ts
} catch (openError) {
  const message = getErrorMessage(openError);
  setLaunchFailure({ environment, message });
  setOpeningId(null);
  setProgress(null);
}
```

On success, also clear `launchFailure`. In the popover error area, render `launchFailure?.message ?? refreshError`. A later `refresh()` may clear discovery errors but must not clear a launch failure.

Derive the target currently opening:

```ts
const openingEnvironment = openingId
  ? environments.find((environment) => environment.id === openingId) ?? null
  : null;
```

- [ ] **Step 6: Render one shared Popover with variant-specific triggers**

Extract the current top-bar button into a local `topbarTrigger` variable without changing its markup:

```tsx
const topbarTrigger = (
  <button aria-label={t("desktop_environment.title")} className={styles.trigger} type="button">
    {active?.kind === "wsl" ? (
      <Terminal aria-hidden="true" size={14} />
    ) : (
      <Monitor aria-hidden="true" size={14} />
    )}
    <span className={styles.triggerLabel}>
      {active?.label ?? t("desktop_environment.local_windows")}
    </span>
    {openingId ? (
      <LoaderCircle aria-hidden="true" className={styles.spinner} size={13} />
    ) : (
      <ChevronDown aria-hidden="true" size={13} />
    )}
  </button>
);
```

Create the welcome trigger next to it:

```tsx
const welcomeLabel = openingEnvironment
  ? t("desktop_environment.opening_named", { environment: openingEnvironment.label })
  : launchFailure
    ? t("desktop_environment.open_failed_named", {
        environment: launchFailure.environment.label,
      })
    : active?.label ?? t("desktop_environment.local_windows");

const checkingEnvironment = loading && active === null;
const activeLabel = active?.label ?? t("desktop_environment.local_windows");

const welcomeTrigger = (
  <button
    aria-label={t("desktop_environment.open_another_from", {
      environment: active?.label ?? t("desktop_environment.local_windows"),
    })}
    className={styles.welcomeTrigger}
    type="button"
  >
    <span className={styles.welcomeIcon} aria-hidden="true">
      {active?.kind === "wsl" ? <Terminal size={15} /> : <Monitor size={15} />}
    </span>
    <span className={styles.welcomeText}>
      <span className={styles.welcomeEyebrow}>
        {checkingEnvironment
          ? t("desktop_environment.checking")
          : openingEnvironment || launchFailure
          ? welcomeLabel
          : t("desktop_environment.current_window_environment")}
      </span>
      <span className={styles.welcomeEnvironment} title={activeLabel}>
        {activeLabel}
      </span>
    </span>
    {checkingEnvironment || openingEnvironment ? (
      <LoaderCircle aria-hidden="true" className={styles.spinner} size={14} />
    ) : (
      <span className={styles.welcomeAction}>{t("desktop_environment.select")}</span>
    )}
  </button>
);
```

In the current `Popover`, keep the full menu `content` block unchanged except for reading the separated error value:

```tsx
{launchFailure?.message || refreshError ? (
  <div className={styles.error} role="alert">
    <CircleAlert aria-hidden="true" size={14} />
    <span>{launchFailure?.message ?? refreshError}</span>
  </div>
) : null}
```

Use the variant to choose its one trigger child, then assign the full Popover to `selector`:

```tsx
const selector = (
  <Popover
    title={t("desktop_environment.title")}
    open={open}
    onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) void refresh();
    }}
    placement="bottom-start"
    contentClassName={styles.popover}
    content={menu}
  >
    {variant === "welcome" ? welcomeTrigger : topbarTrigger}
  </Popover>
);
```

Move the component's complete current menu root, `<div className={styles.menu}>`, into a `const menu` JSX variable. Preserve every existing group, item-disabled rule, runtime-version row, progress bar, and status message; replace only the error expression with the separated refresh/launch expression shown above.

Wrap `selector` only for the welcome variant so retry remains a separate valid button rather than nesting interactive controls:

```tsx
if (variant === "topbar") return selector;

return (
  <div
    className={styles.welcomeShell}
    data-testid="welcome-environment-context"
    aria-live="polite"
  >
    <div className={styles.welcomeSelector}>{selector}</div>
    {launchFailure ? (
      <button
        aria-label={t("desktop_environment.retry_named", {
          environment: launchFailure.environment.label,
        })}
        className={styles.retry}
        onClick={() => void openEnvironment(launchFailure.environment)}
        type="button"
      >
        {t("action.retry")}
      </button>
    ) : null}
  </div>
);
```

Do not clear progress when `onOpenChange(false)` runs. Reopening must show the same pending state.

Update `packages/web/src/features/topbar/index.tsx` to make its intent explicit:

```tsx
<EnvironmentSwitcher variant="topbar" />
```

- [ ] **Step 7: Style the welcome variant and reduced motion**

Add CSS Module rules using existing tokens:

```css
.welcomeShell {
  align-items: stretch;
  background: var(--surface-input);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  display: flex;
  min-height: 48px;
  overflow: hidden;
}

.welcomeSelector {
  flex: 1;
  min-width: 0;
}

.welcomeSelector > span {
  display: block;
  height: 100%;
}

.welcomeTrigger {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: var(--sp-2);
  height: 100%;
  min-height: 48px;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  width: 100%;
}

.welcomeTrigger:hover {
  background: var(--surface-hover);
}

.welcomeIcon {
  align-items: center;
  background: var(--surface-active);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  display: inline-flex;
  flex: 0 0 auto;
  height: 30px;
  justify-content: center;
  width: 30px;
}

.welcomeText {
  display: grid;
  flex: 1;
  min-width: 0;
}

.welcomeEyebrow,
.welcomeAction {
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
}

.welcomeEnvironment {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.welcomeAction,
.retry {
  flex: 0 0 auto;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retry {
  background: transparent;
  border: 0;
  border-left: 1px solid var(--status-danger-border);
  color: var(--status-danger-fg);
  cursor: pointer;
  padding: 0 var(--sp-3);
}

.welcomeTrigger:focus-visible,
.retry:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
    opacity: 0.8;
  }
}
```

Keep all current `.trigger`, `.popover`, menu-item, progress, and error rules for the top-bar variant.

- [ ] **Step 8: Run the selector tests and confirm GREEN**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/desktop-environment/components/environment-switcher.test.tsx
```

Expected: all existing top-bar tests and the new welcome/loading/retry tests pass.

- [ ] **Step 9: Commit the shared variant behavior**

```bash
git add \
  packages/web/src/features/desktop-environment/components/environment-switcher.tsx \
  packages/web/src/features/desktop-environment/components/environment-switcher.module.css \
  packages/web/src/features/desktop-environment/components/environment-switcher.test.tsx \
  packages/web/src/features/topbar/index.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat(web): add welcome environment selector variant"
```

---

### Task 3: Place the Environment Context in Welcome Step 1

**Files:**

- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Test: `packages/web/src/features/topbar/index.test.tsx`

- [ ] **Step 1: Mock the shared selector in the welcome integration test**

Add a viewport-aware feature mock near the existing mocks in `welcome/index.test.tsx`:

```tsx
vi.mock("../desktop-environment", () => ({
  EnvironmentSwitcher: ({ variant }: { variant?: string }) => (
    <div data-testid={`environment-switcher-${variant ?? "topbar"}`} />
  ),
}));
```

- [ ] **Step 2: Write failing placement and mobile-omission tests**

Add:

```tsx
it("places the desktop environment context before the primary workspace action", () => {
  viewportMocks.viewport = "desktop";
  const store = createStore();
  const { container } = render(
    <Provider store={store}>
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    </Provider>
  );

  const firstStep = container.querySelector(".welcome-step-card");
  const environment = screen.getByTestId("environment-switcher-welcome");
  const openWorkspace = screen.getByRole("button", { name: "Open Workspace" });

  expect(firstStep).toContainElement(environment);
  expect(firstStep).toContainElement(openWorkspace);
  expect(
    environment.compareDocumentPosition(openWorkspace) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it("does not add the desktop environment context to the mobile welcome layout", () => {
  viewportMocks.viewport = "mobile";
  const store = createStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    </Provider>
  );

  expect(screen.queryByTestId("environment-switcher-welcome")).toBeNull();
});
```

- [ ] **Step 3: Run the welcome tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/welcome/index.test.tsx
```

Expected: FAIL because `WelcomePage` does not render the shared environment selector.

- [ ] **Step 4: Render the welcome variant inside Step 1**

Update `welcome/index.tsx` imports:

```ts
import { EnvironmentSwitcher } from "../desktop-environment";
```

Inside the first `.welcome-step-card`, place the selector after the detail paragraph and before `.welcome-btn`:

```tsx
<p className="welcome-step-detail meta-text">{t("welcome.step_1_detail")}</p>

{!isMobile ? <EnvironmentSwitcher variant="welcome" /> : null}

<button className="welcome-btn" onClick={handleOpenWorkspace}>
```

The selector itself returns `null` when the Desktop bridge is absent or the platform is not Windows, so browser and non-Windows desktop behavior remain unchanged.

- [ ] **Step 5: Run welcome, selector, and top-bar tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/welcome/index.test.tsx \
  src/features/desktop-environment/components/environment-switcher.test.tsx \
  src/features/topbar/index.test.tsx
```

Expected: all focused tests pass; the existing Open Workspace modal test remains green.

- [ ] **Step 6: Commit the welcome integration**

```bash
git add \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/welcome/index.test.tsx
git commit -m "feat(web): show environment entry before workspace selection"
```

---

### Task 4: Verify the Complete Change

**Files:**

- Verify only; fix only failures caused by Tasks 1–3.

- [ ] **Step 1: Run focused Web tests**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/desktop-environment/components/environment-switcher.test.tsx \
  src/features/welcome/index.test.tsx \
  src/features/topbar/index.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run Web type checking**

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: exit code 0 with no type errors.

- [ ] **Step 3: Run Biome and diff validation on touched files**

```bash
pnpm exec biome check \
  packages/web/src/features/desktop-environment \
  packages/web/src/features/topbar/index.tsx \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Run repository-level verification**

```bash
pnpm ci:verify
```

Expected: changeset validation, lint, all package tests, type-compatible builds, Web production build, and CLI build pass.

- [ ] **Step 5: Inspect final scope**

```bash
git status --short
git log -5 --oneline
```

Expected: no tracked implementation changes remain uncommitted. Pre-existing untracked `docs/` files remain untouched.

- [ ] **Step 6: Record the Windows manual-test boundary**

Do not run Windows-only packaging on Linux. Report these remaining acceptance checks:

- Welcome page in both Local and WSL windows with no workspace.
- Open another environment, close/reopen the popover during Loading, and focus the ready window.
- Failure and inline retry.
- Keyboard focus, narrow Desktop width, light/dark theme.

No additional commit is required unless verification reveals and fixes an in-scope issue.
