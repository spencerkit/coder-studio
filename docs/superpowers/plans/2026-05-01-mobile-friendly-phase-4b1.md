# Mobile-Friendly Phase 4B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt `WorkspaceLaunchModal`, `WorktreeModal`, and supervisor objective editing so they use mobile-friendly sheet flows on phones without changing desktop behavior or websocket contracts.

**Architecture:** Reuse the shared `(max-width: 899px) || (pointer: coarse)` viewport rule inside each feature component. Extend the existing `MobileSheet` scaffold with optional back/footer/class hooks, let `WorkspaceLaunchModal` and `WorktreeModal` self-adapt in place, and move mobile supervisor objective editing into a root/detail flow hosted by `MobileSupervisorSheet` so phones never stack a second overlay above the supervisor sheet.

**Tech Stack:** React 19, jotai, react-router-dom, lucide-react, existing websocket command atoms, vitest + Testing Library, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-4b1-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md` Phase 4.

---

## File Structure

**New files:**
- `packages/web/src/features/workspace/components/worktree-modal.test.tsx` — focused coverage for desktop/mobile worktree rendering and tab-driven fetch behavior
- `packages/web/src/features/supervisor/components/objective-dialog-content.tsx` — shared objective body/footer primitives, shared copy, and shared mode icon for desktop dialog and mobile in-sheet detail
- `packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts` — shared supervisor objective state/actions (`close`, `updateDraft`, `confirm`) reused by desktop dialog and mobile sheet detail
- `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx` — focused tests for mobile supervisor root/detail navigation and no-nested-overlay behavior

**Modified files:**
- `packages/web/src/shells/mobile-shell/mobile-sheet.tsx` — add optional kicker/back/footer/class hooks so mobile secondary surfaces share one scaffold
- `packages/web/src/shells/mobile-shell/index.tsx` — special-case supervisor sheet rendering so `MobileSupervisorSheet` can own its root/detail flow while files/terminal keep the generic wrapper
- `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx` — replace inline `ObjectiveDialog` overlay usage with a root/detail mobile sheet host
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx` — branch between desktop overlay and mobile `MobileSheet` while preserving browse/open logic
- `packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx` — add viewport-driven mobile coverage
- `packages/web/src/features/workspace/components/worktree-modal.tsx` — branch between desktop overlay and mobile `MobileSheet` while preserving tab loading logic
- `packages/web/src/features/supervisor/components/objective-dialog.tsx` — keep centered desktop modal behavior and return `null` on mobile because the mobile sheet now hosts objective detail
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx` — add desktop regression and mobile null-render assertions
- `packages/web/src/styles/components.css` — mobile sheet scaffold enhancements plus launch/worktree/supervisor mobile layout rules

**No changes in 4B1:**
- `packages/web/src/features/command-palette/*`
- route structure
- workspace open command payloads and navigation semantics
- worktree websocket command names or payloads
- supervisor websocket contracts or atoms in `packages/web/src/features/supervisor/atoms.ts`
- toast positioning and config-drift compaction outside the already-finished `Settings` page work

---

## Task 1: Write Failing Tests for Mobile Workspace and Worktree Surfaces

**Files:**
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx`
- Create: `packages/web/src/features/workspace/components/worktree-modal.test.tsx`

- [ ] **Step 1: Add a shared viewport mock to `workspace-launch-modal.test.tsx` and append a failing mobile test**

Insert this hoisted mock above the `react-router-dom` mock:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Reset it in `afterEach`:

```tsx
afterEach(() => {
  viewportMocks.viewport = 'desktop';
  routerMocks.navigate.mockReset();
  routerMocks.location.pathname = '/';
  vi.restoreAllMocks();
});
```

Append this new test:

```tsx
it('renders inside MobileSheet on mobile while preserving browse and open behavior', async () => {
  viewportMocks.viewport = 'mobile';
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
      return {
        id: 'ws-1',
      };
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

  expect(document.querySelector('.mobile-sheet')).toBeTruthy();
  expect(document.querySelector('.launch-overlay')).toBeNull();

  const folderName = await screen.findByText('workspace');
  fireEvent.click(folderName);
  fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith('workspace.open', {
      path: '/home/spencer/workspace',
    });
  });

  await waitFor(() => {
    expect(onClose).toHaveBeenCalled();
  });
});
```

This should fail because `WorkspaceLaunchModal` does not currently import `useViewport` or render `MobileSheet`.

- [ ] **Step 2: Create `worktree-modal.test.tsx` with failing desktop/mobile coverage**

Create `packages/web/src/features/workspace/components/worktree-modal.test.tsx`:

```tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import type { WorktreeInfo } from '@coder-studio/core';
import { wsClientAtom } from '../../../atoms/connection';
import { WorktreeModal } from './worktree-modal';

const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));

const worktree: WorktreeInfo = {
  name: 'feature/mobile-sheet',
  path: '/tmp/coder-studio-feature',
  branch: 'feature/mobile-sheet',
  commit: 'abc1234',
  status: 'dirty',
};

describe('WorktreeModal', () => {
  afterEach(() => {
    viewportMocks.viewport = 'desktop';
    vi.restoreAllMocks();
  });

  it('keeps the centered modal shell on desktop viewports', async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: 'feature/mobile-sheet',
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    const store = createStore();
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector('.modal-overlay')).toBeTruthy();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });
  });

  it('renders inside MobileSheet on mobile and still loads data when tabs change', async () => {
    viewportMocks.viewport = 'mobile';
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === 'worktree.status') {
        return {
          status: {
            branch: 'feature/mobile-sheet',
            ahead: 0,
            behind: 0,
            staged: [],
            modified: [{ path: 'src/app.tsx' }],
            untracked: [],
            deleted: [],
          },
        };
      }

      if (op === 'worktree.diff') {
        return {
          diff: 'diff --git a/src/app.tsx b/src/app.tsx',
        };
      }

      if (op === 'worktree.tree') {
        return {
          tree: [],
        };
      }

      return {};
    });

    const store = createStore();
    store.set(
      wsClientAtom,
      {
        sendCommand,
        subscribe: vi.fn(() => () => {}),
      } as never
    );

    render(
      <Provider store={store}>
        <WorktreeModal worktree={worktree} onClose={vi.fn()} />
      </Provider>
    );

    expect(document.querySelector('.mobile-sheet')).toBeTruthy();
    expect(document.querySelector('.modal-overlay')).toBeNull();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.status', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Diff' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('worktree.diff', {
        worktreePath: '/tmp/coder-studio-feature',
      });
    });

    expect(await screen.findByText('diff --git a/src/app.tsx b/src/app.tsx')).toBeInTheDocument();
  });
});
```

The mobile test should fail because `WorktreeModal` does not currently render a mobile sheet.

- [ ] **Step 3: Run the focused workspace surface tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx
```

Expected:
- the new `WorkspaceLaunchModal` mobile assertion fails because `.mobile-sheet` is absent
- the new `WorktreeModal` mobile assertion fails because `.modal-overlay` still renders on mobile

- [ ] **Step 4: Commit the failing test scaffold**

```bash
git add \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx
git commit -m "test: cover mobile workspace secondary surfaces"
```

Expected: commit succeeds with only test changes.

---

## Task 2: Implement the Shared Mobile Sheet Scaffold and Modal Self-Adaptation

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/mobile-sheet.tsx`
- Modify: `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/components/worktree-modal.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Extend `MobileSheet` with optional kicker, back, footer, and class hooks**

Replace `packages/web/src/shells/mobile-shell/mobile-sheet.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface MobileSheetProps {
  title: string;
  body: ReactNode;
  onClose: () => void;
  kicker?: string;
  onBack?: () => void;
  footer?: ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
  closeLabel?: string;
}

export function MobileSheet({
  title,
  body,
  onClose,
  kicker,
  onBack,
  footer,
  bodyClassName,
  contentClassName,
  closeLabel = '关闭',
}: MobileSheetProps) {
  const contentClasses = ['mobile-sheet', contentClassName].filter(Boolean).join(' ');
  const bodyClasses = ['mobile-sheet__body', bodyClassName].filter(Boolean).join(' ');

  return (
    <div className="mobile-sheet-layer">
      <button
        type="button"
        className="mobile-sheet-layer__backdrop"
        aria-label="Dismiss current sheet"
        onClick={onClose}
      />
      <section className={contentClasses} aria-label={`${title} sheet`}>
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <div className="mobile-sheet__header-main">
            <div className="mobile-sheet__header-row">
              {onBack ? (
                <button
                  type="button"
                  className="mobile-sheet__back"
                  onClick={onBack}
                  aria-label="返回上一层"
                >
                  <ArrowLeft size={16} />
                  <span>返回</span>
                </button>
              ) : null}
              {kicker ? <div className="mobile-sheet__kicker">{kicker}</div> : null}
            </div>
            <h2 className="mobile-sheet__title">{title}</h2>
          </div>
          <button
            type="button"
            className="mobile-sheet__close"
            onClick={onClose}
            aria-label="Close current sheet"
          >
            {closeLabel}
          </button>
        </div>
        <div className={bodyClasses}>{body}</div>
        {footer ? <div className="mobile-sheet__footer">{footer}</div> : null}
      </section>
    </div>
  );
}
```

This preserves all current `MobileSheet` callers because `title`, `body`, and `onClose` remain unchanged.

- [ ] **Step 2: Branch `WorkspaceLaunchModal` between desktop overlay and mobile sheet**

Add the new imports:

```tsx
import { useViewport } from '../../../hooks/use-viewport';
import { MobileSheet } from '../../../shells/mobile-shell/mobile-sheet';
```

Inside `WorkspaceLaunchModal`, compute the viewport once:

```tsx
const isMobile = useViewport() === 'mobile';
const launchTitle = launchChoice === 'local' ? 'Local Folder' : 'Remote Git';
```

Extract the existing launch body into a reusable variable and move the error inline with it:

```tsx
const launchBody = (
  <div className="launch-body">
    <div className="launch-choice-row">
      <div className={`launch-choice ${launchChoice === 'local' ? 'active' : ''}`}>
        <div className="launch-choice-title">Local Folder</div>
        <div className="launch-choice-desc">Select a directory on your machine</div>
      </div>
      <div className="launch-choice disabled">
        <div className="launch-choice-title">Remote Git</div>
        <div className="launch-choice-desc">Clone a repository (Coming Soon)</div>
      </div>
    </div>

    <div className="folder-picker">
      <div className="fp-toolbar">
        <button className="fp-btn" onClick={() => loadDirectory('~')}>
          <Home size={12} />
          Home Directory
        </button>
        {parentPath ? (
          <button className="fp-btn" onClick={() => handleNavigate(parentPath)}>
            <ArrowUp size={12} />
            Go Up
          </button>
        ) : null}
      </div>

      <div className="fp-root-chips">
        {rootPaths.map((rp) => (
          <span
            key={rp}
            className={`fp-chip ${currentPath === rp ? 'active' : ''}`}
            onClick={() => loadDirectory(rp)}
          >
            {rp}
          </span>
        ))}
        {currentPath && !rootPaths.includes(currentPath) ? (
          <span className="fp-chip active">{getShortPath(currentPath)}</span>
        ) : null}
      </div>

      <div className="fp-dir-list">
        {browsing ? (
          <div className="directory-loading">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : directories.length === 0 ? (
          <div className="directory-empty">No directories found</div>
        ) : (
          directories.map((dir) => (
            <div
              key={dir.path}
              className={`fp-dir ${selectedPath === dir.path ? 'selected' : ''}`}
              onClick={() => handleSelect(dir.path)}
              onDoubleClick={() => handleNavigate(dir.path)}
            >
              <span className="fp-dir-icon">
                <Folder size={14} />
              </span>
              <span className={`fp-dir-name ${selectedPath === dir.path ? 'selected' : ''}`}>
                {dir.name}
              </span>
              {dir.itemCount !== undefined ? (
                <span className="fp-dir-hint">{dir.itemCount} items</span>
              ) : null}
              {selectedPath === dir.path ? (
                <button
                  className="fp-dir-action"
                  type="button"
                  aria-label={`Enter ${dir.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNavigate(dir.path);
                  }}
                >
                  Enter folder →
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>

    {error ? <div className="form-error mobile-launch-sheet__error">{error}</div> : null}
  </div>
);
```

Create a mobile footer with explicit cancel/open actions:

```tsx
const launchFooter = (
  <div className="mobile-launch-sheet__footer">
    <button className="btn btn-secondary" onClick={onClose}>
      取消
    </button>
    <button
      className="launch-start-btn"
      onClick={handleOpen}
      disabled={loading || !selectedPath}
    >
      {loading ? 'Starting...' : 'Start Workspace'}
    </button>
  </div>
);
```

Add the mobile early return before the current desktop `return`:

```tsx
if (isMobile) {
  return (
    <MobileSheet
      kicker="START WORKSPACE"
      title={launchTitle}
      body={launchBody}
      footer={launchFooter}
      bodyClassName="mobile-launch-sheet"
      contentClassName="mobile-sheet--launch"
      onClose={onClose}
    />
  );
}
```

Keep the existing desktop overlay markup for the non-mobile branch.

- [ ] **Step 3: Branch `WorktreeModal` between desktop overlay and mobile sheet**

Add the imports:

```tsx
import { useViewport } from '../../../hooks/use-viewport';
import { MobileSheet } from '../../../shells/mobile-shell/mobile-sheet';
```

Inside `WorktreeModal`, compute:

```tsx
const isMobile = useViewport() === 'mobile';
```

Extract a shared metadata block:

```tsx
const worktreeSummary = (
  <div className="worktree-header-info">
    <h3>{worktree.name}</h3>
    <div className="worktree-chips">
      <span className="worktree-chip worktree-chip-branch">🌿 {worktree.branch}</span>
      <span className="worktree-chip worktree-chip-path">📁 {worktree.path}</span>
      <span
        className={`worktree-chip worktree-chip-status ${
          worktree.status === 'clean' ? 'worktree-clean' : 'worktree-dirty'
        }`}
      >
        {worktree.status === 'clean' ? '✓ Clean' : '● Dirty'}
      </span>
    </div>
  </div>
);
```

Extract the shared tab strip:

```tsx
const worktreeTabs = (
  <div className="modal-tabs mobile-worktree-sheet__tabs">
    <button
      className={`modal-tab ${activeTab === 'status' ? 'active' : ''}`}
      onClick={() => handleTabChange('status')}
    >
      Status
    </button>
    <button
      className={`modal-tab ${activeTab === 'diff' ? 'active' : ''}`}
      onClick={() => handleTabChange('diff')}
    >
      Diff
    </button>
    <button
      className={`modal-tab ${activeTab === 'tree' ? 'active' : ''}`}
      onClick={() => handleTabChange('tree')}
    >
      Tree
    </button>
  </div>
);
```

Keep the existing current body content inside a `worktreeContent` variable:

```tsx
const worktreeContent = (
  <div className="modal-body worktree-content">
    {error ? <div className="worktree-error">{error}</div> : null}
    {loading ? (
      <div className="worktree-loading">Loading...</div>
    ) : (
      <>
        {activeTab === 'status' ? (
          <div className="worktree-status-tab">
            <div className="worktree-info-row">
              <span className="worktree-info-label">Path</span>
              <span className="worktree-info-value">{worktree.path}</span>
            </div>
            <div className="worktree-info-row">
              <span className="worktree-info-label">Branch</span>
              <span className="worktree-info-value">{worktree.branch}</span>
            </div>
            <div className="worktree-info-row">
              <span className="worktree-info-label">Status</span>
              <span className="worktree-info-value">{worktree.status}</span>
            </div>
            {status ? (
              <div className="worktree-changes">
                <h4>Changes</h4>
                {status.staged.length > 0 ? (
                  <div className="worktree-change-group">
                    <span>Staged: {status.staged.length}</span>
                  </div>
                ) : null}
                {status.modified.length > 0 ? (
                  <div className="worktree-change-group">
                    <span>Modified: {status.modified.length}</span>
                  </div>
                ) : null}
                {status.untracked.length > 0 ? (
                  <div className="worktree-change-group">
                    <span>Untracked: {status.untracked.length}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'diff' ? (
          <div className="worktree-diff-tab">
            {diff ? (
              <pre className="worktree-diff-output">{diff}</pre>
            ) : (
              <div className="worktree-empty">No changes</div>
            )}
          </div>
        ) : null}

        {activeTab === 'tree' ? (
          <div className="worktree-tree-tab">
            {tree.length > 0 ? (
              <div className="worktree-tree">
                {tree.map((node) => (
                  <div key={node.path} className="worktree-tree-node">
                    <span className="worktree-tree-icon">
                      {node.kind === 'dir' ? '📁' : '📄'}
                    </span>
                    <span className="worktree-tree-name">{node.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="worktree-empty">Empty tree</div>
            )}
          </div>
        ) : null}
      </>
    )}
  </div>
);
```

Add the mobile branch before the desktop return:

```tsx
if (isMobile) {
  return (
    <MobileSheet
      kicker="WORKTREE"
      title={worktree.name}
      body={
        <div className="mobile-worktree-sheet">
          <div className="mobile-worktree-sheet__summary">{worktreeSummary}</div>
          {worktreeTabs}
          <div className="mobile-worktree-sheet__content">{worktreeContent}</div>
        </div>
      }
      bodyClassName="mobile-sheet__body--flush"
      contentClassName="mobile-sheet--worktree"
      onClose={onClose}
    />
  );
}
```

Keep the current desktop overlay branch unchanged except for reusing `worktreeSummary`, `worktreeTabs`, and `worktreeContent`.

- [ ] **Step 4: Add mobile scaffold and feature-specific CSS**

Append these rules inside the existing mobile breakpoint block in `packages/web/src/styles/components.css`:

```css
.mobile-sheet {
  gap: 0;
  min-height: min(78dvh, 640px);
  max-height: calc(100dvh - var(--sp-4));
}

.mobile-sheet__header {
  flex-shrink: 0;
  padding-bottom: var(--sp-4);
}

.mobile-sheet__header-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: var(--sp-1);
}

.mobile-sheet__header-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.mobile-sheet__back {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: var(--touch-target-min);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
}

.mobile-sheet__body {
  min-height: 0;
}

.mobile-sheet__body--flush {
  padding: 0;
}

.mobile-sheet__footer {
  flex-shrink: 0;
  padding-top: var(--sp-3);
  border-top: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
}

.mobile-launch-sheet {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: var(--sp-4);
}

.mobile-launch-sheet .launch-choice-row {
  grid-template-columns: 1fr;
}

.mobile-launch-sheet .folder-picker,
.mobile-launch-sheet .fp-dir-list {
  min-height: 0;
}

.mobile-launch-sheet__footer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2);
}

.mobile-worktree-sheet {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.mobile-worktree-sheet__summary {
  padding: 0 0 var(--sp-3);
}

.mobile-worktree-sheet__tabs {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-surface);
}

.mobile-worktree-sheet__content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mobile-worktree-sheet__content .modal-body {
  flex: 1;
  min-height: 0;
}
```

These rules are enough for this phase because launch/worktree content already has established desktop structure; `4B1` only needs mobile container behavior, not content-model changes.

- [ ] **Step 5: Run focused tests and lint, then commit the workspace/worktree implementation**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx
```

Expected: both files pass, including the new mobile assertions.

Run:

```bash
pnpm exec biome lint \
  packages/web/src/shells/mobile-shell/mobile-sheet.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx \
  packages/web/src/styles/components.css
```

Expected: no lint errors.

Commit:

```bash
git add \
  packages/web/src/shells/mobile-shell/mobile-sheet.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx \
  packages/web/src/styles/components.css
git commit -m "feat: adapt workspace and worktree mobile surfaces"
```

Expected: commit succeeds with the shared sheet scaffold enhancements plus workspace/worktree mobile branching.

---

## Task 3: Write Failing Tests for Mobile Supervisor Objective Flow

**Files:**
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Create: `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 1: Add a shared viewport mock to `objective-dialog.test.tsx` and cover desktop/mobile behavior**

Insert this hoisted mock at the top of `objective-dialog.test.tsx`:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Update the imports to include `afterEach`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
```

Reset the viewport after each test:

```tsx
afterEach(() => {
  viewportMocks.viewport = 'desktop';
});
```

Append these tests:

```tsx
it('keeps the centered modal shell on desktop viewports', () => {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: vi.fn() } as any);
  store.set(supervisorDialogAtom, {
    open: true,
    sessionId: 'sess-1',
    mode: 'enable',
    draftObjective: 'Ship phase 4B1',
    draftEvaluatorProviderId: 'claude',
  });
  store.set(supervisorsAtom, new Map());

  render(
    <Provider store={store}>
      <ObjectiveDialog workspaceId="ws-1" />
    </Provider>
  );

  expect(document.querySelector('.modal-overlay')).toBeTruthy();
});

it('renders nothing on mobile because mobile supervisor detail owns the flow', () => {
  viewportMocks.viewport = 'mobile';
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: vi.fn() } as any);
  store.set(supervisorDialogAtom, {
    open: true,
    sessionId: 'sess-1',
    mode: 'enable',
    draftObjective: 'Ship phase 4B1',
    draftEvaluatorProviderId: 'claude',
  });
  store.set(supervisorsAtom, new Map());

  const { container } = render(
    <Provider store={store}>
      <ObjectiveDialog workspaceId="ws-1" sessionId="sess-1" />
    </Provider>
  );

  expect(container).toBeEmptyDOMElement();
  expect(document.querySelector('.modal-overlay')).toBeNull();
});
```

The mobile assertion should fail because `ObjectiveDialog` still renders the desktop overlay on every viewport.

- [ ] **Step 2: Create `mobile-supervisor-sheet.test.tsx` with failing root/detail tests**

Create `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { wsClientAtom } from '../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../../features/supervisor/atoms';
import { MobileSupervisorSheet } from './mobile-supervisor-sheet';

describe('MobileSupervisorSheet', () => {
  it('opens the enable flow inside the same sheet without rendering a second overlay', async () => {
    const sendCommand = vi.fn().mockResolvedValue({ id: 'sup-1' });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(supervisorsAtom, new Map());

    render(
      <Provider store={store}>
        <MobileSupervisorSheet
          sessionId="sess-1"
          workspaceId="ws-1"
          onClose={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByText('Supervisor 未启用')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '启用目标' }));

    expect(screen.getByLabelText('目标描述')).toBeInTheDocument();
    expect(document.querySelectorAll('.mobile-sheet-layer')).toHaveLength(1);
    expect(document.querySelector('.modal-overlay')).toBeNull();

    fireEvent.change(screen.getByLabelText('目标描述'), {
      target: { value: 'Reduce mobile regression bugs' },
    });
    fireEvent.click(screen.getByRole('button', { name: '启用' }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith('supervisor.create', {
        sessionId: 'sess-1',
        workspaceId: 'ws-1',
        objective: 'Reduce mobile regression bugs',
        evaluatorProviderId: 'claude',
      });
    });
  });

  it('returns from detail view to the supervisor root when tapping back', () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(supervisorsAtom, new Map());
    store.set(supervisorDialogAtom, {
      open: false,
      sessionId: null,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });

    render(
      <Provider store={store}>
        <MobileSupervisorSheet
          sessionId="sess-1"
          workspaceId="ws-1"
          onClose={vi.fn()}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: '启用目标' }));
    fireEvent.click(screen.getByRole('button', { name: '返回上一层' }));

    expect(screen.getByText('Supervisor 未启用')).toBeInTheDocument();
    expect(screen.queryByLabelText('目标描述')).not.toBeInTheDocument();
  });
});
```

These tests should fail because the current `MobileSupervisorSheet` does not own a `MobileSheet`, has no root/detail navigation, and still renders `ObjectiveDialog`.

- [ ] **Step 3: Run the focused supervisor tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx
```

Expected:
- the mobile `ObjectiveDialog` null-render test fails because the desktop modal still appears
- `mobile-supervisor-sheet.test.tsx` fails because the component has no `onClose` prop, no `启用目标` button, and no `返回上一层` action

- [ ] **Step 4: Commit the failing supervisor tests**

```bash
git add \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx
git commit -m "test: cover mobile supervisor objective flow"
```

Expected: commit succeeds with only failing-test coverage.

---

## Task 4: Implement Shared Objective State and Mobile Supervisor Root/Detail Flow

**Files:**
- Create: `packages/web/src/features/supervisor/components/objective-dialog-content.tsx`
- Create: `packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.tsx`
- Modify: `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Extract the shared objective-dialog state/actions into a hook**

Create `packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts`:

```tsx
import { useAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { supervisorDialogAtom, supervisorsAtom } from '../atoms';

interface UseObjectiveDialogStateOptions {
  workspaceId: string;
  sessionId?: string;
}

export function useObjectiveDialogState({
  workspaceId,
  sessionId,
}: UseObjectiveDialogStateOptions) {
  const [dialog, setDialog] = useAtom(supervisorDialogAtom);
  const supervisors = useAtomValue(supervisorsAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const scopedToSession = !sessionId || dialog.sessionId === sessionId;
  const isOpen = dialog.open && scopedToSession;
  const supervisor = dialog.sessionId ? supervisors.get(dialog.sessionId) : undefined;

  const close = useCallback(() => {
    setDialog({
      open: false,
      sessionId: null,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
  }, [setDialog]);

  const updateDraft = useCallback(
    (
      patch: Partial<{
        draftObjective: string;
        draftEvaluatorProviderId: 'claude' | 'codex';
      }>
    ) => {
      setDialog((current) => ({ ...current, ...patch }));
    },
    [setDialog]
  );

  const confirm = useCallback(async () => {
    if (!dialog.sessionId) {
      return;
    }

    if (dialog.mode === 'disable') {
      if (!supervisor) {
        return;
      }

      const result = await dispatch('supervisor.delete', { id: supervisor.id });
      if (result.ok) {
        close();
      }
      return;
    }

    const objective = dialog.draftObjective.trim();
    if (!objective) {
      return;
    }

    if (dialog.mode === 'enable') {
      const result = await dispatch('supervisor.create', {
        sessionId: dialog.sessionId,
        workspaceId,
        objective,
        evaluatorProviderId: dialog.draftEvaluatorProviderId,
      });

      if (result.ok) {
        close();
      }
      return;
    }

    if (!supervisor) {
      return;
    }

    const result = await dispatch('supervisor.update', {
      id: supervisor.id,
      objective,
      evaluatorProviderId: dialog.draftEvaluatorProviderId,
    });

    if (result.ok) {
      close();
    }
  }, [close, dialog, dispatch, supervisor, workspaceId]);

  return {
    dialog,
    supervisor,
    isOpen,
    close,
    updateDraft,
    confirm,
  };
}
```

This keeps business logic in one place and leaves `supervisorDialogAtom` unchanged.

- [ ] **Step 2: Extract shared objective content primitives for desktop and mobile**

Create `packages/web/src/features/supervisor/components/objective-dialog-content.tsx`:

```tsx
import { AlertTriangle, Eye, Pencil, PowerOff } from 'lucide-react';

export type ObjectiveDialogMode = 'enable' | 'edit' | 'disable';

export const EVALUATOR_OPTIONS = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
] as const;

export const OBJECTIVE_DIALOG_COPY: Record<
  ObjectiveDialogMode,
  { title: string; subtitle: string; confirm: string }
> = {
  enable: {
    title: '启用 Supervisor',
    subtitle: '描述一个目标,Supervisor 会在每轮结束后自动评估并提示下一步',
    confirm: '启用',
  },
  edit: {
    title: '编辑 Supervisor',
    subtitle: '调整目标描述或切换评估方,历史评估不会被清除',
    confirm: '保存',
  },
  disable: {
    title: '禁用 Supervisor',
    subtitle: '停止自动评估。当前会话的监督周期将被移除',
    confirm: '禁用',
  },
};

export function ModeIcon({ mode }: { mode: ObjectiveDialogMode }) {
  if (mode === 'enable') return <Eye size={14} />;
  if (mode === 'edit') return <Pencil size={14} />;
  return <PowerOff size={14} />;
}

interface ObjectiveDialogBodyProps {
  mode: ObjectiveDialogMode;
  draftObjective: string;
  draftEvaluatorProviderId: 'claude' | 'codex';
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderIdChange: (value: 'claude' | 'codex') => void;
}

export function ObjectiveDialogBody({
  mode,
  draftObjective,
  draftEvaluatorProviderId,
  disableObjective,
  onDraftObjectiveChange,
  onDraftEvaluatorProviderIdChange,
}: ObjectiveDialogBodyProps) {
  if (mode === 'disable') {
    return (
      <>
        <div className="supervisor-danger-callout" role="alert">
          <AlertTriangle
            size={16}
            className="supervisor-danger-callout-icon"
            aria-hidden="true"
          />
          <div className="supervisor-danger-callout-copy">
            <strong>禁用后会停止评估周期</strong>
            <small>
              当前会话的 supervisor 将被移除,历史 cycles 会一并清理。可重新启用,但无法恢复记录。
            </small>
          </div>
        </div>
        <div className="form-group">
          <label>当前目标</label>
          <pre className="objective-preview">{disableObjective}</pre>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="objective">目标描述</label>
        <textarea
          id="objective"
          className="input textarea"
          rows={5}
          value={draftObjective}
          onChange={(event) => onDraftObjectiveChange(event.target.value)}
          placeholder={
            '描述希望 Supervisor 盯住的目标,例如:\n' +
            '· 完成用户认证功能的实现\n' +
            '· 修复所有失败的单元测试\n' +
            '· 把 P95 响应时间压到 100ms 以内'
          }
          autoFocus
        />
        <span className="dialog-helper">
          越具体、越可衡量,评估效果越好。建议包含完成条件。
        </span>
      </div>

      <div className="form-group">
        <label htmlFor="evaluator-provider">评估方 (Evaluator)</label>
        <select
          id="evaluator-provider"
          className="input"
          value={draftEvaluatorProviderId}
          onChange={(event) =>
            onDraftEvaluatorProviderIdChange(event.target.value as 'claude' | 'codex')
          }
        >
          {EVALUATOR_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="dialog-helper">
          用于评估进度并生成下一步指引的 provider,与执行方可不相同。
        </span>
      </div>
    </>
  );
}

interface ObjectiveDialogActionsProps {
  mode: ObjectiveDialogMode;
  confirmDisabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ObjectiveDialogActions({
  mode,
  confirmDisabled,
  onCancel,
  onConfirm,
}: ObjectiveDialogActionsProps) {
  return (
    <div className="objective-dialog-actions">
      <button className="btn btn-secondary" onClick={onCancel}>
        取消
      </button>
      <button
        className={`btn ${mode === 'disable' ? 'btn-danger' : 'btn-primary'}`}
        onClick={onConfirm}
        disabled={confirmDisabled}
      >
        {OBJECTIVE_DIALOG_COPY[mode].confirm}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Refactor `ObjectiveDialog` so desktop keeps the modal and mobile renders nothing**

Update `packages/web/src/features/supervisor/components/objective-dialog.tsx`:

```tsx
import { useViewport } from '../../../hooks/use-viewport';
import {
  ModeIcon,
  ObjectiveDialogActions,
  ObjectiveDialogBody,
  OBJECTIVE_DIALOG_COPY,
} from './objective-dialog-content';
import { useObjectiveDialogState } from '../hooks/use-objective-dialog-state';
```

Replace the component body with:

```tsx
export function ObjectiveDialog({ workspaceId, sessionId }: ObjectiveDialogProps) {
  const viewport = useViewport();
  const { dialog, supervisor, isOpen, close, updateDraft, confirm } =
    useObjectiveDialogState({
      workspaceId,
      sessionId,
    });

  if (!isOpen) {
    return null;
  }

  if (viewport === 'mobile') {
    return null;
  }

  const mode = dialog.mode;
  const copy = OBJECTIVE_DIALOG_COPY[mode];
  const disableObjective = supervisor?.objective ?? dialog.draftObjective;
  const isDisable = mode === 'disable';

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-card supervisor-dialog"
        data-mode={mode}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div className="supervisor-dialog-header">
            <span className="supervisor-dialog-header-icon" aria-hidden="true">
              <ModeIcon mode={mode} />
            </span>
            <div>
              <h3>{copy.title}</h3>
              <span className="supervisor-dialog-subtitle">{copy.subtitle}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={close} aria-label="关闭">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <ObjectiveDialogBody
            mode={mode}
            draftObjective={dialog.draftObjective}
            draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
            disableObjective={disableObjective}
            onDraftObjectiveChange={(value) => updateDraft({ draftObjective: value })}
            onDraftEvaluatorProviderIdChange={(value) =>
              updateDraft({ draftEvaluatorProviderId: value })
            }
          />
        </div>

        <div className="modal-footer">
          <ObjectiveDialogActions
            mode={mode}
            confirmDisabled={!isDisable && !dialog.draftObjective.trim()}
            onCancel={close}
            onConfirm={() => {
              void confirm();
            }}
          />
        </div>
      </div>
    </div>
  );
}
```

This keeps the current centered desktop contract while making mobile objective editing the responsibility of `MobileSupervisorSheet`.

- [ ] **Step 4: Move mobile supervisor objective editing into a root/detail `MobileSheet`**

Update `packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx` to own the mobile sheet:

```tsx
import { useAtomValue, useSetAtom } from 'jotai';
import { supervisorDialogAtom, supervisorsAtom } from '../../features/supervisor/atoms';
import { MobileSheet } from './mobile-sheet';
import { SupervisorCard } from '../../features/supervisor/components/supervisor-card';
import {
  ObjectiveDialogActions,
  ObjectiveDialogBody,
  OBJECTIVE_DIALOG_COPY,
} from '../../features/supervisor/components/objective-dialog-content';
import { useObjectiveDialogState } from '../../features/supervisor/hooks/use-objective-dialog-state';

interface MobileSupervisorSheetProps {
  sessionId: string;
  workspaceId: string;
  onClose: () => void;
}

export function MobileSupervisorSheet({
  sessionId,
  workspaceId,
  onClose,
}: MobileSupervisorSheetProps) {
  const supervisors = useAtomValue(supervisorsAtom);
  const setDialog = useSetAtom(supervisorDialogAtom);
  const {
    dialog,
    supervisor,
    isOpen,
    close,
    updateDraft,
    confirm,
  } = useObjectiveDialogState({
    workspaceId,
    sessionId,
  });

  const openEnable = () => {
    setDialog({
      open: true,
      sessionId,
      mode: 'enable',
      draftObjective: '',
      draftEvaluatorProviderId: 'claude',
    });
  };

  const handleSheetClose = () => {
    if (isOpen) {
      close();
    }
    onClose();
  };

  if (isOpen) {
    const mode = dialog.mode;
    const copy = OBJECTIVE_DIALOG_COPY[mode];
    const disableObjective = supervisor?.objective ?? dialog.draftObjective;
    const isDisable = mode === 'disable';

    return (
      <MobileSheet
        kicker="SUPERVISOR"
        title={copy.title}
        onBack={close}
        onClose={handleSheetClose}
        body={
          <div className="mobile-supervisor-sheet mobile-supervisor-sheet--detail">
            <ObjectiveDialogBody
              mode={mode}
              draftObjective={dialog.draftObjective}
              draftEvaluatorProviderId={dialog.draftEvaluatorProviderId}
              disableObjective={disableObjective}
              onDraftObjectiveChange={(value) => updateDraft({ draftObjective: value })}
              onDraftEvaluatorProviderIdChange={(value) =>
                updateDraft({ draftEvaluatorProviderId: value })
              }
            />
          </div>
        }
        footer={
          <ObjectiveDialogActions
            mode={mode}
            confirmDisabled={!isDisable && !dialog.draftObjective.trim()}
            onCancel={close}
            onConfirm={() => {
              void confirm();
            }}
          />
        }
      />
    );
  }

  return (
    <MobileSheet
      title="Supervisor"
      onClose={onClose}
      body={
        <div className="mobile-supervisor-sheet">
          {supervisor ? (
            <SupervisorCard sessionId={sessionId} workspaceId={workspaceId} />
          ) : (
            <div className="mobile-supervisor-sheet__empty">
              <h3>Supervisor</h3>
              <p>Supervisor 未启用</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={openEnable}
              >
                启用目标
              </button>
            </div>
          )}
        </div>
      }
    />
  );
}
```

This preserves the one-sheet rule because the supervisor detail view is just a different body/footer inside the same `MobileSheet`.

- [ ] **Step 5: Update `mobile-shell/index.tsx` so supervisor no longer uses the generic `sheetBody` branch**

In `packages/web/src/shells/mobile-shell/index.tsx`, remove the `sheet === 'supervisor'` branch from `sheetBody` and render the supervisor surface separately:

```tsx
const sheetBody =
  sheet === 'files'
    ? {
        title:
          filesRoute.kind === 'editor'
            ? filesRoute.path.split('/').pop() ?? 'Editor'
            : filesRoute.kind === 'diff'
              ? filesRoute.path.split('/').pop() ?? 'Diff'
              : 'Files',
        body: activeWorkspaceId ? (
          <MobileFilesSheet workspaceId={activeWorkspaceId} onRouteChange={setFilesRoute} />
        ) : null,
      }
    : sheet === 'terminal'
      ? {
          title: 'Terminal',
          body: (
            <div className="mobile-terminal-sheet">
              <TerminalPanel />
            </div>
          ),
        }
      : null;
```

Then replace the current `sheetBody ? <MobileSheet ... /> : null` block with:

```tsx
{sheet === 'supervisor' && activeSession ? (
  <MobileSupervisorSheet
    sessionId={activeSession.id}
    workspaceId={activeSession.workspaceId}
    onClose={() => setSheet(null)}
  />
) : sheetBody ? (
  <MobileSheet
    title={sheetBody.title}
    body={sheetBody.body}
    onClose={() => {
      setSheet(null);
      setFilesRoute({ kind: 'root' });
    }}
  />
) : null}
```

This keeps files and terminal unchanged while giving the supervisor flow full control over back/detail/footer behavior.

- [ ] **Step 6: Add shared objective action styles and mobile supervisor detail polish**

Append these rules in `packages/web/src/styles/components.css`:

```css
.objective-dialog-actions {
  display: flex;
  width: 100%;
  gap: var(--sp-2);
}

.objective-dialog-actions > .btn {
  flex: 1;
}
```

Inside the existing mobile breakpoint block, add:

```css
.mobile-sheet__footer .objective-dialog-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mobile-supervisor-sheet--detail {
  gap: var(--sp-4);
}

.mobile-supervisor-sheet__empty .btn {
  align-self: flex-start;
}
```

These rules keep the same confirm/cancel markup across desktop and mobile while making the mobile footer sticky and full-width.

- [ ] **Step 7: Run focused tests and lint, then commit the supervisor implementation**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx
```

Expected: all focused files pass, including the new mobile supervisor navigation assertions.

Run:

```bash
pnpm exec biome lint \
  packages/web/src/features/supervisor/components/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts \
  packages/web/src/features/supervisor/components/objective-dialog.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/styles/components.css
```

Expected: no lint errors.

Commit:

```bash
git add \
  packages/web/src/features/supervisor/components/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts \
  packages/web/src/features/supervisor/components/objective-dialog.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/styles/components.css
git commit -m "feat: move mobile supervisor objective flow into sheet detail"
```

Expected: commit succeeds with the mobile supervisor root/detail implementation.

---

## Task 5: Final Verification for Phase 4B1

**Files:**
- Verify only: all files touched in Tasks 1-4

- [ ] **Step 1: Run lint across every touched file**

Run:

```bash
pnpm exec biome lint \
  packages/web/src/shells/mobile-shell/mobile-sheet.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.tsx \
  packages/web/src/shells/mobile-shell/mobile-supervisor-sheet.test.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.tsx \
  packages/web/src/features/workspace/components/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/components/worktree-modal.tsx \
  packages/web/src/features/workspace/components/worktree-modal.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/hooks/use-objective-dialog-state.ts \
  packages/web/src/features/supervisor/components/objective-dialog.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx \
  packages/web/src/styles/components.css
```

Expected: no lint errors.

- [ ] **Step 2: Run the full web test suite**

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected:
- all existing web tests pass
- the new `worktree-modal` and `mobile-supervisor-sheet` tests are included
- desktop regressions stay green because desktop overlay markup is still covered

- [ ] **Step 3: Inspect the final diff and confirm the phase boundary stayed tight**

Run:

```bash
git status --short
git diff --stat HEAD~4..HEAD
```

Expected:
- only the `4B1` surface files listed in this plan changed
- no `CommandPalette`, toast, or config-drift files were modified
- `node_modules` and `packages/web/node_modules` remain untracked and unstaged

- [ ] **Step 4: Only create an extra commit if verification required a final fix**

If the verification steps above expose a real issue that requires code changes, fix it in the already-touched files, rerun the relevant command, and commit:

```bash
git add <exact files fixed after verification>
git commit -m "fix: polish mobile phase 4b1 surfaces"
```

If verification is clean and the implementation commits from Tasks 2 and 4 already describe the final state, do not create an extra commit.

---

## Self-Review Checklist

- `WorkspaceLaunchModal` and `WorktreeModal` each have explicit mobile render assertions plus behavior regression coverage
- `MobileSheet` gains only the hooks needed by this phase: kicker, back, footer, and class overrides
- Mobile supervisor objective editing never renders a second `.modal-overlay`
- `ObjectiveDialog` keeps the centered desktop modal contract and only defers mobile rendering
- `MobileSupervisorSheet` owns root/detail navigation without introducing new routes or new top-level overlays
- `CommandPalette`, toast repositioning, and config-drift compaction remain out of scope for `4B1`
