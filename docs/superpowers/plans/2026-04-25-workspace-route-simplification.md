# Workspace Route Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端工作区入口收敛为 `/workspace`，移除 `/workspace/:id`，把当前激活 workspace 改成纯前端内存状态，并保持刷新后默认选择后端 `workspace.list` 返回的第一个 workspace。

**Architecture:**
- 用 `workspaceOrderAtom + workspacesLoadStateAtom + resolvedActiveWorkspaceIdAtom` 把“后端列表顺序”“用户意图 active id”“真实可用 active workspace”拆开，所有读侧 UI 只消费 resolved 状态。
- 路由层只保留 `/workspace`；切换 workspace 的入口不再改 URL、不再写 storage，只在需要跨页面进入工作区时导航到 `/workspace`。
- `WorkspacePage` 成为唯一的列表初始化入口，统一处理 `loading / error / empty / ready` 四种页面状态；通知、toast、命令面板、顶部 tab 全部复用同一条 fallback 链路。

**Tech Stack:** TypeScript 5.x · React 19 · React Router · Jotai · Vitest · Playwright · pnpm workspaces

---

## File Structure

- Modify: `packages/web/src/atoms/ui.ts` — keep `activeWorkspaceIdAtom` name, switch it from `atomWithStorage` to in-memory `atom`.
- Modify: `packages/web/src/atoms/workspaces.ts` — add workspace load/order/resolution atoms and keep `activeWorkspaceAtom` backed by resolved state.
- Create: `packages/web/src/atoms/workspaces.test.ts` — unit tests for `resolvedActiveWorkspaceIdAtom` and load-state fallback.
- Modify: `packages/web/src/app/providers.tsx` — keep `workspaceOrderAtom` in sync when a brand-new `workspace.{id}.meta` event arrives.
- Modify: `packages/web/src/app/providers.test.tsx` — routeEventToAtom regression test for order append without reordering existing entries.
- Create: `packages/web/src/test-utils/workspace-state.ts` — shared helper to seed `workspacesAtom`, `workspaceOrderAtom`, and `workspacesLoadStateAtom` for component tests.
- Modify: `packages/web/src/app.tsx` — remove `/workspace/:id`, make `/` always render `WelcomePage`, wire `/workspace`.
- Modify: `packages/web/src/app.test.tsx` — assert root no longer redirects and `/workspace` renders directly.
- Modify: `packages/web/src/features/workspace/index.tsx` — remove `useParams`, fetch `workspace.list`, render loading/error/empty/ready shells, set list/order atoms.
- Modify: `packages/web/src/features/workspace/index.test.tsx` — rewrite tests around `/workspace` and list-first fallback.
- Modify: `packages/web/src/features/topbar/index.tsx` — render tabs from `orderedWorkspacesAtom`, highlight `resolvedActiveWorkspaceIdAtom`.
- Modify: `packages/web/src/features/topbar/components/tab.tsx` — click/close update atoms only; never navigate to `/workspace/:id`.
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.tsx` — on success set active id and only navigate to `/workspace` when current route is outside the workspace page.
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx` — assert success navigation uses `/workspace`.
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx` — workspace switch commands set active id and only cross-route navigate to `/workspace`.
- Modify: `packages/web/src/features/settings/components/settings-page.tsx` — back button returns to `/workspace`, not `/workspace/:id`.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx` — assert the back button uses the simplified route.
- Modify: `packages/web/src/features/notifications/focus-session.ts` — accept `setActiveWorkspaceId`, remove `localStorage` writes, navigate only to `/workspace`.
- Modify: `packages/web/src/features/notifications/focus-session.test.ts` — assert no storage writes and no route-id path construction.
- Modify: `packages/web/src/features/notifications/toast-container.tsx` — toast click sets active workspace in memory and only page-level navigates to `/workspace`.
- Modify: `packages/web/src/features/notifications/toast-container.test.tsx` — assert click routes to `/workspace` and keeps pending focus behavior.
- Modify: `packages/web/src/features/notifications/use-session-notifications.ts` — compare against `resolvedActiveWorkspaceIdAtom`, pass `setActiveWorkspaceId` into `focusSession`.
- Modify: `packages/web/src/features/notifications/use-session-notifications.test.tsx` — seed ready workspace state and assert browser notifications land on `/workspace`.
- Modify: `packages/web/src/features/terminal-panel/components/terminal-panel.tsx` — consume `resolvedActiveWorkspaceIdAtom` instead of raw writable active id.
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx` — seed ready workspace state.
- Modify: `packages/web/src/features/code-editor/index.test.tsx` — seed ready workspace state because `activeWorkspaceAtom` will now be gated by load state.
- Modify: `packages/web/src/features/agent-panes/index.test.tsx` — seed ready workspace state for the same reason.
- Modify: `e2e/specs/session-hydrate-refresh.spec.ts` — refresh `/workspace` instead of `/workspace/:id`.
- Create: `e2e/fixtures/seed-workspace-route-history-db.ts` — two-workspace DB seed with controlled `last_active_at` ordering.
- Create: `e2e/specs/workspace-route-history.spec.ts` — assert topbar switching does not mutate URL or browser history.
- Modify: `docs/PRD.md` — change route table entry from `/workspace/:id` to `/workspace`.
- Modify: `docs/PRD.zh-CN.md` — same docs sync in Chinese PRD.
- Modify: `docs/mockups.html` — remove the stale `/workspace/:id` copy from the mockup debug text.

## Verification Baseline

```bash
pnpm -w --filter @coder-studio/web test
pnpm --dir e2e exec playwright test specs/session-hydrate-refresh.spec.ts
```

Keep the frontend suite green after every task. Run Playwright only after the route changes and the E2E specs are updated.

### Task 1: Workspace State Model And Ordered Fallback

**Files:**
- Create: `packages/web/src/atoms/workspaces.test.ts`
- Create: `packages/web/src/test-utils/workspace-state.ts`
- Modify: `packages/web/src/atoms/ui.ts`
- Modify: `packages/web/src/atoms/workspaces.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.test.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

- [ ] **Step 1: Write the failing atom tests**

```ts
// packages/web/src/atoms/workspaces.test.ts
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { activeWorkspaceIdAtom } from './ui';
import {
  activeWorkspaceAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
  resolvedActiveWorkspaceIdAtom,
} from './workspaces';

describe('resolvedActiveWorkspaceIdAtom', () => {
  it('falls back to the first ordered workspace when the requested id is missing', () => {
    const store = createStore();

    store.set(workspacesAtom, {
      'ws-a': { id: 'ws-a', path: '/tmp/a', targetRuntime: 'native' } as never,
      'ws-b': { id: 'ws-b', path: '/tmp/b', targetRuntime: 'native' } as never,
    });
    store.set(workspaceOrderAtom, ['ws-b', 'ws-a']);
    store.set(workspacesLoadStateAtom, 'ready');
    store.set(activeWorkspaceIdAtom, 'ws-missing');

    expect(store.get(resolvedActiveWorkspaceIdAtom)).toBe('ws-b');
    expect(store.get(activeWorkspaceAtom)?.id).toBe('ws-b');
  });

  it('returns null until the workspace list has finished loading', () => {
    const store = createStore();

    store.set(workspacesAtom, {
      'ws-a': { id: 'ws-a', path: '/tmp/a', targetRuntime: 'native' } as never,
    });
    store.set(workspaceOrderAtom, ['ws-a']);
    store.set(activeWorkspaceIdAtom, 'ws-a');

    expect(store.get(resolvedActiveWorkspaceIdAtom)).toBeNull();
    expect(store.get(activeWorkspaceAtom)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing order-sync regression test**

```ts
// packages/web/src/app/providers.test.tsx
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { workspaceOrderAtom, workspacesAtom } from '../atoms/workspaces';
import { routeEventToAtom } from './providers';

it('appends brand-new workspaces to workspaceOrderAtom without reordering existing entries', () => {
  const store = createStore();

  store.set(workspacesAtom, {
    'ws-1': { id: 'ws-1', path: '/tmp/one', targetRuntime: 'native' } as never,
  });
  store.set(workspaceOrderAtom, ['ws-1']);

  routeEventToAtom(
    'workspace.ws-2.meta',
    { path: '/tmp/two', targetRuntime: 'native', name: 'Two' },
    store as never
  );

  routeEventToAtom(
    'workspace.ws-1.meta',
    { name: 'Renamed One' },
    store as never
  );

  expect(store.get(workspaceOrderAtom)).toEqual(['ws-1', 'ws-2']);
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm -w --filter @coder-studio/web test -- src/atoms/workspaces.test.ts src/app/providers.test.tsx`
Expected: FAIL with missing exports such as `workspaceOrderAtom` / `workspacesLoadStateAtom`, or the order assertion staying `['ws-1']`.

- [ ] **Step 4: Implement the workspace atoms and the shared test helper**

```ts
// packages/web/src/atoms/ui.ts
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { atomFamily } from 'jotai-family';

export const activeWorkspaceIdAtom = atom<string | null>(null);
```

```ts
// packages/web/src/atoms/workspaces.ts
import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { Workspace } from '@coder-studio/core';
import { activeWorkspaceIdAtom } from './ui';

export type WorkspaceLoadState = 'idle' | 'loading' | 'ready' | 'error';

export const workspacesAtom = atom<Record<string, Workspace>>({});
export const workspaceOrderAtom = atom<string[]>([]);
export const workspacesLoadStateAtom = atom<WorkspaceLoadState>('idle');
export const workspacesLoadErrorAtom = atom<string | null>(null);

export const orderedWorkspaceIdsAtom = atom((get) => {
  const workspaces = get(workspacesAtom);
  const ordered = get(workspaceOrderAtom).filter((id) => Boolean(workspaces[id]));
  const seen = new Set(ordered);

  for (const id of Object.keys(workspaces)) {
    if (!seen.has(id)) {
      ordered.push(id);
      seen.add(id);
    }
  }

  return ordered;
});

export const orderedWorkspacesAtom = atom((get) =>
  get(orderedWorkspaceIdsAtom)
    .map((id) => get(workspacesAtom)[id])
    .filter((workspace): workspace is Workspace => Boolean(workspace))
);

export const workspaceByIdAtomFamily = atomFamily((id: string) =>
  atom((get) => get(workspacesAtom)[id])
);

export const resolvedActiveWorkspaceIdAtom = atom((get) => {
  if (get(workspacesLoadStateAtom) !== 'ready') {
    return null;
  }

  const requestedId = get(activeWorkspaceIdAtom);
  const workspaces = get(workspacesAtom);

  if (requestedId && workspaces[requestedId]) {
    return requestedId;
  }

  return get(orderedWorkspaceIdsAtom)[0] ?? null;
});

export const activeWorkspaceAtom = atom((get) => {
  const workspaceId = get(resolvedActiveWorkspaceIdAtom);
  return workspaceId ? get(workspaceByIdAtomFamily(workspaceId)) : null;
});
```

```ts
// packages/web/src/test-utils/workspace-state.ts
import type { Store } from 'jotai';
import type { Workspace } from '@coder-studio/core';
import {
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from '../atoms/workspaces';

export function seedReadyWorkspaceState(store: Store, workspaces: Workspace[]): void {
  store.set(
    workspacesAtom,
    Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace]))
  );
  store.set(workspaceOrderAtom, workspaces.map((workspace) => workspace.id));
  store.set(workspacesLoadStateAtom, 'ready');
}
```

- [ ] **Step 5: Sync `routeEventToAtom` with workspace ordering**

```ts
// packages/web/src/app/providers.tsx
import {
  wsClientAtom,
  connectionStatusAtom,
  connectionErrorAtom,
  serverInfoAtom,
  authEnabledAtom,
  reconnectAttemptCountAtom,
  lastReconnectAttemptAtom,
  isWriterAtom,
  workspacesAtom,
  workspaceOrderAtom,
  sessionsAtom,
} from '../atoms';

if (subtopic === 'meta') {
  const patch = payload as Partial<Workspace>;
  const existing = store.get(workspacesAtom)[workspaceId];

  if (!existing && !patch.path) {
    return;
  }

  store.set(workspacesAtom, (prev: Record<string, Workspace>) => ({
    ...prev,
    [workspaceId]: {
      ...prev[workspaceId],
      ...patch,
      id: workspaceId,
    } as Workspace,
  }));

  if (!existing) {
    store.set(workspaceOrderAtom, (prev) =>
      prev.includes(workspaceId) ? prev : [...prev, workspaceId]
    );
  }

  return;
}
```

- [ ] **Step 6: Update the tests that read `activeWorkspaceAtom` or resolved workspace state**

```ts
// packages/web/src/features/code-editor/index.test.tsx
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';

seedReadyWorkspaceState(store, [
  {
    id: 'ws-1',
    path: '/tmp/ws',
    targetRuntime: 'native',
  } as never,
]);
store.set(activeWorkspaceIdAtom, 'ws-1');
```

```ts
// packages/web/src/features/agent-panes/index.test.tsx
import { seedReadyWorkspaceState } from '../../test-utils/workspace-state';

seedReadyWorkspaceState(store, [
  {
    id: 'ws-1',
    path: '/tmp/repo',
    targetRuntime: 'native',
  } as never,
]);
store.set(activeWorkspaceIdAtom, 'ws-1');
```

```ts
// packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
import { seedReadyWorkspaceState } from '../../../test-utils/workspace-state';

seedReadyWorkspaceState(store, [
  {
    id: 'ws-test',
    path: '/tmp/ws-test',
    targetRuntime: 'native',
  } as never,
]);
store.set(activeWorkspaceIdAtom, 'ws-test');
```

- [ ] **Step 7: Run the targeted state tests**

Run: `pnpm -w --filter @coder-studio/web test -- src/atoms/workspaces.test.ts src/app/providers.test.tsx src/features/code-editor/index.test.tsx src/features/agent-panes/index.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/atoms/ui.ts \
  packages/web/src/atoms/workspaces.ts \
  packages/web/src/atoms/workspaces.test.ts \
  packages/web/src/app/providers.tsx \
  packages/web/src/app/providers.test.tsx \
  packages/web/src/test-utils/workspace-state.ts \
  packages/web/src/features/code-editor/index.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
git commit -m "refactor(web): add resolved workspace state model"
```

### Task 2: Simplify Routing And WorkspacePage Loading

**Files:**
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`
- Modify: `packages/web/src/features/workspace/index.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`

- [ ] **Step 1: Rewrite the app/workspace tests around the new route contract**

```tsx
// packages/web/src/app.test.tsx
import { activeWorkspaceIdAtom } from './atoms/ui';

it('keeps the welcome page on / even when an active workspace exists', () => {
  window.history.replaceState({}, '', '/');

  const store = createStore();
  store.set(connectionStatusAtom, 'connected');
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);
  store.set(activeWorkspaceIdAtom, 'ws-123');

  render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  expect(screen.getByText('WelcomePage')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/');
});

it('renders the workspace page at /workspace', () => {
  window.history.replaceState({}, '', '/workspace');

  const store = createStore();
  store.set(connectionStatusAtom, 'connected');
  store.set(authEnabledAtom, false);
  store.set(authenticatedAtom, true);

  render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  expect(screen.getByText('WorkspacePage')).toBeInTheDocument();
});
```

```tsx
// packages/web/src/features/workspace/index.test.tsx
import {
  resolvedActiveWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';
import { activeWorkspaceIdAtom } from '../../atoms/ui';

it('selects the first workspace returned by workspace.list on /workspace refresh', async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === 'workspace.list') {
      return [
        { id: 'ws-first', path: '/tmp/first', targetRuntime: 'native' },
        { id: 'ws-second', path: '/tmp/second', targetRuntime: 'native' },
      ];
    }
    return [];
  });

  const store = createStore();
  store.set(connectionStatusAtom, 'connected');
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/workspace']}>
        <Routes>
          <Route path="/workspace" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  await waitFor(() => {
    expect(store.get(workspacesLoadStateAtom)).toBe('ready');
  });

  expect(store.get(workspaceOrderAtom)).toEqual(['ws-first', 'ws-second']);
  expect(store.get(activeWorkspaceIdAtom)).toBeNull();
  expect(store.get(resolvedActiveWorkspaceIdAtom)).toBe('ws-first');
  expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
});

it('shows an error shell instead of the empty state when workspace.list fails', async () => {
  const sendCommand = vi.fn().mockResolvedValue({
    ok: false,
    error: { code: 'command_error', message: 'workspace.list failed' },
  });

  const store = createStore();
  store.set(connectionStatusAtom, 'connected');
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/workspace']}>
        <Routes>
          <Route path="/workspace" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  expect(await screen.findByText('无法加载工作区')).toBeInTheDocument();
  expect(screen.queryByText('未打开工作区')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the routing tests to verify they fail**

Run: `pnpm -w --filter @coder-studio/web test -- src/app.test.tsx src/features/workspace/index.test.tsx`
Expected: FAIL because `/workspace` is not routed, `/` still redirects when `activeWorkspaceIdAtom` is set, and the workspace page still expects `:id`.

- [ ] **Step 3: Simplify the route table**

```tsx
// packages/web/src/app.tsx
import { connectionStatusAtom, authEnabledAtom } from './atoms';

function RootRoute() {
  return <WelcomePage />;
}

<Routes>
  {shouldShowLogin ? (
    <Route path="*" element={<LoginPage />} />
  ) : (
    <>
      <Route path="/" element={<RootRoute />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="/settings" element={<SettingsPage />} />
    </>
  )}
</Routes>
```

- [ ] **Step 4: Refactor `WorkspacePage` to own list loading and shell state**

```tsx
// packages/web/src/features/workspace/index.tsx
import {
  activeWorkspaceAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';

const workspaceListLoading = loadState === 'idle' || loadState === 'loading';

const loadWorkspaces = useCallback(async () => {
  if (connectionStatus !== 'connected') {
    return;
  }

  setLoadState('loading');
  setLoadError(null);

  const result = await dispatch<Workspace[]>('workspace.list', {});
  if (!result.ok || !result.data) {
    setLoadState('error');
    setLoadError(result.error?.message ?? 'Failed to load workspaces');
    return;
  }

  setWorkspaces(Object.fromEntries(result.data.map((ws) => [ws.id, ws])));
  setWorkspaceOrder(result.data.map((ws) => ws.id));
  setLoadState('ready');
}, [connectionStatus, dispatch, setLoadError, setLoadState, setWorkspaceOrder, setWorkspaces]);

useEffect(() => {
  if (loadState !== 'idle' || connectionStatus !== 'connected') {
    return;
  }

  void loadWorkspaces();
}, [connectionStatus, loadState, loadWorkspaces]);

if (!workspace) {
  return (
    <div className="workspace-page">
      <TopBar />
      {workspaceListLoading ? (
        <div className="workspace-resolving-shell" data-testid="workspace-resolving-shell">
          <div className="workspace-resolving-card">
            <div className="workspace-resolving-kicker">WORKSPACE INITIALIZING</div>
            <h1 className="workspace-resolving-title">正在进入工作区...</h1>
            <p className="workspace-resolving-desc">
              正在同步 workspace 元数据、会话和文件树，界面准备完成后会自动展开。
            </p>
          </div>
        </div>
      ) : loadState === 'error' ? (
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <h2>无法加载工作区</h2>
            <p>{loadError ?? 'workspace.list failed'}</p>
            <button className="btn btn-primary btn-sm" onClick={() => void loadWorkspaces()}>
              <RefreshCw size={14} />
              <span>重试</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="workspace-empty-content">
          <div className="workspace-empty-inner">
            <p>{t('workspace.no_workspace') || 'No workspace loaded'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
```

Delete the entire `useParams`, URL-sync, `missingWorkspaceIdRef`, and `lastWorkspaceFetchRef` branch. The page no longer reasons about route ids.

- [ ] **Step 5: Run the workspace route tests**

Run: `pnpm -w --filter @coder-studio/web test -- src/app.test.tsx src/features/workspace/index.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app.tsx \
  packages/web/src/app.test.tsx \
  packages/web/src/features/workspace/index.tsx \
  packages/web/src/features/workspace/index.test.tsx
git commit -m "refactor(web): simplify workspace routing"
```

### Task 3: Remove Workspace-Id Navigation From UI Entry Points

**Files:**
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/components/tab.tsx`
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Add the regression tests for `/workspace`-only navigation**

```tsx
// packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({ pathname: '/' }),
  };
});

it('navigates to /workspace after opening a workspace from outside the workspace page', async () => {
  const onClose = vi.fn();
  const sendCommand = vi.fn().mockImplementation(async (op: string, args: { path?: string }) => {
    if (op === 'workspace.browse') {
      return {
        currentPath: '/home/spencer',
        parentPath: '/home',
        directories: [
          { name: 'workspace', path: '/home/spencer/workspace' },
        ],
      };
    }

    if (op === 'workspace.open') {
      return { id: 'ws-1' };
    }

    return {};
  });

  const store = createStore();
  store.set(wsClientAtom, { sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <WorkspaceLaunchModal onClose={onClose} />
      </MemoryRouter>
    </Provider>
  );

  const folderName = await screen.findByText('workspace');
  fireEvent.click(folderName);
  fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('workspace.open', {
      path: '/home/spencer/workspace',
    });
  });

  await waitFor(() => {
    expect(navigate).toHaveBeenCalledWith('/workspace');
  });
});
```

```tsx
// packages/web/src/features/settings/components/settings-page.test.tsx
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

it('returns to /workspace from settings', async () => {
  const store = createStore();
  const sendCommand = vi.fn().mockResolvedValue({});
  store.set(connectionStatusAtom, 'connected');
  store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/settings']}>
        <SettingsPage />
      </MemoryRouter>
    </Provider>
  );

  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(navigate).toHaveBeenCalledWith('/workspace');
});
```

- [ ] **Step 2: Run the entry-point tests to verify they fail**

Run: `pnpm -w --filter @coder-studio/web test -- src/features/workspace/components/workspace-launch-modal.test.tsx src/features/settings/components/settings-page.test.tsx`
Expected: FAIL because the modal still navigates to `/workspace/<id>` and settings still uses `activeWorkspaceIdAtom` to build the path.

- [ ] **Step 3: Make topbar, modal, palette, and settings route-independent**

```tsx
// packages/web/src/features/topbar/index.tsx
import {
  orderedWorkspacesAtom,
  resolvedActiveWorkspaceIdAtom,
} from '../../atoms/workspaces';

const workspaceList = useAtomValue(orderedWorkspacesAtom);
const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
```

```tsx
// packages/web/src/features/topbar/components/tab.tsx
import { workspaceOrderAtom, workspacesAtom } from '../../../atoms/workspaces';

const workspaceOrder = useAtomValue(workspaceOrderAtom);
const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);

const handleClick = () => {
  setActiveWorkspace(workspace.id);
};

const handleClose = async (e: React.MouseEvent) => {
  e.stopPropagation();
  const result = await dispatch<void>('workspace.close', { id: workspace.id });
  if (!result.ok) return;

  const remainingIds = workspaceOrder.filter((id) => id !== workspace.id);

  setWorkspaces((prev) => {
    const next = { ...prev };
    delete next[workspace.id];
    return next;
  });
  setWorkspaceOrder(remainingIds);

  if (isActive) {
    setActiveWorkspace(remainingIds[0] ?? null);
  }
};
```

```tsx
// packages/web/src/features/workspace/components/workspace-launch-modal.tsx
import { useLocation, useNavigate } from 'react-router-dom';

const location = useLocation();

if (result.ok && result.data?.id) {
  setActiveWorkspaceId(result.data.id);

  if (location.pathname !== '/workspace') {
    navigate('/workspace');
  }

  onClose();
}
```

```tsx
// packages/web/src/features/command-palette/components/command-palette.tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';

const location = useLocation();
const workspaces = useAtomValue(orderedWorkspacesAtom);
const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

const focusWorkspace = (workspaceId: string) => {
  setActiveWorkspaceId(workspaceId);
  if (location.pathname !== '/workspace') {
    navigate('/workspace');
  }
};

commands.push({
  id: `switch-workspace-${ws.id}`,
  label: `${t('workspace.title')}: ${workspaceLabel}`,
  description: ws.path || ws.id,
  action: () => focusWorkspace(ws.id),
});
```

```tsx
// packages/web/src/features/settings/components/settings-page.tsx
const handleBack = () => {
  navigate('/workspace');
};
```

- [ ] **Step 4: Re-run the entry-point tests**

Run: `pnpm -w --filter @coder-studio/web test -- src/features/workspace/components/workspace-launch-modal.test.tsx src/features/settings/components/settings-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/topbar/index.tsx \
  packages/web/src/features/topbar/components/tab.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "refactor(web): remove workspace id navigation from ui entry points"
```

### Task 4: Refactor Notifications And Other Read-Side Consumers

**Files:**
- Modify: `packages/web/src/features/notifications/focus-session.ts`
- Modify: `packages/web/src/features/notifications/focus-session.test.ts`
- Modify: `packages/web/src/features/notifications/toast-container.tsx`
- Modify: `packages/web/src/features/notifications/toast-container.test.tsx`
- Modify: `packages/web/src/features/notifications/use-session-notifications.ts`
- Modify: `packages/web/src/features/notifications/use-session-notifications.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/components/terminal-panel.tsx`

- [ ] **Step 1: Rewrite the notification tests around the new contract**

```ts
// packages/web/src/features/notifications/focus-session.test.ts
it('sets the active workspace in memory, sets the pending-focus marker, and navigates to /workspace', () => {
  const setPendingFocus = vi.fn();
  const setActiveWorkspaceId = vi.fn();
  const navigate = vi.fn();

  focusSession({
    workspaceId: 'ws-7',
    sessionId: 'sess-42',
    setPendingFocus,
    setActiveWorkspaceId,
    navigate,
  });

  expect(setActiveWorkspaceId).toHaveBeenCalledWith('ws-7');
  expect(setPendingFocus).toHaveBeenCalledWith('sess-42');
  expect(navigate).toHaveBeenCalledWith('/workspace');
  expect(window.localStorage.getItem('ui.activeWorkspaceId')).toBeNull();
});
```

```tsx
// packages/web/src/features/notifications/toast-container.test.tsx
import { activeWorkspaceIdAtom, pendingFocusSessionAtom } from '../../atoms/ui';

it('clicking a session-bearing toast navigates to /workspace and sets the active workspace in memory', () => {
  const store = renderWithToast({
    kind: 'success',
    title: 'Session done',
    workspaceId: 'ws-9',
    sessionId: 'sess-77',
  });

  fireEvent.click(screen.getByRole('alert'));

  expect(navigate).toHaveBeenCalledWith('/workspace');
  expect(store.get(activeWorkspaceIdAtom)).toBe('ws-9');
  expect(store.get(pendingFocusSessionAtom)).toBe('sess-77');
});
```

```tsx
// packages/web/src/features/notifications/use-session-notifications.test.tsx
import {
  workspaceOrderAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';

function seedWorkspace(store: ReturnType<typeof createStore>, id: string) {
  const existing = store.get(workspacesAtom);
  const order = store.get(workspaceOrderAtom);

  store.set(workspacesAtom, {
    ...existing,
    [id]: {
      id,
      path: `/tmp/${id}`,
      targetRuntime: 'native',
      openedAt: 0,
      lastActiveAt: 0,
      uiState: { leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false },
    },
  });
  store.set(workspaceOrderAtom, order.includes(id) ? order : [...order, id]);
  store.set(workspacesLoadStateAtom, 'ready');
}

it('wires the system notification onclick to land on /workspace', async () => {
  setDocumentHidden(true);
  const store = createStore();
  store.set(connectionStatusAtom, 'disconnected');
  store.set(notificationPreferencesAtom, { enabled: true, soundEnabled: true });
  seedWorkspace(store, 'ws-current');
  seedWorkspace(store, 'ws-target');
  store.set(activeWorkspaceIdAtom, 'ws-current');
  window.history.pushState({}, '', '/settings');
  seedRunningSession(store, 'sess-target', 'ws-target');

  mountAndCompleteTurn(store, () => {
    store.set(sessionsAtom, {
      'sess-target': createSession('sess-target', 'idle', 'ws-target'),
    });
  });

  await waitFor(() => {
    expect(NotificationMock).toHaveBeenCalledTimes(1);
  });

  const notification = NotificationMock.mock.results[0]?.value as {
    onclick: (() => void) | null;
    close: () => void;
  };
  expect(notification?.onclick).toBeTypeOf('function');

  act(() => {
    notification.onclick?.();
  });

  expect(store.get(pendingFocusSessionAtom)).toBe('sess-target');
  expect(window.location.pathname).toBe('/workspace');
});
```

- [ ] **Step 2: Run the notification tests to verify they fail**

Run: `pnpm -w --filter @coder-studio/web test -- src/features/notifications/focus-session.test.ts src/features/notifications/toast-container.test.tsx src/features/notifications/use-session-notifications.test.tsx`
Expected: FAIL because `focusSession` still writes `localStorage`, `ToastContainer` still builds `/workspace/<id>`, and `useSessionNotifications` still reasons about the raw writable active id.

- [ ] **Step 3: Implement the new focus path and resolved active reads**

```ts
// packages/web/src/features/notifications/focus-session.ts
export interface FocusSessionOptions {
  workspaceId: string;
  sessionId: string;
  setPendingFocus: (sessionId: string | null) => void;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  navigate?: (path: string) => void;
}

export function focusSession(opts: FocusSessionOptions): void {
  const {
    workspaceId,
    sessionId,
    setPendingFocus,
    setActiveWorkspaceId,
    navigate,
  } = opts;

  if (typeof window === 'undefined') return;

  setActiveWorkspaceId(workspaceId);
  setPendingFocus(sessionId);

  if (window.location.pathname === '/workspace') {
    return;
  }

  if (navigate) {
    navigate('/workspace');
  } else {
    window.history.pushState({}, '', '/workspace');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
```

```tsx
// packages/web/src/features/notifications/toast-container.tsx
import { activeWorkspaceIdAtom, pendingFocusSessionAtom } from '../../atoms/ui';

const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

if (toast.workspaceId && toast.sessionId) {
  focusSession({
    workspaceId: toast.workspaceId,
    sessionId: toast.sessionId,
    setPendingFocus,
    setActiveWorkspaceId,
    navigate,
  });
} else if (toast.workspaceId) {
  setActiveWorkspaceId(toast.workspaceId);
  if (window.location.pathname !== '/workspace') {
    navigate('/workspace');
  }
}
```

```ts
// packages/web/src/features/notifications/use-session-notifications.ts
import { resolvedActiveWorkspaceIdAtom } from '../../atoms/workspaces';

const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

focusSession({
  workspaceId: opts.workspaceId,
  sessionId: opts.sessionId,
  setPendingFocus: opts.setPendingFocus,
  setActiveWorkspaceId,
});
```

```tsx
// packages/web/src/features/terminal-panel/components/terminal-panel.tsx
import { resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';

const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
```

- [ ] **Step 4: Re-run the notification and consumer tests**

Run: `pnpm -w --filter @coder-studio/web test -- src/features/notifications/focus-session.test.ts src/features/notifications/toast-container.test.tsx src/features/notifications/use-session-notifications.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/notifications/focus-session.ts \
  packages/web/src/features/notifications/focus-session.test.ts \
  packages/web/src/features/notifications/toast-container.tsx \
  packages/web/src/features/notifications/toast-container.test.tsx \
  packages/web/src/features/notifications/use-session-notifications.ts \
  packages/web/src/features/notifications/use-session-notifications.test.tsx \
  packages/web/src/features/terminal-panel/components/terminal-panel.tsx
git commit -m "refactor(web): route notification focus through /workspace"
```

### Task 5: Update E2E Coverage And Remove Stale Route References

**Files:**
- Modify: `e2e/specs/session-hydrate-refresh.spec.ts`
- Create: `e2e/fixtures/seed-workspace-route-history-db.ts`
- Create: `e2e/specs/workspace-route-history.spec.ts`
- Modify: `docs/PRD.md`
- Modify: `docs/PRD.zh-CN.md`
- Modify: `docs/mockups.html`

- [ ] **Step 1: Adapt the refresh hydration E2E to the new route**

```ts
// e2e/specs/session-hydrate-refresh.spec.ts
test('keeps hydrated interrupted and unavailable sessions mounted after refresh', async ({ page }) => {
  await page.addInitScript(({ paneLayout }) => {
    window.localStorage.setItem('ui.paneLayout.ws-hydrate-e2e', JSON.stringify(paneLayout));
  }, {
    paneLayout: HYDRATED_PANE_LAYOUT,
  });

  await page.goto('/workspace');
  await expect(page.getByTestId('workspace-resolving-shell')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.session-card.agent-pane')).toHaveCount(2, { timeout: 20000 });

  await page.reload();

  await expect(page.getByTestId('workspace-resolving-shell')).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.session-card.agent-pane')).toHaveCount(2, { timeout: 20000 });
});
```

- [ ] **Step 2: Create a two-workspace seed fixture for history coverage**

```ts
// e2e/fixtures/seed-workspace-route-history-db.ts
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeDatabase, openDatabase } from '../../packages/server/src/storage/db.ts';

const [, , dbPath, firstPath, secondPath] = process.argv;

if (!dbPath || !firstPath || !secondPath) {
  throw new Error('Usage: tsx seed-workspace-route-history-db.ts <db-path> <first-path> <second-path>');
}

mkdirSync(dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });

const db = openDatabase(dbPath);
const now = Date.now();

try {
  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, path, target_runtime, wsl_distro, opened_at, last_active_at, ui_state)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  insertWorkspace.run(
    'ws-history-first',
    firstPath,
    'native',
    null,
    now,
    now,
    JSON.stringify({ leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false })
  );

  insertWorkspace.run(
    'ws-history-second',
    secondPath,
    'native',
    null,
    now - 1_000,
    now - 1_000,
    JSON.stringify({ leftPanelWidth: 280, bottomPanelHeight: 200, focusMode: false })
  );
} finally {
  closeDatabase(db);
}
```

- [ ] **Step 3: Add the browser-history regression spec**

```ts
// e2e/specs/workspace-route-history.spec.ts
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const HOST = '127.0.0.1';
const SERVER_PORT = 43174;
const WEB_PORT = 53174;
const BACKEND_HTTP_URL = `http://${HOST}:${SERVER_PORT}`;
const BASE_URL = `http://${HOST}:${WEB_PORT}`;

let sandboxDir: string;
let firstWorkspaceDir: string;
let secondWorkspaceDir: string;
let dbPath: string;
let runtimeDir: string;
let backendProcess: ChildProcess | undefined;
let webProcess: ChildProcess | undefined;

function startProcess(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForHttp(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test.describe('workspace route history', () => {
  test.beforeAll(async () => {
    sandboxDir = mkdtempSync(join(tmpdir(), 'coder-studio-workspace-history-'));
    firstWorkspaceDir = join(sandboxDir, 'history-first');
    secondWorkspaceDir = join(sandboxDir, 'history-second');
    dbPath = join(sandboxDir, 'coder-studio.db');
    runtimeDir = join(sandboxDir, 'runtime');

    mkdirSync(join(firstWorkspaceDir, '.git'), { recursive: true });
    mkdirSync(join(secondWorkspaceDir, '.git'), { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(join(firstWorkspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(secondWorkspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const seed = startProcess(
      'pnpm',
      ['exec', 'tsx', 'e2e/fixtures/seed-workspace-route-history-db.ts', dbPath, firstWorkspaceDir, secondWorkspaceDir],
      '/home/spencer/workspace/coder-studio'
    );

    await new Promise<void>((resolve, reject) => {
      seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited with code ${code}`))));
      seed.on('error', reject);
    });

    backendProcess = startProcess(
      'pnpm',
      ['exec', 'tsx', 'packages/server/src/server.ts'],
      '/home/spencer/workspace/coder-studio',
      {
        HOST,
        PORT: String(SERVER_PORT),
        DATA_DIR: dbPath,
        RUNTIME_DIR: runtimeDir,
        NO_AUTH: 'true',
      }
    );
    await waitForHttp(`${BACKEND_HTTP_URL}/healthz`);

    webProcess = startProcess(
      'pnpm',
      ['exec', 'vite', '--host', HOST, '--port', String(WEB_PORT)],
      '/home/spencer/workspace/coder-studio/packages/web',
      {
        VITE_BACKEND_HTTP_URL: BACKEND_HTTP_URL,
        VITE_BACKEND_WS_URL: `ws://${HOST}:${SERVER_PORT}/ws`,
      }
    );
    await waitForHttp(`${BASE_URL}/`);
  });

  test.afterAll(async () => {
    backendProcess?.kill('SIGTERM');
    webProcess?.kill('SIGTERM');
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  test.use({ baseURL: BASE_URL });

  test('switching workspace tabs keeps the URL on /workspace and does not add per-workspace history entries', async ({ page }) => {
    await page.goto('/');
    await page.goto('/workspace');

    await expect(page).toHaveURL(`${BASE_URL}/workspace`);
    await page.getByRole('button', { name: 'history-second' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/workspace`);

    await page.goBack();
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });
});
```

- [ ] **Step 4: Sync the stale route references in docs**

```md
<!-- docs/PRD.md -->
| `/workspace` | Opens the workspace shell and resolves the active workspace in the client |
```

```md
<!-- docs/PRD.zh-CN.md -->
| `/workspace` | 打开工作区壳层，并由前端解析当前激活的 workspace |
```

```html
<!-- docs/mockups.html -->
<div class="term-line"><span class="term-output">Routes detected: /workspace, /settings</span></div>
```

- [ ] **Step 5: Run the full verification pass**

Run: `pnpm -w --filter @coder-studio/web test -- src/app.test.tsx src/atoms/workspaces.test.ts src/app/providers.test.tsx src/features/workspace/index.test.tsx src/features/workspace/components/workspace-launch-modal.test.tsx src/features/settings/components/settings-page.test.tsx src/features/notifications/focus-session.test.ts src/features/notifications/toast-container.test.tsx src/features/notifications/use-session-notifications.test.tsx`
Expected: PASS.

Run: `pnpm --dir e2e exec playwright test specs/session-hydrate-refresh.spec.ts specs/workspace-route-history.spec.ts`
Expected: PASS.

Run: `rg -n "/workspace/:id|/workspace/\\$\\{|ui\\.activeWorkspaceId" packages/web/src e2e docs/PRD.md docs/PRD.zh-CN.md docs/mockups.html`
Expected: no matches under `packages/web/src` for `/workspace/:id`, `/workspace/${`, or `ui.activeWorkspaceId`; remaining matches in the new design/spec docs are acceptable.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/session-hydrate-refresh.spec.ts \
  e2e/fixtures/seed-workspace-route-history-db.ts \
  e2e/specs/workspace-route-history.spec.ts \
  docs/PRD.md \
  docs/PRD.zh-CN.md \
  docs/mockups.html
git commit -m "test(web): cover workspace route simplification end to end"
```

## Self-Review

**Spec coverage:**
- Single route `/workspace`: Task 2 and Task 3.
- Frontend-only active workspace state: Task 1 and Task 4.
- Refresh picks first `workspace.list` result: Task 1 atom fallback + Task 2 page load + Task 5 E2E.
- Browser history does not participate in workspace switching: Task 3 removes per-workspace navigation; Task 5 verifies it end-to-end.
- Notifications / command palette / settings / launch modal stop constructing `/workspace/:id`: Task 3 and Task 4.
- Error/empty/loading/ready shells only: Task 2.

**Placeholder scan:**
- No `TODO` / `TBD` / “handle appropriately”.
- Every task lists exact files, commands, and concrete code snippets.

**Type consistency:**
- Writable intent atom remains `activeWorkspaceIdAtom`.
- Read-side atoms are `workspaceOrderAtom`, `workspacesLoadStateAtom`, `workspacesLoadErrorAtom`, `resolvedActiveWorkspaceIdAtom`, and `activeWorkspaceAtom`.
- All route changes use literal `/workspace`; no task reintroduces `/workspace/:id`.
