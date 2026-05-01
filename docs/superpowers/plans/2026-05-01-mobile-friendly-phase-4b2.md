# Mobile-Friendly Phase 4B2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt `CommandPalette` into a mobile-friendly sheet while preserving its command registry, search semantics, keyboard behavior, launcher handoff, and desktop overlay path.

**Architecture:** Keep `CommandPalette` as the single owner of command-building, filtering, and open/close behavior. Add a viewport branch inside the feature so desktop continues to render the current overlay markup while mobile renders the same command content inside `MobileSheet`, with explicit one-sheet handoff when opening `WorkspaceLaunchModal`.

**Tech Stack:** React 19, jotai, react-router-dom, lucide-react, vitest + Testing Library, shared `useViewport` hook, shared `MobileSheet`, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-4b2-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md`

---

## File Structure

**Modified files:**
- `packages/web/src/features/command-palette/components/command-palette.tsx` — add viewport-based desktop/mobile branching, shared command body extraction, and mobile-safe launcher handoff
- `packages/web/src/features/command-palette/components/command-palette.test.tsx` — add mobile viewport coverage and desktop keyboard regression coverage
- `packages/web/src/styles/components.css` — add mobile command palette sheet layout rules while preserving desktop overlay styles

**No changes in 4B2:**
- `packages/web/src/shells/mobile-shell/index.tsx`
- `packages/web/src/shells/desktop-shell.tsx`
- `packages/web/src/features/workspace/components/workspace-launch-modal.tsx`
- command registry shape, command atom contracts, or route structure

---

## Task 1: Write Failing Tests for Mobile Command Palette and Desktop Keyboard Regression

**Files:**
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`

- [ ] **Step 1: Add a shared viewport mock and a launch-modal mock to `command-palette.test.tsx`**

Insert this hoisted viewport mock above the router mock:

```tsx
const viewportMocks = vi.hoisted(() => ({
  viewport: 'desktop' as 'desktop' | 'mobile',
}));

vi.mock('../../../hooks/use-viewport', () => ({
  useViewport: () => viewportMocks.viewport,
}));
```

Replace the current `WorkspaceLaunchModal` mock with a visible test double:

```tsx
vi.mock('../../workspace/components/workspace-launch-modal', () => ({
  WorkspaceLaunchModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="workspace-launch-modal-mock">
      <button type="button" onClick={onClose}>
        close-launch-modal
      </button>
    </div>
  ),
}));
```

Update `beforeEach` so the viewport resets:

```tsx
beforeEach(() => {
  viewportMocks.viewport = 'desktop';
  routerMocks.navigate.mockReset();
  routerMocks.location.pathname = '/settings';
});
```

- [ ] **Step 2: Add a failing mobile rendering and filter test**

Append this test below the existing workspace-switch assertion:

```tsx
it('renders inside MobileSheet on mobile and still filters commands', () => {
  viewportMocks.viewport = 'mobile';

  const store = createStore();
  store.set(localeAtom, 'en');
  store.set(commandPaletteOpenAtom, true);
  store.set(workspacesAtom, {
    'ws-1': createWorkspace('ws-1', '/tmp/one'),
  });
  store.set(workspaceOrderAtom, ['ws-1']);
  store.set(workspacesLoadStateAtom, 'ready');

  render(
    <Provider store={store}>
      <CommandPalette />
    </Provider>
  );

  expect(document.querySelector('.mobile-sheet')).toBeTruthy();
  expect(document.querySelector('.command-palette-overlay')).toBeNull();

  fireEvent.change(screen.getByPlaceholderText('Type a command or search...'), {
    target: { value: 'settings' },
  });

  expect(screen.getByText('Settings')).toBeInTheDocument();
  expect(screen.queryByText('Workspace: one')).toBeNull();
});
```

This should fail because `CommandPalette` does not currently import `useViewport` or `MobileSheet`.

- [ ] **Step 3: Add a failing mobile launcher handoff test**

Append this test:

```tsx
it('closes the mobile palette before opening the workspace launcher', () => {
  viewportMocks.viewport = 'mobile';

  const store = createStore();
  store.set(localeAtom, 'en');
  store.set(commandPaletteOpenAtom, true);
  store.set(workspacesAtom, {});
  store.set(workspaceOrderAtom, []);
  store.set(workspacesLoadStateAtom, 'ready');

  render(
    <Provider store={store}>
      <CommandPalette />
    </Provider>
  );

  fireEvent.click(screen.getByText('Open Workspace'));

  expect(screen.getByTestId('workspace-launch-modal-mock')).toBeInTheDocument();
  expect(document.querySelector('.command-palette-overlay')).toBeNull();
  expect(document.querySelector('.mobile-sheet')).toBeNull();
  expect(store.get(commandPaletteOpenAtom)).toBe(false);
});
```

This should fail because the current implementation leaves the palette open state unchanged when switching to the launcher branch.

- [ ] **Step 4: Add a desktop keyboard regression test**

Append this test:

```tsx
it('executes the selected command with Enter on desktop', () => {
  const store = createStore();
  store.set(localeAtom, 'en');
  store.set(commandPaletteOpenAtom, true);
  store.set(workspacesAtom, {
    'ws-1': createWorkspace('ws-1', '/tmp/one'),
  });
  store.set(workspaceOrderAtom, ['ws-1']);
  store.set(workspacesLoadStateAtom, 'ready');

  render(
    <Provider store={store}>
      <CommandPalette />
    </Provider>
  );

  const palette = document.querySelector('.command-palette');
  expect(palette).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText('Type a command or search...'), {
    target: { value: 'settings' },
  });

  fireEvent.keyDown(palette!, { key: 'Enter' });

  expect(routerMocks.navigate).toHaveBeenCalledWith('/settings');
  expect(store.get(commandPaletteOpenAtom)).toBe(false);
});
```

This assertion protects the existing desktop keyboard path while the mobile branch is added. The overall focused run should still be red because of the new mobile tests.

- [ ] **Step 5: Run the focused test to verify red**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand packages/web/src/features/command-palette/components/command-palette.test.tsx
```

Expected:

- the new mobile assertions fail because there is no `MobileSheet` render path yet
- the launcher handoff test fails because the palette remains open under the launcher branch

- [ ] **Step 6: Commit the failing tests**

```bash
git add packages/web/src/features/command-palette/components/command-palette.test.tsx
git commit -m "test: cover mobile command palette sheet flow"
```

---

## Task 2: Implement Mobile Command Palette Sheet Adaptation

**Files:**
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`

- [ ] **Step 1: Import the shared mobile dependencies**

Update the imports to add:

```tsx
import { useViewport } from '../../../hooks/use-viewport';
import { MobileSheet } from '../../../shells/mobile-shell/mobile-sheet';
```

Keep the existing imports otherwise unchanged.

- [ ] **Step 2: Add viewport detection and explicit launcher-open helper**

Inside `CommandPalette`, after `navigate`, add:

```tsx
const isMobile = useViewport() === 'mobile';
```

Replace the current launcher setter passed into `buildCommands` with:

```tsx
setShowWorkspaceLaunch: (nextValue) => {
  if (nextValue) {
    setIsOpen(false);
  }
  setShowWorkspaceLaunch(nextValue);
},
```

This is the key one-sheet handoff: the palette closes before the launcher branch is rendered.

- [ ] **Step 3: Extract shared search input and result list fragments**

Replace the inline search/list markup with shared `paletteSearchField` and `paletteList` constants:

```tsx
const paletteSearchField = (
  <div className="command-palette-search">
    <Search size={16} className="command-palette-search-icon" />
    <input
      ref={inputRef}
      type="text"
      className="command-palette-input"
      placeholder={t('placeholder.command')}
      value={searchQuery}
      onChange={(e) => {
        setSearchQuery(e.target.value);
        setSelectedIndex(0);
      }}
    />
  </div>
);

const paletteList = (
  <div className="command-palette-list">
    {filteredCommands.length > 0 ? (
      filteredCommands.map((cmd, index) => (
        <div
          key={cmd.id}
          className={`command-palette-item ${
            index === selectedIndex ? 'command-palette-item-selected' : ''
          }`}
          onClick={() => handleCommandClick(cmd)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div className="command-palette-item-content">
            <span className="command-palette-item-label">{cmd.label}</span>
            <span className="command-palette-item-desc">{cmd.description}</span>
          </div>
          {cmd.shortcut ? (
            <span className="command-palette-item-shortcut">{cmd.shortcut}</span>
          ) : null}
        </div>
      ))
    ) : (
      <div className="command-palette-empty">{t('command.no_results')}</div>
    )}
  </div>
);
```

This keeps search and result rendering shared while letting desktop and mobile keep different header/meta structures.

- [ ] **Step 4: Branch between desktop overlay and mobile `MobileSheet`**

Replace the current unconditional overlay return with:

```tsx
if (isMobile) {
  return (
    <MobileSheet
      title="Quick Actions"
      kicker={t('command.palette').toUpperCase()}
      onClose={() => setIsOpen(false)}
      bodyClassName="mobile-sheet__body--flush"
      contentClassName="command-palette-sheet-layer"
      body={
        <div className="command-palette-sheet-shell" onKeyDown={handleKeyDown}>
          <div className="command-palette-sheet">
            <div className="command-palette-sheet__search">
              {paletteSearchField}
              <div className="command-palette-sheet__meta">
                <span className="command-palette-hint">{t('placeholder.command')}</span>
                <span className="command-palette-meta">{filteredCommands.length} actions</span>
              </div>
            </div>
            {paletteList}
          </div>
        </div>
      }
    />
  );
}

return (
  <div className="command-palette-overlay" onClick={() => setIsOpen(false)}>
    <div
      className="command-palette"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div className="command-palette-header">
        <span className="command-palette-kicker">{t('command.palette').toUpperCase()}</span>
        <span className="command-palette-meta">{filteredCommands.length} actions</span>
      </div>
      {paletteSearchField}
      <div className="command-palette-hint">{t('placeholder.command')}</div>
      {paletteList}
    </div>
  </div>
);
```

The desktop path keeps the overlay wrapper, header, and existing hint placement. The mobile path reuses `MobileSheet` and the shared search/list fragments.

- [ ] **Step 5: Run the focused test to verify green**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand packages/web/src/features/command-palette/components/command-palette.test.tsx
```

Expected:

- all `CommandPalette` tests pass

- [ ] **Step 6: Commit the feature implementation**

```bash
git add packages/web/src/features/command-palette/components/command-palette.tsx
git commit -m "feat: adapt command palette for mobile sheets"
```

---

## Task 3: Add Mobile Command Palette Styles

**Files:**
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Preserve desktop palette styles and add mobile sheet-specific classes**

Append these rules near the existing command palette block:

```css
.command-palette-sheet {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.command-palette-sheet__search {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-surface);
}

.command-palette-sheet__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border);
}

.command-palette-sheet-shell {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  outline: none;
}

.command-palette-sheet-layer {
  min-height: min(82dvh, 700px);
}
```

- [ ] **Step 2: Add mobile breakpoint refinements for narrow item layout**

Inside the existing mobile breakpoint section, append:

```css
  .command-palette-sheet-layer {
    gap: 0;
  }

  .command-palette-sheet__meta {
    padding-inline: var(--sp-4);
  }

  .command-palette-list {
    flex: 1;
    max-height: none;
  }

  .command-palette-item {
    align-items: flex-start;
    gap: var(--sp-3);
  }

  .command-palette-item-content {
    flex: 1;
    min-width: 0;
  }

  .command-palette-item-shortcut {
    flex-shrink: 0;
    margin-top: 2px;
  }
```

This keeps the desktop overlay untouched while improving narrow-screen readability.

- [ ] **Step 3: Run the focused test suite again**

Run:

```bash
pnpm --filter @coder-studio/web test -- --runInBand packages/web/src/features/command-palette/components/command-palette.test.tsx
```

Expected:

- all `CommandPalette` tests still pass after the style-only changes

- [ ] **Step 4: Commit the styling pass**

```bash
git add packages/web/src/styles/components.css
git commit -m "style: refine mobile command palette layout"
```

---

## Task 4: Final Verification and Boundary Check

**Files:**
- Verify only touched files from Tasks 1-3

- [ ] **Step 1: Run focused command palette tests**

```bash
pnpm --filter @coder-studio/web test -- --runInBand packages/web/src/features/command-palette/components/command-palette.test.tsx
```

Expected:

- `CommandPalette` tests pass

- [ ] **Step 2: Run the full web test suite**

```bash
pnpm --filter @coder-studio/web test
```

Expected:

- full `@coder-studio/web` test suite passes

- [ ] **Step 3: Lint touched files**

```bash
pnpm exec biome lint \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/styles/components.css
```

Expected:

- no lint errors

- [ ] **Step 4: Check diff boundaries**

```bash
git diff --check
git diff -- packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/styles/components.css
```

Expected:

- no whitespace or merge-marker errors
- diff remains limited to the `CommandPalette` feature and CSS support

- [ ] **Step 5: Create a final verification commit only if needed**

If verification exposed issues that required fixes, commit them with a focused message such as:

```bash
git add <touched-files>
git commit -m "fix: polish mobile command palette behavior"
```

If no fixes were needed, do not create an extra commit.
