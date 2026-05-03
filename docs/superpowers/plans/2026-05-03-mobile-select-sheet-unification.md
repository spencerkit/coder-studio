# Mobile Select Sheet Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single `MobileSelectSheet` component on top of `MobileSheet` and migrate the mobile supervisor evaluator, terminal switcher, branch quick pick, and agent session/provider flows to it without changing the out-of-scope mobile overlays.

**Architecture:** Introduce a structured, single-select mobile selector component that owns list rendering, search, actions, creation, and selection state while reusing `MobileSheet` as the low-level shell. Migrate the scoped flows incrementally from simplest to most stateful, preserving existing business actions and atoms while removing redundant selector UI shells.

**Tech Stack:** React 19, TypeScript, Jotai, Vitest, Testing Library, Vite, Biome

---

## File Structure

### New files

- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
  Shared mobile selector component built on `MobileSheet`.
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.test.tsx`
  Unit tests for shared selector rendering, search, selection, actions, and create flows.
- `packages/web/src/features/mobile-select/index.ts`
  Barrel export for the shared selector.

### Modified files

- `packages/web/src/styles/components.css`
  Shared selector styles and cleanup of retired mobile selector styles.
- `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
  Replace mobile `MobileInlineSheet` terminal selector with `MobileSelectSheet`.
- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
  Update mobile terminal selector tests to assert the unified selector.
- `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
  Replace the native evaluator `<select>` with a mobile-triggered selector entry while preserving desktop behavior.
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
  Update evaluator interaction coverage for the new mobile/desktop split.
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
  Host the evaluator `MobileSelectSheet` inside the mobile supervisor detail flow.
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`
  Add/adjust mobile evaluator selection coverage.
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
  Replace overlay markup with `MobileSelectSheet`-backed rendering and keep this file as the branch-selector integration wrapper.
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
  Preserve branch quick-pick state/actions while exposing data in a shape usable by `MobileSelectSheet`.
- `packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx`
  Update branch selection/search/create tests to assert the shared selector UI.
- `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
  Rework to render `MobileSelectSheet` while preserving agent business logic and open-state ownership.
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
  Continue mounting the agent flow from the mobile dock, but route the open state through the unified selector implementation.
- `packages/web/src/shells/mobile-shell/index.test.tsx`
  Update mobile dock selector expectations for the shared selector.
- `packages/web/src/features/workspace/views/shared/branch-picker-button.test.tsx`
  Preserve branch-trigger open-state expectations against the existing quick-pick atom.
- `packages/web/src/features/workspace/index.test.tsx`
  Preserve branch-trigger integration expectations against the existing quick-pick atom.
- `packages/web/src/shells/mobile-shell/index.tsx`
  Keep mounting the branch selector integration point after the wrapper conversion.

### Deleted files if no longer used

- `packages/web/src/shells/shared/mobile-inline-sheet.tsx`
  Delete only after all imports are removed.

## Task 1: Add Shared MobileSelectSheet Component

**Files:**
- Create: `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- Create: `packages/web/src/features/mobile-select/components/mobile-select-sheet.test.tsx`
- Create: `packages/web/src/features/mobile-select/index.ts`
- Modify: `packages/web/src/styles/components.css`
- Reference: `packages/web/src/features/workspace/views/mobile/mobile-sheet.tsx`

- [ ] **Step 1: Write the failing shared component tests**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileSelectSheet } from './mobile-select-sheet';

describe('MobileSelectSheet', () => {
  it('renders option sections and highlights the selected item', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <MobileSelectSheet
        title="Terminal Sessions"
        sections={[
          {
            kind: 'options',
            id: 'terminals',
            items: [
              { id: 'term_1', label: 'Workspace Shell', meta: 'Current terminal' },
              { id: 'term_2', label: 'Workspace Shell 2', meta: 'Terminal 2' },
            ],
          },
        ]}
        selectedId="term_1"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Terminal Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Workspace Shell' })).toHaveAttribute(
      'data-selected',
      'true'
    );

    await user.click(screen.getByRole('button', { name: 'Workspace Shell 2' }));
    expect(onSelect).toHaveBeenCalledWith('term_2');
  });

  it('filters only option sections when searchable and keeps action rows visible', async () => {
    const user = userEvent.setup();

    render(
      <MobileSelectSheet
        title="Agent Sessions"
        searchable
        searchPlaceholder="Search sessions"
        sections={[
          {
            kind: 'actions',
            id: 'actions',
            items: [{ id: 'create', label: 'Create Session', onAction: vi.fn() }],
          },
          {
            kind: 'options',
            id: 'sessions',
            items: [
              { id: 'sess_1', label: 'Claude' },
              { id: 'sess_2', label: 'Codex' },
            ],
          },
        ]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText('Search sessions'), 'cod');

    expect(screen.getByRole('button', { name: 'Create Session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claude' })).not.toBeInTheDocument();
  });

  it('renders the create action from the current query when enabled', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(
      <MobileSelectSheet
        title="Branch"
        searchable
        searchPlaceholder="Search branches"
        sections={[{ kind: 'options', id: 'branches', items: [] }]}
        create={{
          visible: true,
          label: (query) => `Create branch: ${query}`,
          onCreate,
        }}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText('Search branches'), 'feature/mobile-select');
    await user.click(screen.getByRole('button', { name: 'Create branch: feature/mobile-select' }));

    expect(onCreate).toHaveBeenCalledWith('feature/mobile-select');
  });
});
```

- [ ] **Step 2: Run the shared selector tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/mobile-select/components/mobile-select-sheet.test.tsx
```

Expected: FAIL with missing `mobile-select-sheet.tsx` module and undefined component errors.

- [ ] **Step 3: Implement the minimal shared selector component and export**

```tsx
import { Check, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MobileSheet } from '../../workspace/views/mobile/mobile-sheet';

export type MobileSelectItem = {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
  tone?: 'default' | 'danger';
};

export type MobileSelectActionItem = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onAction: () => void | Promise<void>;
};

export type MobileSelectSection =
  | {
      kind: 'options';
      id: string;
      title?: string;
      items: MobileSelectItem[];
    }
  | {
      kind: 'actions';
      id: string;
      title?: string;
      items: MobileSelectActionItem[];
    };

export type MobileSelectCreateConfig = {
  visible: boolean;
  label: (query: string) => string;
  disabled?: (query: string) => boolean;
  onCreate: (query: string) => void | Promise<void>;
};

interface MobileSelectSheetProps {
  title: string;
  kicker?: string;
  sections: MobileSelectSection[];
  selectedId?: string | null;
  searchable?: boolean;
  searchPlaceholder?: string;
  create?: MobileSelectCreateConfig;
  loading?: boolean;
  emptyText?: string;
  closeOnSelect?: boolean;
  onSelect: (id: string) => void | Promise<void>;
  onClose: () => void;
  onBack?: () => void;
}

export function MobileSelectSheet({
  title,
  kicker,
  sections,
  selectedId,
  searchable = false,
  searchPlaceholder,
  create,
  loading = false,
  emptyText = 'No results',
  closeOnSelect = true,
  onSelect,
  onClose,
  onBack,
}: MobileSelectSheetProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    return sections.map((section) => {
      if (section.kind !== 'options' || !normalizedQuery) {
        return section;
      }

      return {
        ...section,
        items: section.items.filter((item) => {
          const haystack = [
            item.label,
            item.description,
            item.meta,
            ...(item.keywords ?? []),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      };
    });
  }, [normalizedQuery, sections]);

  const optionCount = filteredSections.reduce((count, section) => {
    return section.kind === 'options' ? count + section.items.length : count;
  }, 0);

  return (
    <MobileSheet
      title={title}
      kicker={kicker}
      onClose={onClose}
      onBack={onBack}
      bodyClassName="mobile-sheet__body--flush"
      contentClassName="mobile-select-sheet"
      body={
        <div className="mobile-select-sheet__body">
          {searchable ? (
            <div className="mobile-select-sheet__search">
              <input
                className="input mobile-select-sheet__search-input"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}

          {loading ? <div className="mobile-select-sheet__empty">Loading...</div> : null}

          {!loading &&
            filteredSections.map((section) => (
              <div key={section.id} className="mobile-select-sheet__section">
                {section.title ? (
                  <div className="mobile-select-sheet__section-title">{section.title}</div>
                ) : null}

                {section.kind === 'actions'
                  ? section.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="mobile-select-sheet__row mobile-select-sheet__row--action"
                        disabled={item.disabled}
                        onClick={() => {
                          void item.onAction();
                        }}
                      >
                        <span className="mobile-select-sheet__row-copy">
                          <span>{item.label}</span>
                          {item.description ? <span>{item.description}</span> : null}
                        </span>
                      </button>
                    ))
                  : section.items.map((item) => {
                      const isSelected = item.id === selectedId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="mobile-select-sheet__row mobile-select-sheet__row--option"
                          aria-label={item.label}
                          data-selected={isSelected ? 'true' : 'false'}
                          disabled={item.disabled}
                          onClick={() => {
                            void onSelect(item.id);
                            if (closeOnSelect) {
                              onClose();
                            }
                          }}
                        >
                          <span className="mobile-select-sheet__row-copy">
                            <span>{item.label}</span>
                            {item.description || item.meta ? (
                              <span>{item.description ?? item.meta}</span>
                            ) : null}
                          </span>
                          {isSelected ? <Check size={16} /> : null}
                        </button>
                      );
                    })}
              </div>
            ))}

          {!loading && optionCount === 0 && create?.visible && normalizedQuery ? (
            <button
              type="button"
              className="mobile-select-sheet__row mobile-select-sheet__row--create"
              disabled={create.disabled?.(query) ?? false}
              onClick={() => {
                void create.onCreate(query.trim());
              }}
            >
              <Plus size={16} />
              <span>{create.label(query.trim())}</span>
            </button>
          ) : null}

          {!loading && optionCount === 0 && !(create?.visible && normalizedQuery) ? (
            <div className="mobile-select-sheet__empty">{emptyText}</div>
          ) : null}
        </div>
      }
    />
  );
}
```

- [ ] **Step 4: Add the shared selector styles and run the component tests**

Add to `packages/web/src/styles/components.css`:

```css
.mobile-select-sheet__body {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.mobile-select-sheet__search {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
}

.mobile-select-sheet__section {
  display: flex;
  flex-direction: column;
}

.mobile-select-sheet__section-title {
  padding: var(--sp-3) var(--sp-4) var(--sp-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mobile-select-sheet__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-4);
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.mobile-select-sheet__row-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: var(--sp-1);
}

.mobile-select-sheet__row[data-selected='true'] {
  background: var(--bg-active);
}

.mobile-select-sheet__empty {
  padding: var(--sp-8) var(--sp-4);
  color: var(--text-secondary);
  text-align: center;
}
```

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/mobile-select/components/mobile-select-sheet.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit the shared selector scaffold**

```bash
git add packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx \
  packages/web/src/features/mobile-select/components/mobile-select-sheet.test.tsx \
  packages/web/src/features/mobile-select/index.ts \
  packages/web/src/styles/components.css
git commit -m "feat(web): add shared mobile select sheet"
```

## Task 2: Migrate Mobile Terminal Switching

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
- Reference: `packages/web/src/features/terminal-panel/views/shared/terminal-selector-item.tsx`

- [ ] **Step 1: Write the failing terminal selector regression**

Add to `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`:

```tsx
it('uses MobileSelectSheet for the mobile terminal selector', async () => {
  const user = userEvent.setup();
  const store = createStore();

  store.set(wsClientAtom, { subscribe, sendCommand } as never);

  render(
    <Provider store={store}>
      <MemoryRouter>
        <div className="mobile-terminal-sheet mobile-terminal-sheet--fullscreen">
          <TerminalPanel chrome="mobile-fullscreen" />
        </div>
      </MemoryRouter>
    </Provider>
  );

  await waitFor(() => {
    expect(screen.getByTestId('xterm-host')).toHaveTextContent('term_1');
  });

  await user.click(screen.getByRole('button', { name: 'Switch terminal' }));

  expect(screen.getByRole('dialog', { name: 'Terminal Sessions' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Workspace Shell 2' })).toHaveAttribute(
    'data-selected',
    'false'
  );
});
```

- [ ] **Step 2: Run the focused terminal test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/terminal-panel/__tests__/terminal-panel.test.tsx -t "uses MobileSelectSheet for the mobile terminal selector"
```

Expected: FAIL because the mobile selector rows are still rendered by `MobileInlineSheet`.

- [ ] **Step 3: Replace the mobile terminal selector sheet with MobileSelectSheet**

Update `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`:

```tsx
import { MobileSelectSheet } from '../../../mobile-select';

const terminalOptions = terminalIds.map((id, index) => {
  const terminalMeta = store.get(terminalMetaAtomFamily(id));
  const label = formatTerminalTitle(terminalMeta, index, t('terminal.shell'));
  return {
    id,
    label,
    meta:
      id === activeTerminalId
        ? t('terminal.selector.current')
        : t('terminal.selector.indexed', { index: index + 1 }),
  };
});

{isMobileFullscreen ? (
  selectorSheetOpen ? (
    <MobileSelectSheet
      title={t('terminal.selector.title')}
      sections={[{ kind: 'options', id: 'terminals', items: terminalOptions }]}
      selectedId={activeTerminalId}
      onClose={() => setSelectorSheetOpen(false)}
      onSelect={(id) => {
        handleSwitchTerminal(id);
        setSelectorSheetOpen(false);
      }}
    />
  ) : null
) : terminalIds.length > 1 ? (
```

Keep the desktop `terminal-selector-dropdown` branch unchanged.

- [ ] **Step 4: Run the terminal tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit the terminal migration**

```bash
git add packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx \
  packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx
git commit -m "refactor(web): unify mobile terminal selector"
```

## Task 3: Migrate Mobile Supervisor Evaluator Selection

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Modify: `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 1: Write the failing mobile supervisor selector test**

Add to `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`:

```tsx
it('opens the evaluator provider picker inside the mobile supervisor detail flow', async () => {
  const user = userEvent.setup();
  const store = createStore();

  window.localStorage.setItem('ui.locale', JSON.stringify('en'));
  store.set(localeAtom, 'en');
  store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
  store.set(supervisorsAtom, new Map());

  render(
    <Provider store={store}>
      <MobileSupervisorSheet sessionId="sess-1" workspaceId="ws-1" onClose={vi.fn()} />
    </Provider>
  );

  await user.click(screen.getByRole('button', { name: 'Enable Objective' }));
  await user.click(screen.getByRole('button', { name: 'Evaluator' }));

  expect(screen.getByRole('dialog', { name: 'Evaluator' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Codex' }));

  expect(screen.getByRole('button', { name: 'Evaluator' })).toHaveTextContent('Codex');
});
```

- [ ] **Step 2: Run the mobile supervisor test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx -t "opens the evaluator provider picker inside the mobile supervisor detail flow"
```

Expected: FAIL because the evaluator control is still a native `<select>`.

- [ ] **Step 3: Replace the mobile evaluator select with a MobileSelectSheet-backed trigger**

Update `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx` to accept mobile selector props:

```tsx
interface ObjectiveDialogContentProps {
  mode: ObjectiveDialogMode;
  draftObjective: string;
  draftEvaluatorProviderId: ObjectiveDialogEvaluatorProviderId;
  disableObjective: string;
  onDraftObjectiveChange: (value: string) => void;
  onDraftEvaluatorProviderChange: (value: ObjectiveDialogEvaluatorProviderId) => void;
  mobileEvaluatorPicker?: {
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    isMobile: boolean;
  };
}
```

Render:

```tsx
{mobileEvaluatorPicker?.isMobile ? (
  <>
    <button
      type="button"
      className="input mobile-select-trigger"
      aria-label={t('supervisor.field.evaluator')}
      onClick={mobileEvaluatorPicker.onOpen}
    >
      <span>{OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.find((option) => option.id === draftEvaluatorProviderId)?.label}</span>
    </button>
    {mobileEvaluatorPicker.open ? (
      <MobileSelectSheet
        title={t('supervisor.field.evaluator')}
        sections={[
          {
            kind: 'options',
            id: 'evaluator-providers',
            items: OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => ({
              id: option.id,
              label: option.label,
            })),
          },
        ]}
        selectedId={draftEvaluatorProviderId}
        onClose={mobileEvaluatorPicker.onClose}
        onSelect={(id) => onDraftEvaluatorProviderChange(id as ObjectiveDialogEvaluatorProviderId)}
      />
    ) : null}
  </>
) : (
  <select
    id="evaluator-provider"
    className="input"
    value={draftEvaluatorProviderId}
    onChange={(event) =>
      onDraftEvaluatorProviderChange(
        event.target.value as ObjectiveDialogEvaluatorProviderId
      )
    }
  >
    {OBJECTIVE_DIALOG_EVALUATOR_OPTIONS.map((option) => (
      <option key={option.id} value={option.id}>
        {option.label}
      </option>
    ))}
  </select>
)}
```

Update `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx` to own a local `evaluatorPickerOpen` boolean and pass `mobileEvaluatorPicker`.

- [ ] **Step 4: Run supervisor tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx src/features/supervisor/components/objective-dialog.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit the supervisor migration**

```bash
git add packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx \
  packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx \
  packages/web/src/features/supervisor/components/objective-dialog.test.tsx
git commit -m "refactor(web): unify mobile supervisor selector"
```

## Task 4: Migrate Branch Quick Pick to the Shared Selector

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-git-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing branch selector regression**

Add to `packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx`:

```tsx
it('renders the shared MobileSelectSheet shell for branch quick pick', async () => {
  render(
    <Provider store={store}>
      <BranchQuickPick />
    </Provider>
  );

  expect(screen.getByRole('dialog', { name: 'Branch' })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search branches or create new branch...')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'main' })).toHaveAttribute('data-selected', 'true');
});
```

- [ ] **Step 2: Run the focused branch tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/views/shared/branch-quick-pick.test.tsx -t "renders the shared MobileSelectSheet shell for branch quick pick"
```

Expected: FAIL because the branch picker still renders its own overlay markup.

- [ ] **Step 3: Convert BranchQuickPick to a MobileSelectSheet integration wrapper**

Update `packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx`:

```tsx
import { MobileSelectSheet } from '../../../mobile-select';

export function BranchQuickPick() {
  const {
    branchList,
    displayItems,
    handleBranchCreate,
    handleBranchSelect,
    handleClose,
    handleRequestBranchCreate,
    inputValue,
    quickPickState,
  } = useBranchQuickPickActions();

  if (!quickPickState.visible) {
    return null;
  }

  const optionItems = displayItems
    .filter((item) => item.type === 'branch')
    .map((item) => ({
      id: item.branch!.name,
      label: item.branch!.name,
      badge: item.branch!.isRemote ? 'Remote' : undefined,
    }));

  return (
    <MobileSelectSheet
      title="Branch"
      searchable
      searchPlaceholder="Search branches or create new branch..."
      sections={[{ kind: 'options', id: 'branches', items: optionItems }]}
      selectedId={branchList.current}
      loading={branchList.loading}
      create={{
        visible: Boolean(inputValue.trim()) && !displayItems.some((item) => item.type === 'branch' && item.label.toLowerCase() === inputValue.trim().toLowerCase()),
        label: (query) =>
          displayItems.some((item) => item.type === 'confirm-create')
            ? `Confirm create branch: ${query}`
            : `Create branch: ${query}`,
        onCreate: (query) => {
          const confirm = displayItems.some((item) => item.type === 'confirm-create');
          if (confirm) {
            return handleBranchCreate(query);
          }
          handleRequestBranchCreate(query);
        },
      }}
      onClose={handleClose}
      onSelect={(id) => handleBranchSelect(id)}
    />
  );
}
```

Keep the atom and existing action hook so current branch-trigger tests and mobile shell integrations do not need a state-model rewrite.

- [ ] **Step 4: Run the branch quick-pick tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/workspace/views/shared/branch-quick-pick.test.tsx src/features/workspace/views/shared/branch-picker-button.test.tsx src/features/workspace/index.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit the branch migration**

```bash
git add packages/web/src/features/workspace/views/shared/branch-quick-pick.tsx \
  packages/web/src/features/workspace/actions/use-git-actions.ts \
  packages/web/src/features/workspace/views/shared/branch-quick-pick.test.tsx \
  packages/web/src/features/workspace/views/shared/branch-picker-button.test.tsx \
  packages/web/src/features/workspace/index.test.tsx \
  packages/web/src/styles/components.css
git commit -m "refactor(web): unify mobile branch selector"
```

## Task 5: Migrate the Agent Session / Provider Flow

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing agent selector regression**

Add to `packages/web/src/shells/mobile-shell/index.test.tsx`:

```tsx
it('switches from session mode to provider mode inside a single mobile select sheet', async () => {
  const user = userEvent.setup();
  renderMobileShell();

  await user.click(await screen.findByRole('button', { name: 'Open Agent sheet' }));
  expect(screen.getByRole('dialog', { name: 'Agent Sessions' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Create Session' }));
  expect(screen.getByRole('dialog', { name: 'Select Provider' })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('dialog', { name: 'Agent Sessions' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused mobile shell test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/shells/mobile-shell/index.test.tsx -t "switches from session mode to provider mode inside a single mobile select sheet"
```

Expected: FAIL because the current implementation uses a custom `MobileInlineSheet` layout and toggled subpanel instead of a single unified selector.

- [ ] **Step 3: Rework MobileAgentSheet to render through MobileSelectSheet**

Update `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { MobileSelectSheet } from '../../../mobile-select';

type AgentSheetMode = 'sessions' | 'providers';

export function MobileAgentSheet(props: MobileAgentSheetProps) {
  const [mode, setMode] = useState<AgentSheetMode>(props.defaultMode === 'create' ? 'providers' : 'sessions');

  const sessionSections = useMemo(
    () => [
      {
        kind: 'actions' as const,
        id: 'agent-actions',
        items: [
          {
            id: 'create',
            label: t('action.create_session'),
            onAction: () => setMode('providers'),
            disabled: !canLaunchSession,
          },
          ...(activeSession
            ? [
                {
                  id: 'close-current',
                  label: t('mobile.agent.close_current_session'),
                  tone: 'danger' as const,
                  onAction: async () => {
                    await onCloseSession(activeSession.id);
                    closeSheet();
                  },
                },
              ]
            : []),
        ],
      },
      {
        kind: 'options' as const,
        id: 'sessions',
        items: sessions.map((session) => ({
          id: session.id,
          label: formatSessionLabel(session),
          meta: session.providerId.toUpperCase(),
        })),
      },
    ],
    [activeSession, canLaunchSession, onCloseSession, sessions, t]
  );

  const providerSections = [
      {
        kind: 'options' as const,
        id: 'providers',
        items: providerButtons.map((provider) => {
          const state = states[provider.id];
          const busy =
            state.loading ||
            state.installJob?.status === 'queued' ||
            state.installJob?.status === 'running';

          return {
            id: provider.id,
            label: provider.title,
            meta: busy ? t('mobile.agent.starting') : t('mobile.agent.start_new_session'),
            disabled: !canLaunchSession || busy,
          };
        }),
      },
    ];

  return (
    <MobileSelectSheet
      title={mode === 'sessions' ? t('mobile.agent.title') : t('session.provider_select')}
      sections={mode === 'sessions' ? sessionSections : providerSections}
      selectedId={mode === 'sessions' ? activeSession?.id ?? null : null}
      onBack={mode === 'providers' ? () => setMode('sessions') : undefined}
      onClose={closeSheet}
      onSelect={(id) => {
        if (mode === 'sessions') {
          onSelectSession(id);
          closeSheet();
          return;
        }

        void launch(id as 'claude' | 'codex');
      }}
    />
  );
}
```

Keep `workspace-mobile-view.tsx` mounting `MobileAgentSheet` behind the same `agentSheetOpen` flag so dock interactions do not change.

- [ ] **Step 4: Run the agent/mobile shell tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/shells/mobile-shell/index.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit the agent migration**

```bash
git add packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx \
  packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/styles/components.css
git commit -m "refactor(web): unify mobile agent selector"
```

## Task 6: Remove Retired Mobile Selector Shells and Verify

**Files:**
- Delete: `packages/web/src/shells/shared/mobile-inline-sheet.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing cleanup check**

Run this search before deleting:

```bash
rg -n "MobileInlineSheet" packages/web/src
```

Expected: one or more remaining imports in the terminal or agent flows.

- [ ] **Step 2: Remove dead imports and delete MobileInlineSheet only when the search is clean**

Apply the cleanup:

```bash
rg -n "MobileInlineSheet" packages/web/src
rm packages/web/src/shells/shared/mobile-inline-sheet.tsx
```

Then remove any now-dead CSS blocks tied only to `.mobile-inline-sheet` from `packages/web/src/styles/components.css`.

- [ ] **Step 3: Run the targeted web test suite for all migrated flows**

Run:

```bash
pnpm --dir packages/web exec vitest run \
  src/features/mobile-select/components/mobile-select-sheet.test.tsx \
  src/features/terminal-panel/__tests__/terminal-panel.test.tsx \
  src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/workspace/views/shared/branch-quick-pick.test.tsx \
  src/features/workspace/views/shared/branch-picker-button.test.tsx \
  src/features/workspace/index.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: PASS

- [ ] **Step 4: Run the web package suite and formatting checks**

Run:

```bash
pnpm --dir packages/web test
pnpm lint
```

Expected:
- `pnpm --dir packages/web test`: PASS
- `pnpm lint`: PASS or only pre-existing unrelated failures outside touched files

- [ ] **Step 5: Commit the cleanup and verification pass**

```bash
git add packages/web/src
git commit -m "refactor(web): finish mobile select sheet unification"
```

## Self-Review

### Spec coverage

- Shared `MobileSelectSheet` component: covered by Task 1.
- Terminal migration: covered by Task 2.
- Supervisor evaluator migration: covered by Task 3.
- Branch search/create migration: covered by Task 4.
- Agent session/provider mode migration: covered by Task 5.
- Selector shell cleanup and verification: covered by Task 6.
- Out-of-scope overlays remain unchanged: protected by targeted regression focus in Tasks 4-6 and final test suite selection.

### Placeholder scan

- No `TBD`, `TODO`, or “implement later” placeholders remain in task steps.
- Every task includes concrete files, commands, and minimum code shape.

### Type consistency

- Shared selector types are introduced once in Task 1 and reused by later migrations.
- `selectedId`, `sections`, `create`, `onSelect`, `onClose`, and `onBack` stay consistent across all tasks.
- The plan intentionally keeps `branchQuickPickAtom` and `useBranchQuickPickActions()` in place during migration so downstream tests and triggers do not require a separate state-model rewrite.
