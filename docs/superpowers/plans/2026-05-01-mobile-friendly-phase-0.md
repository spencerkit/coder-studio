# Mobile-Friendly Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay down the shell-splitting scaffolding (desktop-shell extracted, mobile-shell stub, useViewport hook, touch tokens added) without changing any user-visible behavior at desktop sizes.

**Architecture:** Extract current `<AppShell>` from `app.tsx` into a new `shells/desktop-shell.tsx` (zero logic change). Add `useViewport()` hook and a stub `<MobileShell>` that just delegates to `<DesktopShell>` for now. Wire `app.tsx` to pick a shell via `useViewport`. Add new touch-related CSS tokens with a `@media (max-width: 899px), (pointer: coarse)` override block. **Components.css consumer migration is deferred** — it's a much larger refactor that should happen incrementally as Phase 1+ touches components.

**Tech Stack:** React 19, jotai, react-router-dom, vitest + @testing-library/react, vanilla CSS with custom-property tokens.

**Spec reference:** `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` §10 Phase 0.

**Out of scope for this plan (deferred):**
- Bulk `components.css` hardcoded-size → token migration (deferred to Phase 1+ on a per-component basis when shell consumes them)
- All other Phase 1–6 work

---

## File Structure

**New files:**
- `packages/web/src/shells/desktop-shell.tsx` — extracted `AppShell` + `useWorkspaceBootstrap` (verbatim from current `app.tsx`)
- `packages/web/src/shells/desktop-shell.test.tsx` — moved from current `app.test.tsx` (covers same shell behavior)
- `packages/web/src/shells/mobile-shell/index.tsx` — stub that just renders `<DesktopShell />` for now
- `packages/web/src/shells/mobile-shell/index.test.tsx` — verifies stub renders desktop content
- `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts` — `matchMedia`-driven `'mobile' | 'desktop'` hook
- `packages/web/src/shells/mobile-shell/hooks/use-viewport.test.ts` — covers both breakpoint and `pointer: coarse` paths
- `packages/web/src/styles/tokens-touch.test.ts` — parses tokens.css and asserts new touch tokens exist (mirrors existing `components.theme.test.ts` pattern)

**Modified files:**
- `packages/web/src/app.tsx` — strip out `AppShell` body, becomes ~10-line root that picks shell via `useViewport`
- `packages/web/src/app.test.tsx` — slim down to just the BrowserRouter / shell-selection seam (remove tests that moved to desktop-shell.test.tsx)
- `packages/web/src/styles/tokens.css` — add `--touch-target-*`, `--touch-spacing-*`, `--touch-hit-slop` tokens with `@media (max-width: 899px), (pointer: coarse)` override block

**No changes to:**
- All `features/*` (agent-panes, code-editor, terminal-panel, supervisor, settings, command-palette, workspace, welcome, auth, config-drift-banner, notifications)
- All `atoms/*`
- `components.css` consumers (deferred)
- `base.css`
- Backend / server / core packages

---

## Task 1: Capture Baseline Test State

**Files:** none (verification-only)

- [ ] **Step 1: Run web unit tests to confirm clean baseline**

Run from repo root:
```bash
pnpm --filter @coder-studio/web test
```

Expected: All tests pass. Note the count (e.g. "X passed"). If any test is already failing, **stop** and surface the failure to the user — Phase 0 must start from a green baseline.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: clean. If not, surface to user before proceeding.

- [ ] **Step 3: Record git commit hash for rollback reference**

```bash
git rev-parse HEAD
```

Note the hash in your scratchpad. No commit in this task.

---

## Task 2: Extract `<DesktopShell>` from `app.tsx`

**Files:**
- Create: `packages/web/src/shells/desktop-shell.tsx`
- Create: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/app.tsx` (replace `AppShell` definition with import + use)
- Modify: `packages/web/src/app.test.tsx` (remove tests that moved; keep router-seam test only)

**Goal:** Pure refactor. After this task, app behavior is identical — same routes, same atoms, same DOM.

- [ ] **Step 1: Create `shells/desktop-shell.tsx` by copying current `AppShell` + `useWorkspaceBootstrap` verbatim**

Create `packages/web/src/shells/desktop-shell.tsx`:

```tsx
/**
 * Desktop Shell
 *
 * The original AppShell extracted out of app.tsx (zero behavior change).
 * Mobile shell is a sibling under shells/mobile-shell/.
 */

import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { connectionStatusAtom, authEnabledAtom, dispatchCommandAtom } from '../atoms';
import { authenticatedAtom } from '../atoms/ui';
import {
  orderedWorkspacesAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../atoms/workspaces';
import { WelcomePage } from '../features/welcome';
import { SettingsPage } from '../features/settings';
import { WorkspacePage } from '../features/workspace';
import { CommandPalette } from '../features/command-palette';
import { BranchQuickPick } from '../features/workspace/components/branch-quick-pick';
import { LoginPage } from '../features/auth';
import { ConfigDriftBanner } from '../features/config-drift-banner';
import { ToastContainer } from '../features/notifications';
import { Routes, Route } from 'react-router-dom';
import type { Workspace } from '@coder-studio/core';

function useWorkspaceBootstrap() {
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    const authRequired = authEnabled === true;
    if (authRequired && !authenticated) {
      if (location.pathname !== '/auth') {
        navigate('/auth', { replace: true });
      }
      return;
    }

    if (location.pathname === '/auth') {
      navigate('/', { replace: true });
      return;
    }

    if (location.pathname !== '/' && location.pathname !== '/workspace') {
      return;
    }

    if (connectionStatus !== 'connected') {
      return;
    }

    if (workspacesLoadState === 'idle') {
      const requestId = bootstrapRequestIdRef.current + 1;
      bootstrapRequestIdRef.current = requestId;

      setWorkspacesLoadState('loading');
      setWorkspacesLoadError(null);

      dispatch<Workspace[]>('workspace.list', {})
        .then((result) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }

          if (!result.ok) {
            setWorkspacesLoadState('error');
            setWorkspacesLoadError(result.error?.message ?? 'Failed to fetch workspace list');
            return;
          }

          const nextWorkspaces = Array.isArray(result.data) ? result.data : [];
          const wsMap: Record<string, Workspace> = {};
          for (const workspace of nextWorkspaces) {
            wsMap[workspace.id] = workspace;
          }

          setWorkspaces(wsMap);
          setWorkspaceOrder(nextWorkspaces.map((workspace) => workspace.id));
          setWorkspacesLoadState('ready');
          setWorkspacesLoadError(null);
        })
        .catch((error) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspacesLoadState('error');
          setWorkspacesLoadError(error instanceof Error ? error.message : 'Failed to fetch workspace list');
        });
      return;
    }

    if (workspacesLoadState !== 'ready') {
      return;
    }

    if (location.pathname === '/' && workspaces.length > 0) {
      navigate('/workspace', { replace: true });
      return;
    }

    if (location.pathname === '/workspace' && workspaces.length === 0) {
      navigate('/', { replace: true });
    }
  }, [
    authEnabled,
    authenticated,
    connectionStatus,
    dispatch,
    location.pathname,
    navigate,
    setWorkspaceOrder,
    setWorkspaces,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    workspaces.length,
    workspacesLoadState,
  ]);
}

export function DesktopShell() {
  useWorkspaceBootstrap();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authRequired = authEnabled === true;
  const authUnknown = authEnabled === null;
  const shouldShowLogin = authRequired && !authenticated && location.pathname === '/auth';
  const shouldShowGlobalConfigDriftBanner =
    !shouldShowLogin && !authUnknown && !location.pathname.startsWith('/settings');

  return (
    <div className="app">
      {connectionStatus === 'reconnecting' && (
        <div className="connection-banner">
          <span>正在重新连接...</span>
        </div>
      )}
      {connectionStatus === 'rejected' && (
        <div className="connection-banner connection-banner--error">
          <span>另一个标签页已激活</span>
        </div>
      )}

      {shouldShowGlobalConfigDriftBanner && <ConfigDriftBanner />}

      <main className="main-content">
        {authUnknown ? (
          <div className="app-loading-shell">
            <div className="app-loading-card">
              <div className="app-loading-kicker">CODER STUDIO</div>
              <h1 className="app-loading-title">正在连接工作区...</h1>
              <p className="app-loading-desc">正在同步认证与连接状态，随后会自动进入当前 workspace。</p>
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/auth" element={<LoginPage />} />
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        )}
      </main>

      <CommandPalette />
      <BranchQuickPick />
      <ToastContainer />
    </div>
  );
}
```

- [ ] **Step 2: Move existing app shell tests into `shells/desktop-shell.test.tsx`**

Create `packages/web/src/shells/desktop-shell.test.tsx` — copy current `app.test.tsx` body but:

1. Change imports: `import App from './app'` → `import { DesktopShell } from './desktop-shell'`
2. Change all `vi.mock('./features/...')` paths to `vi.mock('../features/...')`
3. Wrap `<DesktopShell />` in `<BrowserRouter>` since it no longer brings its own router

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Provider, createStore } from 'jotai';
import { DesktopShell } from './desktop-shell';
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from '../atoms/connection';
import { authenticatedAtom } from '../atoms/ui';
import { workspaceOrderAtom, workspacesAtom, workspacesLoadStateAtom } from '../atoms/workspaces';

vi.mock('../features/welcome', () => ({ WelcomePage: () => <div>WelcomePage</div> }));
vi.mock('../features/settings', () => ({ SettingsPage: () => <div>SettingsPage</div> }));
vi.mock('../features/workspace', () => ({ WorkspacePage: () => <div>WorkspacePage</div> }));
vi.mock('../features/command-palette', () => ({ CommandPalette: () => null }));
vi.mock('../features/workspace/components/branch-quick-pick', () => ({ BranchQuickPick: () => null }));
vi.mock('../features/auth', () => ({ LoginPage: () => <div>LoginPage</div> }));
vi.mock('../features/config-drift-banner', () => ({ ConfigDriftBanner: () => null }));
vi.mock('../features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
  ToastContainer: () => null,
}));

const originalFetch = globalThis.fetch;

function renderShell(store: ReturnType<typeof createStore>) {
  return render(
    <Provider store={store}>
      <BrowserRouter>
        <DesktopShell />
      </BrowserRouter>
    </Provider>
  );
}

describe('DesktopShell auth gating', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows a loading shell while auth status is still unknown', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    renderShell(store);

    expect(screen.getByText('正在连接工作区...')).toBeInTheDocument();
    expect(screen.queryByText('LoginPage')).not.toBeInTheDocument();
  });

  it('shows login only when auth is enabled and user is unauthenticated', () => {
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    expect(screen.getByText('LoginPage')).toBeInTheDocument();
    expect(screen.queryByText('WelcomePage')).not.toBeInTheDocument();
  });

  it('renders WorkspacePage on /workspace', () => {
    window.history.replaceState({}, '', '/workspace');
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    renderShell(store);

    expect(screen.getByText('WorkspacePage')).toBeInTheDocument();
  });

  it('renders the explicit /auth route when auth is enabled and user is unauthenticated', () => {
    window.history.replaceState({}, '', '/auth');
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, true);
    store.set(authenticatedAtom, false);

    renderShell(store);

    expect(screen.getByText('LoginPage')).toBeInTheDocument();
  });

  it('redirects / to /workspace after auth resolves and workspace.list is non-empty', async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'workspace.list') {
        return [{ id: 'ws-1', path: '/tmp/ws-1', targetRuntime: 'native' }];
      }
      return [];
    });
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/workspace');
    });
  });

  it('keeps / on WelcomePage after auth resolves and workspace.list is empty', async () => {
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });

  it('redirects /workspace back to / when auth resolves and workspace.list is empty', async () => {
    window.history.replaceState({}, '', '/workspace');
    const sendCommand = vi.fn().mockResolvedValue([]);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);
    store.set(workspacesAtom, {});
    store.set(workspaceOrderAtom, []);
    store.set(workspacesLoadStateAtom, 'idle');
    store.set(wsClientAtom, { sendCommand } as never);

    renderShell(store);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('workspace.list', {});
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
      expect(screen.getByText('WelcomePage')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 3: Slim down `app.tsx` — keep only the router seam**

Replace contents of `packages/web/src/app.tsx`:

```tsx
/**
 * Application root.
 *
 * Provides BrowserRouter and renders the desktop shell.
 * Phase 0 stub — Task 5 will wire useViewport here to swap shells.
 */

import { BrowserRouter } from 'react-router-dom';
import { DesktopShell } from './shells/desktop-shell';

function App() {
  return (
    <BrowserRouter>
      <DesktopShell />
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Slim down `app.test.tsx` — keep only the router-seam smoke test**

Replace contents of `packages/web/src/app.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import App from './app';
import { authEnabledAtom, connectionStatusAtom } from './atoms/connection';
import { authenticatedAtom } from './atoms/ui';

vi.mock('./features/welcome', () => ({ WelcomePage: () => <div>WelcomePage</div> }));
vi.mock('./features/settings', () => ({ SettingsPage: () => <div>SettingsPage</div> }));
vi.mock('./features/workspace', () => ({ WorkspacePage: () => <div>WorkspacePage</div> }));
vi.mock('./features/command-palette', () => ({ CommandPalette: () => null }));
vi.mock('./features/workspace/components/branch-quick-pick', () => ({ BranchQuickPick: () => null }));
vi.mock('./features/auth', () => ({ LoginPage: () => <div>LoginPage</div> }));
vi.mock('./features/config-drift-banner', () => ({ ConfigDriftBanner: () => null }));
vi.mock('./features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
  ToastContainer: () => null,
}));

describe('App router seam', () => {
  it('mounts the desktop shell inside BrowserRouter', () => {
    window.history.replaceState({}, '', '/');
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByText('正在连接工作区...')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run tests; expect green**

```bash
pnpm --filter @coder-studio/web test
```

Expected: all tests pass — both the new `desktop-shell.test.tsx` (7 tests, copy of original auth-gating suite) and the slimmed `app.test.tsx` (1 smoke test).

If any test fails, fix the import paths or mock paths until green. Do not proceed if red.

- [ ] **Step 6: Manual smoke test**

```bash
pnpm dev:web
```

Open the dev URL the script prints. Verify:
- App loads without console errors
- Routes (`/`, `/workspace`, `/settings`, `/auth`) render the same as before

Stop the dev server.

- [ ] **Step 7: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app.tsx packages/web/src/app.test.tsx packages/web/src/shells/
git commit -m "refactor(web): extract DesktopShell from app.tsx

No behavior change — the existing AppShell + useWorkspaceBootstrap is
moved verbatim into shells/desktop-shell.tsx. Sets up the seam for
mobile shell selection in Phase 0 of the mobile-friendly plan."
```

---

## Task 3: Implement `useViewport` Hook (TDD)

**Files:**
- Create: `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts`
- Create: `packages/web/src/shells/mobile-shell/hooks/use-viewport.test.ts`

**Goal:** Provide a hook that returns `'mobile' | 'desktop'` based on `(max-width: 899px) or (pointer: coarse)`, reactive to viewport changes.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/shells/mobile-shell/hooks/use-viewport.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewport } from './use-viewport';

type MQListener = (event: { matches: boolean }) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: 'change', listener: MQListener) => void;
  removeEventListener: (type: 'change', listener: MQListener) => void;
  trigger: (matches: boolean) => void;
}

function createMatchMediaMock(initialMatches: (query: string) => boolean) {
  const lists = new Map<string, MockMediaQueryList>();

  const matchMedia = vi.fn((query: string) => {
    if (lists.has(query)) {
      return lists.get(query)!;
    }
    const listeners = new Set<MQListener>();
    const list: MockMediaQueryList = {
      matches: initialMatches(query),
      media: query,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      trigger: (matches: boolean) => {
        list.matches = matches;
        for (const listener of listeners) {
          listener({ matches });
        }
      },
    };
    lists.set(query, list);
    return list;
  });

  return { matchMedia, lists };
}

describe('useViewport', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns "desktop" when viewport is wide and pointer is fine', () => {
    const { matchMedia } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('desktop');
  });

  it('returns "mobile" when viewport is narrow', () => {
    const { matchMedia } = createMatchMediaMock((query) =>
      query.includes('max-width: 899px')
    );
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('mobile');
  });

  it('returns "mobile" when pointer is coarse even on wide viewport', () => {
    const { matchMedia } = createMatchMediaMock((query) =>
      query.includes('pointer: coarse')
    );
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());

    expect(result.current).toBe('mobile');
  });

  it('updates reactively when the viewport query changes', () => {
    const { matchMedia, lists } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useViewport());
    expect(result.current).toBe('desktop');

    act(() => {
      lists.get('(max-width: 899px)')!.trigger(true);
    });

    expect(result.current).toBe('mobile');
  });

  it('cleans up listeners on unmount', () => {
    const { matchMedia, lists } = createMatchMediaMock(() => false);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { unmount } = renderHook(() => useViewport());
    const widthList = lists.get('(max-width: 899px)')!;
    const pointerList = lists.get('(pointer: coarse)')!;

    const widthRemove = vi.spyOn(widthList, 'removeEventListener');
    const pointerRemove = vi.spyOn(pointerList, 'removeEventListener');

    unmount();

    expect(widthRemove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(pointerRemove).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run the test — expect failure (module not found)**

```bash
pnpm --filter @coder-studio/web test -- use-viewport
```

Expected: FAIL — `Failed to resolve import "./use-viewport"`.

- [ ] **Step 3: Implement the hook**

Create `packages/web/src/shells/mobile-shell/hooks/use-viewport.ts`:

```ts
/**
 * useViewport
 *
 * Returns "mobile" when the viewport is narrow OR the primary pointer is
 * coarse (touch). Reactive — updates on resize, rotation, or device change.
 *
 * Used by app.tsx to pick between DesktopShell and MobileShell.
 */

import { useEffect, useState } from 'react';

export type Viewport = 'mobile' | 'desktop';

const WIDTH_QUERY = '(max-width: 899px)';
const POINTER_QUERY = '(pointer: coarse)';

const computeViewport = (): Viewport => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }
  const narrow = window.matchMedia(WIDTH_QUERY).matches;
  const coarse = window.matchMedia(POINTER_QUERY).matches;
  return narrow || coarse ? 'mobile' : 'desktop';
};

export const useViewport = (): Viewport => {
  const [viewport, setViewport] = useState<Viewport>(computeViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const widthList = window.matchMedia(WIDTH_QUERY);
    const pointerList = window.matchMedia(POINTER_QUERY);

    const handler = () => setViewport(computeViewport());

    widthList.addEventListener('change', handler);
    pointerList.addEventListener('change', handler);

    handler();

    return () => {
      widthList.removeEventListener('change', handler);
      pointerList.removeEventListener('change', handler);
    };
  }, []);

  return viewport;
};
```

- [ ] **Step 4: Run the test — expect pass**

```bash
pnpm --filter @coder-studio/web test -- use-viewport
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/shells/mobile-shell/hooks/
git commit -m "feat(web): add useViewport hook

Returns 'mobile' | 'desktop' based on max-width: 899px OR
pointer: coarse, reactive to viewport / device changes. Will be
consumed by app.tsx in the next task to pick a shell."
```

---

## Task 4: Implement `<MobileShell>` Stub (TDD)

**Files:**
- Create: `packages/web/src/shells/mobile-shell/index.tsx`
- Create: `packages/web/src/shells/mobile-shell/index.test.tsx`

**Goal:** Mobile shell is a thin pass-through to `<DesktopShell />` for Phase 0. Real chrome arrives in Phase 1.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/shells/mobile-shell/index.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Provider, createStore } from 'jotai';
import { MobileShell } from './index';
import { authEnabledAtom, connectionStatusAtom } from '../../atoms/connection';
import { authenticatedAtom } from '../../atoms/ui';

vi.mock('../../features/welcome', () => ({ WelcomePage: () => <div>WelcomePage</div> }));
vi.mock('../../features/settings', () => ({ SettingsPage: () => null }));
vi.mock('../../features/workspace', () => ({ WorkspacePage: () => null }));
vi.mock('../../features/command-palette', () => ({ CommandPalette: () => null }));
vi.mock('../../features/workspace/components/branch-quick-pick', () => ({ BranchQuickPick: () => null }));
vi.mock('../../features/auth', () => ({ LoginPage: () => null }));
vi.mock('../../features/config-drift-banner', () => ({ ConfigDriftBanner: () => null }));
vi.mock('../../features/notifications', () => ({
  useSessionNotifications: () => {},
  appendSessionOutputAtom: null,
  clearSessionOutputAtom: null,
  ToastContainer: () => null,
}));

describe('MobileShell stub', () => {
  it('renders the desktop shell content (Phase 0 placeholder)', () => {
    window.history.replaceState({}, '', '/');
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <BrowserRouter>
          <MobileShell />
        </BrowserRouter>
      </Provider>
    );

    expect(screen.getByText('WelcomePage')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm --filter @coder-studio/web test -- mobile-shell
```

Expected: FAIL — `Failed to resolve import "./index"`.

- [ ] **Step 3: Implement the stub**

Create `packages/web/src/shells/mobile-shell/index.tsx`:

```tsx
/**
 * MobileShell — Phase 0 stub
 *
 * Phase 0 just delegates to DesktopShell so the seam exists with zero
 * behavior change. Phase 1 will replace the body with the real mobile
 * chrome (topbar, dock, sheet stack, workspace drawer).
 */

import { DesktopShell } from '../desktop-shell';

export function MobileShell() {
  return <DesktopShell />;
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
pnpm --filter @coder-studio/web test -- mobile-shell
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/shells/mobile-shell/index.tsx packages/web/src/shells/mobile-shell/index.test.tsx
git commit -m "feat(web): add MobileShell Phase 0 stub

Delegates to DesktopShell verbatim. Phase 1 will replace the body
with mobile chrome (topbar, dock, sheets, workspace drawer)."
```

---

## Task 5: Wire `app.tsx` to Pick a Shell via `useViewport`

**Files:**
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`

**Goal:** App renders `<MobileShell>` when viewport is mobile, `<DesktopShell>` otherwise. Since MobileShell is currently a pass-through, end-user behavior is identical at any viewport.

- [ ] **Step 1: Update `app.test.tsx` to assert shell selection (TDD — write first)**

Replace contents of `packages/web/src/app.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import App from './app';
import { authEnabledAtom, connectionStatusAtom } from './atoms/connection';
import { authenticatedAtom } from './atoms/ui';

vi.mock('./shells/desktop-shell', () => ({
  DesktopShell: () => <div data-testid="desktop-shell">DesktopShell</div>,
}));

vi.mock('./shells/mobile-shell', () => ({
  MobileShell: () => <div data-testid="mobile-shell">MobileShell</div>,
}));

function setMatchMediaMock(predicate: (query: string) => boolean) {
  const matchMedia = vi.fn((query: string) => ({
    matches: predicate(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
}

describe('App shell selection', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('renders DesktopShell on a wide viewport with fine pointer', () => {
    setMatchMediaMock(() => false);
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('desktop-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-shell')).not.toBeInTheDocument();
  });

  it('renders MobileShell when viewport is narrow', () => {
    setMatchMediaMock((query) => query.includes('max-width: 899px'));
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
    expect(screen.queryByTestId('desktop-shell')).not.toBeInTheDocument();
  });

  it('renders MobileShell when pointer is coarse', () => {
    setMatchMediaMock((query) => query.includes('pointer: coarse'));
    const store = createStore();
    store.set(connectionStatusAtom, 'connected');
    store.set(authEnabledAtom, false);
    store.set(authenticatedAtom, true);

    render(
      <Provider store={store}>
        <App />
      </Provider>
    );

    expect(screen.getByTestId('mobile-shell')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm --filter @coder-studio/web test -- app.test
```

Expected: at least the mobile-shell-rendering tests fail because `app.tsx` always renders DesktopShell.

- [ ] **Step 3: Update `app.tsx` to use `useViewport`**

Replace contents of `packages/web/src/app.tsx`:

```tsx
/**
 * Application root.
 *
 * Provides BrowserRouter and picks a shell based on viewport:
 * - mobile (< 900px or pointer: coarse) → MobileShell
 * - desktop → DesktopShell
 */

import { BrowserRouter } from 'react-router-dom';
import { DesktopShell } from './shells/desktop-shell';
import { MobileShell } from './shells/mobile-shell';
import { useViewport } from './shells/mobile-shell/hooks/use-viewport';

function ShellSwitch() {
  const viewport = useViewport();
  return viewport === 'mobile' ? <MobileShell /> : <DesktopShell />;
}

function App() {
  return (
    <BrowserRouter>
      <ShellSwitch />
    </BrowserRouter>
  );
}

export default App;
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pnpm --filter @coder-studio/web test -- app.test
```

Expected: all 3 shell-selection tests pass.

- [ ] **Step 5: Run the full web test suite — expect green**

```bash
pnpm --filter @coder-studio/web test
```

Expected: every test (desktop-shell + mobile-shell + app + use-viewport + all pre-existing) passes. Compare count to baseline from Task 1.

- [ ] **Step 6: Manual smoke test at both viewports**

```bash
pnpm dev:web
```

In the browser:
1. Open dev URL at full window — expect existing desktop UX
2. Open browser devtools, toggle "Toggle device toolbar" / responsive mode, set viewport to 375×667 (iPhone SE) — expect same UX (because MobileShell is currently a pass-through), confirming the seam works without breaking
3. Resize back to wide — UX unchanged

Stop dev server.

- [ ] **Step 7: Lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app.tsx packages/web/src/app.test.tsx
git commit -m "feat(web): pick shell by viewport in app.tsx

Wire useViewport into app.tsx so MobileShell renders below 900px or
on coarse-pointer devices, DesktopShell otherwise. MobileShell is
still a pass-through so behavior is unchanged."
```

---

## Task 6: Add Touch Tokens to `tokens.css`

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Create: `packages/web/src/styles/tokens-touch.test.ts`

**Goal:** Define touch-target tokens at desktop default, with `@media (max-width: 899px), (pointer: coarse)` overrides for mobile. No consumers in this phase — additions only.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/styles/tokens-touch.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(`${process.cwd()}/src/styles/tokens.css`, 'utf8');

function getRuleBlock(selector: string): string {
  let block = '';
  const matcher = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = matcher.exec(stylesheet)) !== null) {
    const sel = match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (sel === selector) {
      block = match[2];
    }
  }
  return block;
}

describe('tokens.css touch tokens', () => {
  it('defines desktop-default touch target tokens on :root', () => {
    const root = getRuleBlock(':root');

    expect(root).toContain('--touch-target-min: 32px');
    expect(root).toContain('--touch-target-comfortable: 40px');
    expect(root).toContain('--touch-target-large: 44px');
    expect(root).toContain('--touch-spacing-min: 8px');
    expect(root).toContain('--touch-hit-slop: 0px');
  });

  it('overrides touch tokens on narrow viewport OR coarse pointer', () => {
    const mediaMatch = /@media\s*\(max-width:\s*899px\)\s*,\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\}\s*\}/m.exec(
      stylesheet,
    );
    expect(mediaMatch, 'expected @media (max-width: 899px), (pointer: coarse) block').not.toBeNull();
    const body = mediaMatch![1];

    expect(body).toContain('--touch-target-min: 44px');
    expect(body).toContain('--touch-target-comfortable: 48px');
    expect(body).toContain('--touch-target-large: 56px');
    expect(body).toContain('--touch-spacing-min: 12px');
    expect(body).toContain('--touch-hit-slop: 8px');
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
pnpm --filter @coder-studio/web test -- tokens-touch
```

Expected: FAIL — both assertions fail because tokens don't exist yet.

- [ ] **Step 3: Add the desktop tokens to `:root`**

Edit `packages/web/src/styles/tokens.css`. Find the `/* ========== Component-Specific Tokens ========== */` section (around line 126) and add a new block immediately after the existing component tokens, before the closing `}` of `:root`:

Insert the following just before the `:root` block's closing `}` (after the `--scrollbar-track: transparent;` line):

```css

  /* ========== Touch / Pointer (Mobile-Friendly Phase 0) ========== */
  /* Desktop defaults — overridden below for narrow viewport or coarse pointer. */
  --touch-target-min: 32px;
  --touch-target-comfortable: 40px;
  --touch-target-large: 44px;
  --touch-spacing-min: 8px;
  --touch-hit-slop: 0px;
```

- [ ] **Step 4: Add the `@media` override block**

Append the following to the **end** of `tokens.css` (after the `[data-theme="light"]` block):

```css

/* ========== Mobile / Touch Override (Phase 0) ========== */
/* Triggered by narrow viewport OR coarse pointer (touch input). */
@media (max-width: 899px), (pointer: coarse) {
  :root {
    --touch-target-min: 44px;
    --touch-target-comfortable: 48px;
    --touch-target-large: 56px;
    --touch-spacing-min: 12px;
    --touch-hit-slop: 8px;
  }
}
```

- [ ] **Step 5: Run the test — expect pass**

```bash
pnpm --filter @coder-studio/web test -- tokens-touch
```

Expected: both tests pass.

- [ ] **Step 6: Run the full web test suite — confirm no token regression elsewhere**

```bash
pnpm --filter @coder-studio/web test
```

Expected: every test passes, including the existing `components.theme.test.ts`. The new tokens are additive — no consumer changes were made — so visual behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/styles/tokens.css packages/web/src/styles/tokens-touch.test.ts
git commit -m "feat(web): add touch-target tokens with mobile override

New CSS variables --touch-target-{min,comfortable,large},
--touch-spacing-min, --touch-hit-slop. Desktop defaults match
current sizes; @media (max-width: 899px), (pointer: coarse)
upgrades them to iOS-HIG / Material thresholds (44/48/56px).

No consumers yet — this is the foundation for mobile chrome
landing in Phase 1+."
```

---

## Task 7: Final Regression Pass

**Files:** none (verification-only)

- [ ] **Step 1: Run web test suite**

```bash
pnpm --filter @coder-studio/web test
```

Expected: all green. Note the count and compare to the Task 1 baseline. The new total should equal `baseline + 9` (5 useViewport + 1 mobile-shell stub + 3 app shell-selection — minus the 7 auth-gating tests that moved from `app.test.tsx` to `desktop-shell.test.tsx`, which net to zero, plus 2 tokens-touch tests).

- [ ] **Step 2: Run repo lint**

```bash
pnpm lint
```

Expected: clean.

- [ ] **Step 3: Run repo-wide tests if available**

```bash
pnpm -r --if-present test
```

Expected: green across all packages.

- [ ] **Step 4: Run desktop e2e (Phase 0 red-line gate)**

```bash
pnpm acceptance:phase1
```

Expected: all phase-1 e2e scenarios pass. This is the spec's red-line — desktop UX must be unchanged.

If any test fails:
1. Read the failure carefully — is it a real regression in DesktopShell rendering, or is it environmental (e.g., dev server already running on port)?
2. If it's a real regression, the most likely cause is a missing or wrongly-pathed import in `shells/desktop-shell.tsx`. Diff against the pre-Task-2 `app.tsx` — every JSX subtree, every atom hook, every effect must match. Re-run after fixing.
3. Do not weaken or rebaseline the e2e snapshots to make them pass.

- [ ] **Step 5: Manual smoke test — desktop**

```bash
pnpm dev
```

In a wide browser window:
- `/` shows Welcome (or redirects to `/workspace`)
- `/workspace` renders the workspace shell with all panels visible
- `/settings` opens settings normally
- `/auth` (when auth required) renders login
- Connection banner appears when WS reconnects
- Command palette opens via shortcut
- No console errors

Stop dev server.

- [ ] **Step 6: Manual smoke test — mobile-stub viewport**

```bash
pnpm dev:web
```

Open devtools responsive mode at 375×667 (iPhone SE). Verify:
- The app still renders (does NOT crash) — same content as desktop because MobileShell is a pass-through
- No console errors
- Resize the window to >900 wide and back; the shell switches without throwing (you'll see a re-mount via the React tree, but content remains the same since both shells delegate to the same routes)

Stop dev server.

- [ ] **Step 7: Final commit (only if any cleanup or doc tweaks were needed)**

If everything passed and no further changes are needed, no commit. Otherwise commit with `chore(web): phase 0 cleanup`.

---

## Self-Review Notes (for the implementer)

If anything in this plan looks wrong while you're running it — for example, an import path doesn't resolve, or the existing test infrastructure differs from what's described — **stop and surface the discrepancy** before improvising. The plan was written from a static codebase read; small drift between writing and execution is expected, but every divergence should be checked against the spec section §10 Phase 0 first.

The deferred work (components.css token migration) is intentional. Do not start migrating consumers in this plan — that lands incrementally in Phase 1+ as each component is touched by the mobile shell.
