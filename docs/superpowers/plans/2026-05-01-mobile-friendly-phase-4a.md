# Mobile-Friendly Phase 4A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the mobile page-level secondary surfaces so `Welcome`, `Auth`, and `Settings` behave like full-screen mobile routes, while `Settings` gains a component-local `category -> detail` navigation model and desktop behavior stays intact.

**Architecture:** Reuse the existing route structure and page components. Introduce a shared viewport hook for page-level mobile branching, add a small helper for `Settings` exit decisions, and keep the mobile `Settings` navigation stack entirely inside `SettingsPage` rather than adding new routes. Keep `Welcome` and `Auth` behavior intact and limit their changes to mobile page variants and CSS.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + Testing Library, lucide-react, existing mobile viewport detection, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-4a-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` §8, §10 Phase 4.

---

## File Structure

**New files:**
- `packages/web/src/hooks/use-viewport.ts` — shared viewport detection hook reused by `app.tsx` and page-level mobile variants
- `packages/web/src/features/settings/components/settings-navigation.ts` — helper that resolves mobile `Settings` exit behavior (`history` vs `/workspace` vs `/`)
- `packages/web/src/features/settings/components/settings-navigation.test.ts` — focused unit tests for exit target resolution
- `packages/web/src/features/settings/components/settings-sections.tsx` — shared `Settings` section metadata for desktop sidebar and mobile root list

**Modified files:**
- `packages/web/src/app.tsx` — import the shared viewport hook instead of the mobile-shell-local copy
- `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts` — re-export the shared hook so existing mobile-shell tests keep working
- `packages/web/src/features/settings/components/settings-page.tsx` — add mobile nav stack, root/detail header behavior, and history-first exit logic
- `packages/web/src/features/settings/components/settings-page.test.tsx` — add mobile nav stack tests and update exit-navigation expectations
- `packages/web/src/features/welcome/index.tsx` — add a mobile page variant class using the shared viewport hook
- `packages/web/src/features/welcome/index.test.tsx` — verify mobile welcome classes are applied without breaking CTA behavior
- `packages/web/src/features/auth/index.tsx` — add a mobile page variant class using the shared viewport hook
- `packages/web/src/features/auth/index.test.tsx` — verify mobile auth classes are applied without breaking auth flows
- `packages/web/src/styles/components.css` — mobile-only layout rules for `Welcome`, `Auth`, and `Settings`

**No changes in Phase 4A:**
- `packages/web/src/features/command-palette/*`
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/components/worktree-modal.tsx`
- `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- mobile dock/sheet behavior from Phases 0-3
- toast positioning and non-settings config-drift banner compaction

---

## Task 1: Write Failing Tests for Mobile Settings Navigation

**Files:**
- Create: `packages/web/src/features/settings/components/settings-navigation.test.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Mock the shared viewport hook in `settings-page.test.tsx`**

Add a hoisted viewport mock above the existing `react-router-dom` mock so the test file can force desktop or mobile rendering:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Reset it in `beforeEach`:

```tsx
beforeEach(() => {
  vi.clearAllMocks();
  routerMocks.navigate.mockReset();
  viewportMocks.viewport = 'desktop';
  window.history.replaceState({}, '', '/settings');
});
```

- [ ] **Step 2: Add failing mobile `SettingsPage` tests**

Append these tests to `settings-page.test.tsx`:

```tsx
it('renders a mobile category list and returns from detail content to the settings root', async () => {
  viewportMocks.viewport = 'mobile';
  const store = createStore();
  const sendCommand = vi.fn().mockImplementation(async (op: string, args: unknown) => {
    if (op === 'settings.get') {
      return {
        'providers.claude.additionalArgs': ['--verbose'],
      };
    }
    if (op === 'settings.previewCommand') {
      const previewArgs = args as { config: { additionalArgs?: string[] } };
      return {
        preview: ['preview', ...(previewArgs.config.additionalArgs ?? [])].join(' '),
      };
    }
    return {};
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
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </Provider>
  );

  expect(screen.getByRole('button', { name: 'Providers' })).toBeInTheDocument();
  expect(document.querySelector('.settings-sidebar')).toBeNull();
  expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Providers' }));

  await waitFor(() => {
    expect(screen.getByLabelText('启动命令参数')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: '返回' }));

  expect(screen.getByRole('button', { name: 'Providers' })).toBeInTheDocument();
  expect(screen.queryByLabelText('启动命令参数')).not.toBeInTheDocument();
});

it('prefers browser history when leaving the mobile settings root', async () => {
  viewportMocks.viewport = 'mobile';
  window.history.pushState({ idx: 1 }, '', '/settings');

  const store = createStore();
  const sendCommand = vi.fn().mockResolvedValue({});

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
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: '返回' }));

  expect(routerMocks.navigate).toHaveBeenCalledWith(-1);
});
```

These should fail because the current page always renders the desktop split layout and always calls `navigate('/workspace')`.

- [ ] **Step 3: Create a failing unit test for settings exit resolution**

Create `settings-navigation.test.ts` with:

```tsx
import { describe, expect, it } from 'vitest';
import { resolveSettingsExitTarget } from './settings-navigation';

describe('resolveSettingsExitTarget', () => {
  it('returns history when the router history index is greater than zero', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 2,
        historyLength: 3,
        hasActiveWorkspace: true,
      })
    ).toBe('history');
  });

  it('falls back to /workspace when no prior history exists but a workspace is active', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 0,
        historyLength: 1,
        hasActiveWorkspace: true,
      })
    ).toBe('/workspace');
  });

  it('falls back to / when no prior history exists and no workspace is active', () => {
    expect(
      resolveSettingsExitTarget({
        historyIndex: 0,
        historyLength: 1,
        hasActiveWorkspace: false,
      })
    ).toBe('/');
  });
});
```

This will fail immediately because `settings-navigation.ts` does not exist yet.

- [ ] **Step 4: Run the focused settings tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- `settings-navigation.test.ts` fails with module-not-found
- new `SettingsPage` mobile tests fail because the desktop layout still renders

- [ ] **Step 5: Commit the failing test scaffold**

```bash
git add \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "test: add mobile settings navigation coverage"
```

Expected: commit succeeds with only test changes.

---

## Task 2: Implement Shared Viewport Reuse and Mobile Settings Navigation

**Files:**
- Create: `packages/web/src/hooks/use-viewport.ts`
- Create: `packages/web/src/features/settings/components/settings-navigation.ts`
- Create: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`

- [ ] **Step 1: Create the shared viewport hook and update imports**

Create `packages/web/src/hooks/use-viewport.ts` with the existing logic:

```tsx
import { useEffect, useState } from 'react';

export type Viewport = 'mobile' | 'desktop';

const WIDTH_QUERY = '(max-width: 899px)';
const POINTER_QUERY = '(pointer: coarse)';

function computeViewport(): Viewport {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }

  const narrow = window.matchMedia(WIDTH_QUERY).matches;
  const coarse = window.matchMedia(POINTER_QUERY).matches;

  return narrow || coarse ? 'mobile' : 'desktop';
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(computeViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const widthList = window.matchMedia(WIDTH_QUERY);
    const pointerList = window.matchMedia(POINTER_QUERY);
    const handleChange = () => {
      setViewport(computeViewport());
    };

    widthList.addEventListener('change', handleChange);
    pointerList.addEventListener('change', handleChange);
    handleChange();

    return () => {
      widthList.removeEventListener('change', handleChange);
      pointerList.removeEventListener('change', handleChange);
    };
  }, []);

  return viewport;
}
```

Replace `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts` with a re-export:

```tsx
export { useViewport, type Viewport } from '../../../hooks/use-viewport';
```

Update `packages/web/src/app.tsx`:

```tsx
import { useViewport } from './hooks/use-viewport';
```

- [ ] **Step 2: Create focused helpers for settings sections and exit routing**

Create `packages/web/src/features/settings/components/settings-sections.tsx`:

```tsx
import { Globe, Keyboard, Palette, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SettingsSection = 'general' | 'appearance' | 'providers' | 'shortcuts';

export interface SettingsSectionMeta {
  id: SettingsSection;
  labelKey: string;
  Icon: LucideIcon;
}

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: 'general', labelKey: 'settings.general', Icon: Settings },
  { id: 'providers', labelKey: 'settings.providers', Icon: Globe },
  { id: 'appearance', labelKey: 'settings.appearance', Icon: Palette },
  { id: 'shortcuts', labelKey: 'settings.shortcuts.title', Icon: Keyboard },
];
```

Create `packages/web/src/features/settings/components/settings-navigation.ts`:

```tsx
export interface ResolveSettingsExitTargetOptions {
  historyIndex?: number | null;
  historyLength: number;
  hasActiveWorkspace: boolean;
}

export function resolveSettingsExitTarget({
  historyIndex,
  historyLength,
  hasActiveWorkspace,
}: ResolveSettingsExitTargetOptions): 'history' | '/workspace' | '/' {
  const canUseHistory =
    typeof historyIndex === 'number' ? historyIndex > 0 : historyLength > 1;

  if (canUseHistory) {
    return 'history';
  }

  return hasActiveWorkspace ? '/workspace' : '/';
}
```

- [ ] **Step 3: Add the mobile root/detail branch to `SettingsPage`**

Update `settings-page.tsx` to consume the shared viewport hook, the section metadata, and the exit helper. The critical additions are:

```tsx
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../../hooks/use-viewport';
import { resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';
import { resolveSettingsExitTarget } from './settings-navigation';
```

Replace the local `type SettingsSection = ...` with the imported type, then add the mobile route state:

```tsx
type MobileSettingsRoute = 'root' | SettingsSection;

const viewport = useViewport();
const isMobile = viewport === 'mobile';
const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
const [activeSection, setActiveSection] = useState<SettingsSection>('general');
const [mobileRoute, setMobileRoute] = useState<MobileSettingsRoute>('root');

const activeSectionMeta =
  SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];

const handlePageExit = () => {
  const historyState = window.history.state as { idx?: number } | null;
  const target = resolveSettingsExitTarget({
    historyIndex: historyState?.idx ?? null,
    historyLength: window.history.length,
    hasActiveWorkspace: Boolean(activeWorkspaceId),
  });

  if (target === 'history') {
    navigate(-1);
    return;
  }

  navigate(target);
};

const handleBack = () => {
  if (isMobile && mobileRoute !== 'root') {
    setMobileRoute('root');
    return;
  }

  handlePageExit();
};
```

Replace the hard-coded desktop sidebar with a shared metadata-driven map:

```tsx
<aside className="settings-sidebar">
  <nav className="settings-nav">
    {SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
      <SettingsNavItem
        key={id}
        icon={<Icon size={16} />}
        label={t(labelKey)}
        active={activeSection === id}
        onClick={() => setActiveSection(id)}
      />
    ))}
  </nav>
</aside>
```

Add a mobile root renderer before the existing content:

```tsx
const renderMobileRoot = () => (
  <main className="settings-content settings-content--mobile-root">
    <div className="settings-mobile-list">
      {SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
        <button
          key={id}
          type="button"
          className="settings-mobile-item"
          onClick={() => {
            setActiveSection(id);
            setMobileRoute(id);
          }}
        >
          <span className="settings-mobile-item__icon">
            <Icon size={18} />
          </span>
          <span className="settings-mobile-item__label">{t(labelKey)}</span>
          <ChevronRight size={16} className="settings-mobile-item__arrow" />
        </button>
      ))}
    </div>
  </main>
);
```

Then branch the page body:

```tsx
const shouldShowMobileRoot = isMobile && mobileRoute === 'root';

return (
  <div className={`settings-page ${isMobile ? 'settings-page--mobile' : ''}`}>
    <header className="settings-header">
      <button className="settings-back-btn" onClick={handleBack}>
        <ArrowLeft size={16} />
        <span>{t('action.back')}</span>
      </button>
      {isMobile ? (
        <div className="settings-header__title">
          {t(shouldShowMobileRoot ? 'settings.title' : activeSectionMeta.labelKey)}
        </div>
      ) : null}
    </header>

    {shouldShowMobileRoot ? (
      renderMobileRoot()
    ) : (
      <div className={`settings-body ${isMobile ? 'settings-body--mobile' : ''}`}>
        {isMobile ? null : (
          <aside className="settings-sidebar">
            <nav className="settings-nav">
              {SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
                <SettingsNavItem
                  key={id}
                  icon={<Icon size={16} />}
                  label={t(labelKey)}
                  active={activeSection === id}
                  onClick={() => setActiveSection(id)}
                />
              ))}
            </nav>
          </aside>
        )}

        <main className={`settings-content ${isMobile ? 'settings-content--mobile' : ''}`}>
          {settingsLoadError && (
            <div className="settings-page__notice settings-page__notice--error" role="alert">
              ...
            </div>
          )}
          <ConfigDriftBanner variant="embedded" showLoadError={!settingsLoadError} />
          {renderContent()}
        </main>
      </div>
    )}

    <footer className={`settings-footer ${isMobile ? 'settings-footer--mobile' : ''}`}>
      <span className="settings-autosave">{t('settings.autosave_hint')}</span>
      <span className="settings-version">v0.2.6</span>
    </footer>
  </div>
);
```

This produces the behavior the tests expect:

- mobile root starts as a category list
- tapping a category enters detail content
- back from detail returns to root
- back from root exits via history-first logic

- [ ] **Step 4: Run the focused settings tests and confirm GREEN**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected:

- all `settings-navigation` helper tests pass
- the new mobile `SettingsPage` tests pass
- existing settings tests continue to pass under desktop mode

- [ ] **Step 5: Commit the settings mobile navigation implementation**

```bash
git add \
  packages/web/src/hooks/use-viewport.ts \
  packages/web/src/app.tsx \
  packages/web/src/shells/mobile-shell/hooks/use-viewport.ts \
  packages/web/src/features/settings/components/settings-navigation.ts \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-sections.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "feat: add mobile settings navigation stack"
```

Expected: commit succeeds with the shared viewport reuse and settings-only behavior changes.

---

## Task 3: Write Failing Tests for Welcome and Auth Mobile Variants

**Files:**
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/features/auth/index.test.tsx`

- [ ] **Step 1: Mock the shared viewport hook in the welcome and auth tests**

At the top of `welcome/index.test.tsx`, add:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Reset it in each test file’s `beforeEach`:

```tsx
beforeEach(() => {
  viewportMocks.viewport = 'desktop';
});
```

Use the same pattern in `auth/index.test.tsx`.

- [ ] **Step 2: Add failing mobile-variant assertions**

Append this to `welcome/index.test.tsx`:

```tsx
it('adds the mobile welcome page variant classes on mobile viewports', () => {
  viewportMocks.viewport = 'mobile';
  const store = createStore();

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    </Provider>
  );

  expect(document.querySelector('.welcome-container--mobile')).toBeTruthy();
  expect(document.querySelector('.welcome-card--mobile')).toBeTruthy();
});
```

Append this to `auth/index.test.tsx`:

```tsx
it('adds the mobile auth page variant classes on mobile viewports', async () => {
  viewportMocks.viewport = 'mobile';
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ authEnabled: true }),
  }) as unknown as typeof fetch;

  render(
    <Provider>
      <LoginPage />
    </Provider>
  );

  await screen.findByPlaceholderText('密码');

  expect(document.querySelector('.welcome-container--mobile')).toBeTruthy();
  expect(document.querySelector('.auth-screen--mobile')).toBeTruthy();
  expect(document.querySelector('.auth-card-shell--mobile')).toBeTruthy();
});
```

These should fail because the current page components do not add any mobile modifier classes.

- [ ] **Step 3: Run the focused welcome/auth tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/auth/index.test.tsx
```

Expected: the new mobile modifier tests fail while the existing behavior tests continue to run.

- [ ] **Step 4: Commit the failing welcome/auth tests**

```bash
git add \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/auth/index.test.tsx
git commit -m "test: cover mobile welcome and auth variants"
```

Expected: commit succeeds with only test changes.

---

## Task 4: Implement Welcome/Auth Mobile Variants and Page-Level CSS

**Files:**
- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/features/auth/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add mobile modifier classes to `WelcomePage` and `LoginPage`**

Update `packages/web/src/features/welcome/index.tsx`:

```tsx
import { useViewport } from '../../hooks/use-viewport';

export const WelcomePage: FC = () => {
  const navigate = useNavigate();
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const isMobile = useViewport() === 'mobile';

  return (
    <>
      <div className={`welcome-container ${isMobile ? 'welcome-container--mobile' : ''}`}>
        <div className={`welcome-card ${isMobile ? 'welcome-card--mobile' : ''}`}>
          ...
        </div>
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </>
  );
};
```

Update `packages/web/src/features/auth/index.tsx`:

```tsx
import { useViewport } from '../../hooks/use-viewport';

export function LoginPage() {
  const t = useTranslation();
  const [, setAuthenticated] = useAtom(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const isMobile = useViewport() === 'mobile';
  ...

  return (
    <div
      className={[
        'welcome-container',
        'auth-screen',
        isMobile ? 'welcome-container--mobile auth-screen--mobile' : '',
      ].filter(Boolean).join(' ')}
    >
      <div
        className={[
          'welcome-card',
          'auth-card-shell',
          isMobile ? 'welcome-card--mobile auth-card-shell--mobile' : '',
        ].filter(Boolean).join(' ')}
      >
        ...
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add mobile page styles for `Settings`, `Welcome`, and `Auth`**

Append a dedicated mobile block to `packages/web/src/styles/components.css`:

```css
@media (max-width: 899px), (pointer: coarse) {
  .welcome-container--mobile {
    align-items: stretch;
    justify-content: flex-start;
    min-height: 100dvh;
    padding:
      calc(env(safe-area-inset-top, 0px) + var(--sp-6))
      var(--sp-4)
      calc(env(safe-area-inset-bottom, 0px) + var(--sp-6));
  }

  .welcome-card--mobile {
    width: 100%;
    max-width: none;
    padding: var(--sp-8) var(--sp-5);
    gap: var(--sp-4);
  }

  .welcome-card--mobile .welcome-title {
    font-size: var(--text-2xl);
  }

  .welcome-card--mobile .welcome-body {
    max-width: none;
    font-size: var(--text-base);
  }

  .welcome-card--mobile .welcome-features {
    grid-template-columns: 1fr;
  }

  .auth-screen--mobile {
    padding:
      calc(env(safe-area-inset-top, 0px) + var(--sp-6))
      var(--sp-4)
      calc(env(safe-area-inset-bottom, 0px) + var(--sp-6));
  }

  .auth-card-shell--mobile {
    width: 100%;
    padding: var(--sp-8) var(--sp-5);
  }

  .settings-page--mobile {
    min-height: 100dvh;
  }

  .settings-body--mobile {
    display: block;
  }

  .settings-content--mobile,
  .settings-content--mobile-root {
    padding:
      var(--sp-4)
      var(--sp-4)
      calc(env(safe-area-inset-bottom, 0px) + var(--sp-6));
  }

  .settings-mobile-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .settings-mobile-item {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 52px;
    padding: var(--sp-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    text-align: left;
  }

  .settings-mobile-item__icon {
    display: inline-flex;
    color: var(--text-secondary);
  }

  .settings-mobile-item__label {
    flex: 1;
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  .settings-mobile-item__arrow {
    color: var(--text-tertiary);
  }

  .settings-header__title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .settings-footer--mobile {
    padding:
      var(--sp-3)
      var(--sp-4)
      calc(env(safe-area-inset-bottom, 0px) + var(--sp-4));
  }
}
```

This CSS does three jobs:

- converts `Welcome` and `Auth` into mobile-friendly full-screen pages
- turns `Settings` into a mobile-first root/detail page shell
- keeps all changes under the existing mobile breakpoint so desktop remains stable

- [ ] **Step 3: Run focused tests, lint the touched files, then run the full web suite**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/auth/index.test.tsx \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-page.test.tsx
```

Expected: all focused tests pass.

Run:

```bash
pnpm exec biome lint \
  packages/web/src/hooks/use-viewport.ts \
  packages/web/src/app.tsx \
  packages/web/src/shells/mobile-shell/hooks/use-viewport.ts \
  packages/web/src/features/settings/components/settings-navigation.ts \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-sections.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/auth/index.tsx \
  packages/web/src/features/auth/index.test.tsx \
  packages/web/src/styles/components.css
```

Expected: no lint errors.

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected: full web test suite passes with no desktop regressions.

- [ ] **Step 4: Commit the completed Phase 4A implementation**

```bash
git add \
  packages/web/src/hooks/use-viewport.ts \
  packages/web/src/app.tsx \
  packages/web/src/shells/mobile-shell/hooks/use-viewport.ts \
  packages/web/src/features/settings/components/settings-navigation.ts \
  packages/web/src/features/settings/components/settings-navigation.test.ts \
  packages/web/src/features/settings/components/settings-sections.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/welcome/index.tsx \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/auth/index.tsx \
  packages/web/src/features/auth/index.test.tsx \
  packages/web/src/styles/components.css
git commit -m "feat: adapt mobile page-level secondary surfaces"
```

Expected: commit succeeds with the full Phase 4A implementation.

---

## Self-Review Checklist

- `Settings` mobile root/detail flow is covered by explicit tests
- `Settings` exit logic is separated into a small helper with direct unit tests
- `Welcome` and `Auth` only change via page variant classes and CSS, not business logic
- No Task touches `CommandPalette`, workspace-launch modal, worktree modal, or objective dialog
- Desktop route structure remains unchanged

