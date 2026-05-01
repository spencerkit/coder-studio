# Mobile-Friendly Phase 4B3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt mobile toast positioning and compact the global mobile config-drift warning surface without changing desktop behavior or the detailed embedded settings cleanup UI.

**Architecture:** Keep `ToastContainer` and `ConfigDriftBanner` as the single owners of their behavior. Add viewport-aware mobile branches inside those features so desktop remains unchanged while mobile gains a top-centered toast presentation and a summary-only global config-drift strip that routes to `Settings` for details.

**Tech Stack:** React 19, jotai, react-router-dom, lucide-react, vitest + Testing Library, shared `useViewport` hook, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-4b3-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md`

---

## File Structure

**Modified files:**
- `packages/web/src/features/notifications/toast-container.tsx` — add viewport-aware mobile container class while preserving existing item behavior
- `packages/web/src/features/notifications/toast-container.test.tsx` — add mobile container coverage
- `packages/web/src/features/config-drift-banner/index.tsx` — add compact mobile/global summary branch and route-to-settings action
- `packages/web/src/features/config-drift-banner/index.test.tsx` — add compact mobile/global coverage
- `packages/web/src/features/settings/components/settings-page.test.tsx` — prove embedded banner remains detailed on mobile
- `packages/web/src/styles/components.css` — add mobile toast and compact banner styles

**No changes in 4B3:**
- toast atoms or notification payload shape
- shell route definitions
- server-side settings audit / cleanup commands
- desktop shell layout

---

## Task 1: Write Failing Tests for Mobile Toasts and Compact Global Config-Drift Banner

**Files:**
- Modify: `packages/web/src/features/notifications/toast-container.test.tsx`
- Modify: `packages/web/src/features/config-drift-banner/index.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Add a shared viewport mock to `toast-container.test.tsx`**

Insert this hoisted mock near the top of the file:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Reset it in `beforeEach`:

```tsx
beforeEach(() => {
  viewportMocks.viewport = 'desktop';
  navigate.mockReset();
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});
```

- [ ] **Step 2: Add a failing mobile toast-container class test**

Append this test below the existing navigation assertions:

```tsx
it('uses the mobile toast container variant on mobile while preserving the rendered toast', () => {
  viewportMocks.viewport = 'mobile';

  renderWithToast({
    kind: 'success',
    title: 'Session done',
    body: 'Claude · demo · 1m',
  });

  expect(document.querySelector('.toast-container--mobile')).toBeTruthy();
  expect(screen.getByText('Session done')).toBeInTheDocument();
});
```

This should fail because `ToastContainer` does not currently branch by viewport.

- [ ] **Step 3: Add viewport and navigation mocks to `config-drift-banner/index.test.tsx`**

Insert these hoisted mocks:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => routerMocks.navigate,
  };
});
```

Reset them in `beforeEach`:

```tsx
beforeEach(() => {
  vi.clearAllMocks();
  viewportMocks.viewport = 'desktop';
  routerMocks.navigate.mockReset();
});
```

- [ ] **Step 4: Add a failing compact mobile/global banner test**

Append this test:

```tsx
it('renders a compact global summary on mobile and routes to settings for details', async () => {
  viewportMocks.viewport = 'mobile';

  const store = createStore();
  const sendCommand = vi.fn().mockResolvedValue({
    externalConfigAudit: {
      codex: {
        configPath: '/home/spencer/.codex/config.toml',
        exists: true,
        findings: [
          {
            id: 'toml_notify',
            type: 'toml_notify',
            severity: 'warn',
            startLine: 11,
            endLine: 14,
            snippet: 'notify = [\"agent-notify\", \"codex\"]',
            message: 'top-level notify conflicts with injected notify',
          },
        ],
      },
    },
  });

  store.set(connectionStatusAtom, 'connected');
  store.set(
    wsClientAtom,
    {
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    } as never
  );

  render(
    <Provider store={store}>
      <ConfigDriftBanner />
    </Provider>
  );

  await waitFor(() => {
    expect(screen.getByText('Codex 配置冲突（1 项）')).toBeInTheDocument();
  });

  expect(document.querySelector('.config-drift-banner--mobile-compact')).toBeTruthy();
  expect(screen.queryByText('显示详情')).toBeNull();
  expect(screen.queryByText('清理 1 项')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '设置' }));

  expect(routerMocks.navigate).toHaveBeenCalledWith('/settings');
});
```

This should fail because the current component always renders the full inline desktop/global layout.

- [ ] **Step 5: Add a settings-page mobile regression test for the embedded banner**

Append this test to `settings-page.test.tsx`:

```tsx
it('keeps the embedded config drift banner detailed on mobile settings', async () => {
  viewportMocks.viewport = 'mobile';

  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === 'settings.get') {
      return {
        externalConfigAudit: {
          codex: {
            configPath: '/home/spencer/.codex/config.toml',
            exists: true,
            findings: [
              {
                id: 'toml_notify',
                type: 'toml_notify',
                severity: 'warn',
                startLine: 11,
                endLine: 14,
                snippet: 'notify = [\"agent-notify\", \"codex\"]',
                message: 'top-level notify conflicts with injected notify',
              },
            ],
          },
        },
      };
    }
    return {};
  });
  const store = createConnectedStore(sendCommand);

  renderSettingsPage(store);

  fireEvent.click(screen.getByRole('button', { name: 'General' }));

  await waitFor(() => {
    expect(screen.getByText('Codex 配置冲突（1 项）')).toBeInTheDocument();
  });

  expect(screen.getByText('显示详情')).toBeInTheDocument();
});
```

This protects the boundary that only the global mobile variant compacts.

- [ ] **Step 6: Run focused tests to verify red**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- the new mobile toast test fails because there is no mobile container class yet
- the new config-drift test fails because the global mobile compact branch does not exist yet

- [ ] **Step 7: Commit the failing tests**

```bash
git add \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "test: cover mobile notification surfaces"
```

---

## Task 2: Implement Mobile Toast and Compact Global Config-Drift Behavior

**Files:**
- Modify: `packages/web/src/features/notifications/toast-container.tsx`
- Modify: `packages/web/src/features/config-drift-banner/index.tsx`

- [ ] **Step 1: Add viewport-aware toast container branching**

Update `toast-container.tsx` imports to add:

```tsx
import { useViewport } from '../../hooks/use-viewport';
```

Inside `ToastContainer`, compute:

```tsx
const isMobile = useViewport() === 'mobile';
```

Replace the current container class with:

```tsx
const containerClassName = [
  'toast-container',
  isMobile ? 'toast-container--mobile' : '',
]
  .filter(Boolean)
  .join(' ');
```

Use that class in the return block.

- [ ] **Step 2: Add compact mobile/global detection in `ConfigDriftBanner`**

Update imports to add:

```tsx
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../hooks/use-viewport';
```

Inside the component, add:

```tsx
const navigate = useNavigate();
const isMobile = useViewport() === 'mobile';
const isCompactMobileGlobal = isMobile && variant === 'global';
```

Extend the root class builder with:

```tsx
isCompactMobileGlobal ? 'config-drift-banner--mobile-compact' : '',
```

- [ ] **Step 3: Render a compact mobile/global load-error branch**

Before the existing desktop/full error branch, add:

```tsx
if (loadError && showLoadError && isCompactMobileGlobal) {
  return (
    <div className={rootClassName} role="alert">
      <div className="config-drift-banner__row config-drift-banner__row--compact">
        <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
        <span className="config-drift-banner__title">{t('codex_audit.load_failed_title')}</span>
        <div className="config-drift-banner__spacer" />
        <button
          type="button"
          className="config-drift-banner__summary-action"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          {t('action.refresh')}
        </button>
        <button
          type="button"
          className="config-drift-banner__dismiss"
          onClick={() => setDismissed(true)}
          aria-label={t('action.close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render a compact mobile/global findings branch**

Before the existing full findings return, add:

```tsx
if (isCompactMobileGlobal) {
  return (
    <div className={rootClassName} role="alert">
      <div className="config-drift-banner__row config-drift-banner__row--compact">
        <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
        <span className="config-drift-banner__title">
          {t('codex_audit.title', {
            count: String(audit!.findings.length),
          })}
        </span>
        <div className="config-drift-banner__spacer" />
        <button
          type="button"
          className="config-drift-banner__summary-action"
          onClick={() => navigate('/settings')}
        >
          {t('settings.title')}
        </button>
        <button
          type="button"
          className="config-drift-banner__dismiss"
          onClick={() => setDismissed(true)}
          aria-label={t('action.close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
```

This preserves `dismissed`, `loadError`, and existing desktop/full logic while routing the compact mobile summary into the settings detail surface.

- [ ] **Step 5: Run focused tests to verify green**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- all three focused suites pass

- [ ] **Step 6: Commit the behavior implementation**

```bash
git add \
  packages/web/src/features/notifications/toast-container.tsx \
  packages/web/src/features/config-drift-banner/index.tsx
git commit -m "feat: adapt mobile notification surfaces"
```

---

## Task 3: Add Mobile Styles for Toasts and Compact Global Warning Strip

**Files:**
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add mobile toast container and compact-summary styles**

Append styles near the existing config-drift / toast blocks for:

- `.config-drift-banner--mobile-compact`
- `.config-drift-banner__row--compact`
- `.config-drift-banner__summary-action`
- `.toast-container--mobile`

The style intent is:

```css
.config-drift-banner__summary-action {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-target-min);
  padding: 0 var(--sp-3);
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--accent-amber) 18%, transparent);
  color: var(--text-primary);
}
```

and the mobile toast container should switch from desktop bottom-right anchoring to a centered top overlay band under the mobile top chrome.

- [ ] **Step 2: Add mobile breakpoint refinements**

Inside the existing mobile breakpoint section, append rules that:

- tighten compact-banner padding
- keep compact-banner actions touch-friendly
- center the mobile toast rail
- keep toast width constrained and readable
- optionally switch mobile toast motion to a softer top-down entrance if needed

This pass should not alter desktop toast or desktop banner presentation.

- [ ] **Step 3: Run the focused suites again**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- all focused suites still pass after the style-only changes

- [ ] **Step 4: Commit the styling pass**

```bash
git add packages/web/src/styles/components.css
git commit -m "style: refine mobile notification layout"
```

---

## Task 4: Final Verification and Boundary Check

**Files:**
- Verify only touched files from Tasks 1-3

- [ ] **Step 1: Run focused notification/config-drift tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- focused suites pass

- [ ] **Step 2: Run the full web test suite**

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected:

- full `@coder-studio/web` test suite passes

- [ ] **Step 3: Lint touched files**

Run:

```bash
pnpm exec biome lint \
  packages/web/src/features/notifications/toast-container.tsx \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/styles/components.css
```

Expected:

- no lint errors

- [ ] **Step 4: Check diff boundaries**

Run:

```bash
git diff --check
git diff -- \
  packages/web/src/features/notifications/toast-container.tsx \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/config-drift-banner/index.tsx \
  packages/web/src/features/config-drift-banner/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/styles/components.css
```

Expected:

- no whitespace or merge-marker errors
- diff remains limited to toast/config-drift mobile adaptation support
