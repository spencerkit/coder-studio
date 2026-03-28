# No-Workspace Welcome Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the forced startup workspace picker with a lightweight welcome screen when no workspace is open, and make the workspace launch overlay dismissible.

**Architecture:** Keep backend workspace bootstrap and launch behavior unchanged. Move the “no workspace” experience entirely into frontend state and UI by stopping automatic overlay opening, rendering a dedicated empty-state welcome surface in `WorkspaceScreen`, and teaching the existing launch overlay how to close cleanly back to the welcome screen.

**Tech Stack:** React 19 + TypeScript, existing workbench state helpers, node:test, Playwright, Vite

---

## File Map

### Create

- `apps/web/src/components/WorkspaceWelcomeScreen/WorkspaceWelcomeScreen.tsx` — centered empty-state welcome UI with actions for opening the workspace picker, history drawer, and settings.
- `apps/web/src/components/WorkspaceWelcomeScreen/index.ts` — barrel export for the welcome screen component.
- `tests/workspace-welcome-screen.test.ts` — node tests for empty-state copy wiring and source-level guardrails around the welcome screen entry points.

### Modify

- `apps/web/src/state/workbench-core.ts` — stop defaulting the workspace launch overlay to visible when no workspace exists.
- `apps/web/src/shared/utils/workspace.ts` — preserve empty-state overlay-hidden behavior during bootstrap and when closing the last workspace.
- `apps/web/src/components/TopBar/TopBar.tsx` — handle the zero-workspace top bar presentation without implying an active tab strip.
- `apps/web/src/components/WorkspaceLaunchOverlay/WorkspaceLaunchOverlay.tsx` — add close affordances, backdrop dismissal, and escape dismissal support.
- `apps/web/src/features/workspace/WorkspaceScreen.tsx` — derive the welcome screen state, wire welcome actions, and render the new empty state.
- `apps/web/src/i18n.ts` — add welcome-screen and launch-overlay-close copy in English and Chinese.
- `apps/web/src/styles/app.css` — add welcome-screen styling and launch-overlay close button styling in the existing flat visual language.
- `tests/e2e/e2e.spec.ts` — add browser coverage for welcome screen, launch overlay open/close, and closing the last workspace returning to empty state.

## Task 1: Stop Auto-Opening The Workspace Picker In Empty State

**Files:**
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Test: `tests/workspace-welcome-screen.test.ts`

- [ ] **Step 1: Write the failing empty-state state test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkbenchState,
} from "../apps/web/src/state/workbench-core.ts";
import {
  buildWorkbenchStateFromBootstrap,
} from "../apps/web/src/shared/utils/workspace.ts";
import {
  defaultAppSettings,
} from "../apps/web/src/shared/app/settings.ts";

test("empty workbench state does not auto-open the launch overlay", () => {
  const normalized = normalizeWorkbenchState({
    tabs: [],
    overlay: {
      visible: true,
      mode: "local",
      input: "",
      target: { type: "native" },
    },
  });

  assert.equal(normalized.overlay.visible, false);
});

test("bootstrap with zero open workspaces keeps the launch overlay hidden", () => {
  const next = buildWorkbenchStateFromBootstrap(
    {
      tabs: [],
      activeTabId: "",
      layout: {
        leftWidth: 320,
        rightWidth: 320,
        rightSplit: 64,
        showCodePanel: true,
        showTerminalPanel: true,
      },
      overlay: {
        visible: false,
        mode: "local",
        input: "",
        target: { type: "native" },
      },
    },
    {
      workspaces: [],
      ui_state: {
        open_workspace_ids: [],
        active_workspace_id: null,
        layout: {
          left_width: 320,
          right_width: 320,
          right_split: 64,
          show_code_panel: true,
          show_terminal_panel: true,
        },
      },
    },
    "en",
    defaultAppSettings(),
  );

  assert.equal(next.tabs.length, 0);
  assert.equal(next.overlay.visible, false);
});
```

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
```

Expected:

```text
not ok 1 - empty workbench state does not auto-open the launch overlay
not ok 2 - bootstrap with zero open workspaces keeps the launch overlay hidden
```

- [ ] **Step 3: Update empty-state normalization and bootstrap helpers**

```ts
export const normalizeWorkbenchState = (input: Partial<WorkbenchState> | null | undefined): WorkbenchState => {
  const fallback = createDefaultWorkbenchState();
  if (!input?.tabs?.length) {
    return {
      ...fallback,
      overlay: {
        ...fallback.overlay,
        visible: false,
        mode: input?.overlay?.mode ?? fallback.overlay.mode,
        input: input?.overlay?.input ?? fallback.overlay.input,
        target: input?.overlay?.target ?? fallback.overlay.target,
      },
    };
  }

  const locale = getPreferredLocale();
  const tabs = input.tabs.filter(Boolean).map((tab) => sanitizeTabSessions(tab, locale));
  if (!tabs.length) {
    return {
      ...fallback,
      overlay: {
        ...fallback.overlay,
        visible: false,
      },
    };
  }
};
```

```ts
return {
  tabs,
  activeTabId: resolveActiveWorkspaceId(tabs, bootstrap.ui_state.active_workspace_id),
  layout: workbenchLayoutFromBackend(bootstrap.ui_state.layout),
  overlay: {
    ...current.overlay,
    visible: false,
    input: tabs.length === 0 ? current.overlay.input : "",
  },
};
```

```ts
return {
  ...current,
  tabs,
  activeTabId: resolveActiveWorkspaceId(tabs, uiState.active_workspace_id),
  layout: workbenchLayoutFromBackend(uiState.layout),
  overlay: {
    ...current.overlay,
    visible: false,
  },
};
```

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
```

Expected:

```text
# pass 2
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/workbench-core.ts apps/web/src/shared/utils/workspace.ts tests/workspace-welcome-screen.test.ts
git commit -m "fix: stop auto-opening workspace picker on empty startup"
```

## Task 2: Add The No-Workspace Welcome Screen

**Files:**
- Create: `apps/web/src/components/WorkspaceWelcomeScreen/WorkspaceWelcomeScreen.tsx`
- Create: `apps/web/src/components/WorkspaceWelcomeScreen/index.ts`
- Modify: `apps/web/src/components/TopBar/TopBar.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/i18n.ts`
- Modify: `apps/web/src/styles/app.css`
- Test: `tests/workspace-welcome-screen.test.ts`

- [ ] **Step 1: Write the failing welcome-screen source test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("workspace screen renders a dedicated welcome screen entry point", async () => {
  const source = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /WorkspaceWelcomeScreen/);
  assert.match(source, /showWelcomeScreen/);
  assert.match(source, /onOpenWorkspacePicker/);
  assert.match(source, /onOpenHistory/);
});
```

- [ ] **Step 2: Run the source test and confirm failure**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
```

Expected:

```text
not ok 3 - workspace screen renders a dedicated welcome screen entry point
```

- [ ] **Step 3: Add welcome-screen copy, empty-state top bar treatment, and component**

```tsx
type WorkspaceWelcomeScreenProps = {
  hasHistory: boolean;
  onOpenWorkspacePicker: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  t: Translator;
};

export const WorkspaceWelcomeScreen = ({
  hasHistory,
  onOpenWorkspacePicker,
  onOpenHistory,
  onOpenSettings,
  t,
}: WorkspaceWelcomeScreenProps) => (
  <section className="workspace-welcome-screen" data-testid="workspace-welcome-screen">
    <div className="workspace-welcome-shell">
      <span className="section-kicker">{t("workspaceWelcomeKicker")}</span>
      <h1>{t("workspaceWelcomeTitle")}</h1>
      <p>{t("workspaceWelcomeBody")}</p>
      <div className="workspace-welcome-actions">
        <button type="button" className="btn primary" onClick={onOpenWorkspacePicker} data-testid="workspace-welcome-open">
          {t("workspaceWelcomeOpenWorkspace")}
        </button>
        {hasHistory ? (
          <button type="button" className="btn ghost" onClick={onOpenHistory} data-testid="workspace-welcome-history">
            {t("workspaceWelcomeOpenHistory")}
          </button>
        ) : null}
      </div>
      <button type="button" className="workspace-welcome-settings" onClick={onOpenSettings}>
        {t("workspaceWelcomeOpenSettings")}
      </button>
    </div>
  </section>
);
```

```ts
workspaceWelcomeKicker: "Claude Workspace",
workspaceWelcomeTitle: "Start a Claude workspace",
workspaceWelcomeBody: "Open a local repository, connect a remote repo, or restore a previous Claude session.",
workspaceWelcomeOpenWorkspace: "Open workspace",
workspaceWelcomeOpenHistory: "Restore from history",
workspaceWelcomeOpenSettings: "Open settings",
```

```ts
const showWelcomeScreen = bootstrapReady && state.tabs.length === 0 && !state.overlay.visible;
const workspaceUiReady = bootstrapReady && (state.tabs.length > 0 || state.overlay.visible || showWelcomeScreen);
```

```tsx
const hasWorkspaceTabs = workspaceTabs.length > 0;

<div className="topbar-session-strip topbar-workspace-strip" data-testid="workspace-topbar" data-empty={!hasWorkspaceTabs}>
  <button
    type="button"
    className={`session-top-history ${historyOpen ? "active" : ""}`}
    onClick={onToggleHistory}
    title={t("history")}
    aria-label={t("history")}
    data-testid="history-toggle"
  >
    <HeaderHistoryIcon />
  </button>
  {hasWorkspaceTabs ? workspaceTabs.map((item) => (
    <div
      key={item.id}
      role="button"
      tabIndex={0}
      className={`session-top-tab workspace-top-tab ${item.active ? "active" : ""} ${item.hasRunning ? "running-glow" : ""}`}
      onClick={() => onSwitchWorkspace(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSwitchWorkspace(item.id);
        }
      }}
      title={item.label}
    >
      <span className={`session-top-dot ${item.hasRunning ? "active pulse" : "idle"}`} />
      <span className="session-top-label">{item.label}</span>
      {!item.active && item.unread > 0 ? (
        <span className="session-top-unread" title={`${item.unread}`} aria-label={`${item.unread}`}>
          {item.unread > 9 ? "9+" : item.unread}
        </span>
      ) : null}
      <button
        type="button"
        className="session-top-close"
        title={t("close")}
        aria-label={t("close")}
        onClick={(event) => {
          event.stopPropagation();
          onRemoveTab(item.id);
        }}
      >
        <HeaderCloseIcon />
      </button>
    </div>
  )) : (
    <div className="topbar-empty-state">
      <span className="section-kicker">{t("workspaceWelcomeKicker")}</span>
      <span className="topbar-empty-title">{t("workspaceWelcomeTitle")}</span>
    </div>
  )}
  <button
    type="button"
    className="session-top-add"
    onClick={onAddTab}
    title={locale === "zh" ? "新建工作区" : "Add workspace"}
    aria-label={locale === "zh" ? "新建工作区" : "Add workspace"}
  >
    <HeaderAddIcon />
  </button>
</div>
```

```tsx
{showWelcomeScreen ? (
  <WorkspaceWelcomeScreen
    hasHistory={historyGroups.length > 0}
    onOpenWorkspacePicker={onAddTab}
    onOpenHistory={() => setHistoryOpen(true)}
    onOpenSettings={onOpenSettings}
    t={t}
  />
) : (
  <WorkspaceShell
    isFocusMode={isFocusMode}
    isCodeExpanded={isCodeExpanded}
    showAgentPanel={showAgentPanel}
    showCodePanel={showCodePanel}
    showTerminalPanel={showTerminalPanel}
    rightSplit={state.layout.rightSplit}
    statusItems={workspaceShellSummary}
    runtimeHint={locale === "zh" ? "⌘/Ctrl+K 快速操作" : "⌘/Ctrl+K actions"}
    statusBanner={workspaceStatusBanner}
    agentPanel={workspaceAgentPanel}
    codePanel={workspaceCodePanel}
    terminalPanel={workspaceTerminalPanel}
    onToggleRightPane={toggleRightPane}
    t={t}
  />
)}
```

- [ ] **Step 4: Add flat styling for the welcome screen and empty top bar**

```css
.workspace-welcome-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 56px);
  padding: 32px;
}

.workspace-welcome-shell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  width: min(560px, 100%);
}

.workspace-welcome-shell h1 {
  margin: 0;
  font-size: clamp(28px, 4vw, 40px);
  line-height: 1.05;
}

.workspace-welcome-shell p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.6;
}

.workspace-welcome-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.topbar-empty-state {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
  padding-inline: 10px;
}

.topbar-empty-title {
  font-size: 13px;
  line-height: 1.2;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Run the targeted tests and build**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
pnpm build:web
```

Expected:

```text
# pass 3
✓ built in
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/WorkspaceWelcomeScreen/WorkspaceWelcomeScreen.tsx apps/web/src/components/WorkspaceWelcomeScreen/index.ts apps/web/src/components/TopBar/TopBar.tsx apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/i18n.ts apps/web/src/styles/app.css tests/workspace-welcome-screen.test.ts
git commit -m "feat: add empty-state workspace welcome screen"
```

## Task 3: Make The Workspace Launch Overlay Dismissible

**Files:**
- Modify: `apps/web/src/components/WorkspaceLaunchOverlay/WorkspaceLaunchOverlay.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/i18n.ts`
- Test: `tests/workspace-welcome-screen.test.ts`

- [ ] **Step 1: Write the failing overlay-dismissal source test**

```ts
test("workspace launch overlay exposes explicit close wiring", async () => {
  const source = await fs.readFile(
    new URL("../apps/web/src/components/WorkspaceLaunchOverlay/WorkspaceLaunchOverlay.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onClose/);
  assert.match(source, /data-testid="launch-overlay-close"/);
  assert.match(source, /onClick=\{onClose\}/);
});
```

- [ ] **Step 2: Run the source test and confirm failure**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
```

Expected:

```text
not ok 4 - workspace launch overlay exposes explicit close wiring
```

- [ ] **Step 3: Add close behavior to the overlay and wire it from the screen**

```tsx
import { useEffect } from "react";
import { HeaderCloseIcon } from "../icons";

type WorkspaceLaunchOverlayProps = {
  visible: boolean;
  target: ExecTarget;
  input: string;
  canUseWsl: boolean;
  folderBrowser: FolderBrowserState;
  onUpdateTarget: (target: ExecTarget) => void;
  onBrowseDirectory: (path?: string, selectCurrent?: boolean) => void;
  onStartWorkspace: () => void;
  onClose: () => void;
  t: Translator;
};
```

```tsx
if (!visible) return null;

return (
  <div
    className="overlay"
    data-testid="overlay"
    onClick={onClose}
  >
    <div
      className="modal onboarding-modal launch-overlay-shell"
      data-testid="launch-overlay-shell"
      data-density="compact"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="onboarding-header launch-overlay-header">
        <div className="launch-overlay-copy">
          <span className="section-kicker">{t("startWorkspace")}</span>
          <h2>{t("localFolder")}</h2>
          <p>{t("localFolderHint")}</p>
        </div>
        <button
          type="button"
          className="launch-overlay-close"
          onClick={onClose}
          aria-label={t("close")}
          data-testid="launch-overlay-close"
        >
          <HeaderCloseIcon />
        </button>
      </div>
    </div>
  </div>
);
```

```tsx
const onCloseWorkspaceOverlay = () => {
  updateState((current) => ({
    ...current,
    overlay: {
      ...current.overlay,
      visible: false,
      input: "",
    },
  }));
};
```

```tsx
<WorkspaceLaunchOverlay
  visible={showWorkspaceLaunchOverlay}
  target={state.overlay.target}
  input={state.overlay.input}
  canUseWsl={overlayCanUseWsl}
  folderBrowser={folderBrowser}
  onUpdateTarget={onOverlayUpdateTarget}
  onBrowseDirectory={onBrowseOverlayDirectory}
  onStartWorkspace={onStartWorkspace}
  onClose={onCloseWorkspaceOverlay}
  t={t}
/>
```

- [ ] **Step 4: Add keyboard and visual polish**

```tsx
useEffect(() => {
  if (!visible) return undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [visible, onClose]);
```

```css
.launch-overlay-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.launch-overlay-close:hover,
.launch-overlay-close:focus-visible {
  background: color-mix(in srgb, var(--surface) 78%, var(--accent) 22%);
  color: var(--text);
  outline: none;
}
```

- [ ] **Step 5: Run the targeted tests and build**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
pnpm build:web
```

Expected:

```text
# pass 4
✓ built in
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/WorkspaceLaunchOverlay/WorkspaceLaunchOverlay.tsx apps/web/src/features/workspace/WorkspaceScreen.tsx apps/web/src/styles/app.css apps/web/src/i18n.ts tests/workspace-welcome-screen.test.ts
git commit -m "feat: add dismissible workspace launch overlay"
```

## Task 4: Cover The Welcome Flow In End-To-End Tests

**Files:**
- Modify: `tests/e2e/e2e.spec.ts`
- Test: `tests/e2e/e2e.spec.ts`

- [ ] **Step 1: Add the failing E2E test for welcome-screen startup**

```ts
test('empty startup shows a welcome screen instead of auto-opening the launch overlay', async ({ page }) => {
  await closeAllOpenWorkspaces(page);
  await page.goto('/');

  await expect(page.getByTestId('workspace-welcome-screen')).toBeVisible();
  await expect(page.getByTestId('overlay')).toHaveCount(0);
  await expect(page.getByTestId('runtime-validation-overlay')).toHaveCount(0);
});
```

```ts
test('launch overlay can be opened and closed from the welcome screen', async ({ page }) => {
  await closeAllOpenWorkspaces(page);
  await page.goto('/');

  await page.getByTestId('workspace-welcome-open').click();
  await expect(page.getByTestId('runtime-validation-overlay')).toBeVisible();

  runtimeCommandMockState(page).claude = true;
  await page.getByRole('button', { name: 'Retry Check' }).click();

  await expect(page.getByTestId('launch-overlay-shell')).toBeVisible();
  await page.getByTestId('launch-overlay-close').click();
  await expect(page.getByTestId('workspace-welcome-screen')).toBeVisible();
});
```

```ts
test('closing the last workspace returns to the welcome screen', async ({ page }) => {
  const label = await launchLocalWorkspace(page);
  await expect(page.getByTestId('workspace-topbar')).toContainText(label);
  await page.locator('.workspace-top-tab .session-top-close').first().click();
  await expect(page.getByTestId('workspace-welcome-screen')).toBeVisible();
});
```

- [ ] **Step 2: Run the new E2E slice and confirm failure**

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "empty startup shows a welcome screen instead of auto-opening the launch overlay"
```

Expected:

```text
Expected locator to be visible: [data-testid="workspace-welcome-screen"]
```

- [ ] **Step 3: Update helper expectations to match the new startup behavior**

```ts
const openLaunchOverlay = async (page: Page) => {
  await gotoWorkspaceRoot(page);
  const overlay = page.getByTestId('overlay');
  if (await overlay.isVisible()) {
    await expect(overlay).toBeVisible();
    return;
  }

  const welcome = page.getByTestId('workspace-welcome-screen');
  if (await welcome.isVisible()) {
    await page.getByTestId('workspace-welcome-open').click();
  } else {
    await page.getByRole('button', { name: 'Add workspace' }).click();
  }

  if (await page.getByTestId('runtime-validation-overlay').isVisible()) {
    await page.getByRole('button', { name: 'Retry Check' }).click();
  }

  await expect(overlay).toBeVisible();
};
```

- [ ] **Step 4: Run the focused E2E suite**

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "welcome screen|launch overlay can be opened and closed|closing the last workspace"
```

Expected:

```text
3 passed
```

- [ ] **Step 5: Run the broader verification slice**

Run:

```bash
node --test tests/workspace-welcome-screen.test.ts
pnpm build:web
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "workspace|welcome screen|runtime validation"
```

Expected:

```text
# pass
✓ built in
passed
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/e2e.spec.ts tests/workspace-welcome-screen.test.ts
git commit -m "test: cover welcome screen workspace launch flow"
```

## Self-Review

### Spec coverage

- Empty startup welcome state is covered in Task 1 and Task 2.
- Zero-workspace top-bar treatment is covered in Task 2.
- Dismissible launch overlay is covered in Task 3.
- History and settings entry points from the welcome screen are covered in Task 2 and Task 4.
- Returning to welcome screen after closing the last workspace is covered in Task 4.
- Runtime validation remains user-triggered only, covered in Task 1 and Task 4.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation language remains.
- Each task includes file paths, concrete code, and exact commands.

### Type consistency

- `showWelcomeScreen`, `onCloseWorkspaceOverlay`, and `WorkspaceWelcomeScreen` naming is used consistently across the plan.
- Overlay dismissal stays on the existing `overlay.visible` field and does not introduce a competing state source.
