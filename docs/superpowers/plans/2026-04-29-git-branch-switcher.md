# Git Branch Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Quick Pick-style git branch switching feature to the Git Panel toolbar with keyboard navigation and branch creation support.

**Architecture:** Pure frontend Quick Pick component using React + Jotai for state management. Backend git commands enhanced to support structured branch data and remote branch checkout. Integrates into existing Git Panel workflow.

**Tech Stack:** React, TypeScript, Jotai, Vitest, Playwright, Git CLI

---

## File Structure

**Backend (Server):**
- Modify: `packages/server/src/git/cli.ts` - Enhance branch listing and checkout
- Modify: `packages/server/src/__tests__/git/cli.test.ts` - Test backend changes
- Modify: `packages/core/src/types/git.ts` - Add GitBranch type (if needed)

**Frontend (Web):**
- Modify: `packages/web/src/atoms/git.ts` - Add branch state management
- Create: `packages/web/src/features/workspace/components/branch-picker-button.tsx` - Toolbar button component
- Create: `packages/web/src/features/workspace/components/branch-quick-pick.tsx` - Quick Pick overlay component
- Modify: `packages/web/src/features/workspace/components/git-panel.tsx` - Integrate branch button
- Modify: `packages/web/src/styles/components.css` - Add Quick Pick styles
- Create: `packages/web/src/features/workspace/components/branch-picker-button.test.tsx` - Unit tests
- Create: `packages/web/src/features/workspace/components/branch-quick-pick.test.tsx` - Unit tests

**E2E Tests:**
- Create: `e2e/specs/git-branch-switching.spec.ts` - Integration tests

---

## Phase 1: Backend Enhancement

### Task 1: Add GitBranch Type Definition

**Files:**
- Check: `packages/core/src/types/git.ts` (or similar location)
- Modify: Add GitBranch interface if not existing

- [ ] **Step 1: Check if GitBranch type exists**

Run: `grep -r "interface GitBranch" packages/`

If found, skip to Task 2. If not, continue with Step 2.

- [ ] **Step 2: Add GitBranch interface to core types**

File: `packages/core/src/types/git.ts` (or create if needed)

```typescript
export interface GitBranch {
  name: string;        // Branch name (e.g., "main", "origin/feature")
  isRemote: boolean;   // Whether it's a remote branch
  isCurrent: boolean;  // Whether it's the current branch
  remote?: string;     // Remote name (e.g., "origin")
}
```

- [ ] **Step 3: Verify export**

Run: `grep "export.*GitBranch" packages/core/src/types/git.ts`

Expected: Type exported

- [ ] **Step 4: Commit type definition**

```bash
git add packages/core/src/types/git.ts
git commit -m "feat(core): add GitBranch type definition"
```

---

### Task 2: Enhance runGitListBranches Function

**Files:**
- Modify: `packages/server/src/git/cli.ts:308-325`
- Test: `packages/server/src/__tests__/git/cli.test.ts`

- [ ] **Step 1: Write failing test for remote branches**

File: `packages/server/src/__tests__/git/cli.test.ts`

Add to existing test suite:

```typescript
describe('runGitListBranches', () => {
  // ... existing tests ...

  it('returns structured branch data with remote branches', async () => {
    // Setup: Create a repo with local and remote branches
    const repoDir = await createTempRepo();
    await execGit(repoDir, ['checkout', '-b', 'feature-1']);
    await execGit(repoDir, ['checkout', 'main']);
    
    const result = await runGitListBranches(repoDir);
    
    expect(result.current).toBe('main');
    expect(result.branches).toContainEqual({
      name: 'main',
      isRemote: false,
      isCurrent: true,
    });
    expect(result.branches).toContainEqual({
      name: 'feature-1',
      isRemote: false,
      isCurrent: false,
    });
    
    // Cleanup
    await rm(repoDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npm test -- cli.test.ts -t "returns structured branch data"`

Expected: FAIL - "branches does not contain"

- [ ] **Step 3: Enhance runGitListBranches implementation**

File: `packages/server/src/git/cli.ts`

Replace the function at line 308:

```typescript
export async function runGitListBranches(cwd: string): Promise<{
  branches: GitBranch[];
  current: string;
}> {
  // Get local branches
  const { stdout: localOutput } = await runGit(cwd, ['branch', '--list']);

  // Get remote branches
  const { stdout: remoteOutput } = await runGit(cwd, ['branch', '-r']);

  const branches: GitBranch[] = [];
  let current = '';

  // Parse local branches
  const localLines = localOutput.split('\n').filter(line => line.trim());
  for (const line of localLines) {
    const isCurrent = line.startsWith('*');
    const name = line.replace(/^\*?\s+/, '').trim();
    branches.push({
      name,
      isRemote: false,
      isCurrent,
    });
    if (isCurrent) {
      current = name;
    }
  }

  // Parse remote branches
  const remoteLines = remoteOutput.split('\n').filter(line => line.trim());
  for (const line of remoteLines) {
    const fullName = line.trim();
    const [remote] = fullName.split('/');
    branches.push({
      name: fullName,  // Show full name "origin/main"
      isRemote: true,
      isCurrent: false,
      remote,
    });
  }

  return { branches, current };
}
```

- [ ] **Step 4: Add GitBranch import**

At the top of `packages/server/src/git/cli.ts`:

```typescript
import type { GitBranch } from '@coder-studio/core';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npm test -- cli.test.ts -t "returns structured branch data"`

Expected: PASS

- [ ] **Step 6: Commit backend enhancement**

```bash
git add packages/server/src/git/cli.ts packages/server/src/__tests__/git/cli.test.ts
git commit -m "feat(server): enhance runGitListBranches to return structured branch data"
```

---

### Task 3: Enhance runGitCheckout for Remote Branches

**Files:**
- Modify: `packages/server/src/git/cli.ts:258-282`
- Test: `packages/server/src/__tests__/git/cli.test.ts`

- [ ] **Step 1: Write failing test for remote branch checkout**

File: `packages/server/src/__tests__/git/cli.test.ts`

```typescript
describe('runGitCheckout', () => {
  // ... existing tests ...

  it('creates tracking branch for remote branch', async () => {
    const repoDir = await createTempRepo();
    // Setup: Add a remote branch reference
    await execGit(repoDir, ['remote', 'add', 'origin', 'https://github.com/test/test.git']);
    
    const result = await runGitCheckout(repoDir, 'origin/main');
    
    expect(result.success).toBe(true);
    expect(result.branch).toBe('main'); // Local branch created
    
    await rm(repoDir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npm test -- cli.test.ts -t "creates tracking branch"`

Expected: FAIL

- [ ] **Step 3: Enhance runGitCheckout implementation**

File: `packages/server/src/git/cli.ts`

Replace the function at line 258:

```typescript
export async function runGitCheckout(
  cwd: string,
  ref: string,
  options?: {
    createBranch?: boolean;
  }
): Promise<{ success: boolean; message: string; branch?: string }> {
  const args = ['checkout'];

  // If ref is remote branch (contains '/'), auto-create tracking branch
  if (ref.includes('/') && !options?.createBranch) {
    const branchName = ref.split('/').pop() ?? ref;
    args.push('-b', branchName, ref);
  } else {
    if (options?.createBranch) {
      args.push('-b');
    }
    args.push(ref);
  }

  const { stdout, stderr } = await runGit(cwd, args);

  // Extract branch name from output
  const branchMatch = stdout.match(/Switched to (?:a new branch|branch) '([^']+)'/);
  const branch = branchMatch?.[1] ?? ref;

  return { success: true, message: stdout || stderr, branch };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npm test -- cli.test.ts -t "creates tracking branch"`

Expected: PASS

- [ ] **Step 5: Commit checkout enhancement**

```bash
git add packages/server/src/git/cli.ts packages/server/src/__tests__/git/cli.test.ts
git commit -m "feat(server): enhance runGitCheckout to auto-create tracking branches"
```

---

## Phase 2: Frontend State Management

### Task 4: Add Branch State Atoms

**Files:**
- Modify: `packages/web/src/atoms/git.ts`

- [ ] **Step 1: Add GitBranchList type and atoms**

File: `packages/web/src/atoms/git.ts`

Add after existing imports:

```typescript
import type { GitBranch } from '@coder-studio/core';

export interface GitBranchList {
  current: string;
  branches: GitBranch[];
  loading: boolean;
  error?: string;
}

export interface BranchQuickPickState {
  visible: boolean;
  workspaceId?: string;
  inputValue: string;
  selectedBranch?: string;
}

// Branch list per workspace
export const gitBranchListAtomFamily = atomFamily(
  (workspaceId: string) => atom<GitBranchList>({
    current: '',
    branches: [],
    loading: false,
  })
);

// Quick Pick UI state (global)
export const branchQuickPickAtom = atom<BranchQuickPickState>({
  visible: false,
  inputValue: '',
});
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd packages/web && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Commit atoms**

```bash
git add packages/web/src/atoms/git.ts
git commit -m "feat(web): add git branch state atoms"
```

---

## Phase 3: UI Components

### Task 5: Create BranchPickerButton Component

**Files:**
- Create: `packages/web/src/features/workspace/components/branch-picker-button.tsx`
- Create: `packages/web/src/features/workspace/components/branch-picker-button.test.tsx`

- [ ] **Step 1: Write failing test for BranchPickerButton**

File: `packages/web/src/features/workspace/components/branch-picker-button.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'jotai';
import { BranchPickerButton } from './branch-picker-button';
import { gitBranchListAtomFamily, branchQuickPickAtom } from '../../../atoms/git';

describe('BranchPickerButton', () => {
  it('displays current branch name', () => {
    const store = vi.fn();
    store.get = vi.fn((atom) => {
      if (atom.toString().includes('gitBranchList')) {
        return { current: 'main', branches: [], loading: false };
      }
      return { visible: false, inputValue: '' };
    });
    store.set = vi.fn();

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('shows "No branch" when detached HEAD', () => {
    const store = vi.fn();
    store.get = vi.fn((atom) => {
      if (atom.toString().includes('gitBranchList')) {
        return { current: '', branches: [], loading: false };
      }
      return { visible: false, inputValue: '' };
    });
    store.set = vi.fn();

    render(
      <Provider store={store}>
        <BranchPickerButton workspaceId="test-workspace" />
      </Provider>
    );

    expect(screen.getByText('No branch')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npm test -- branch-picker-button.test.tsx`

Expected: FAIL - "Cannot find module"

- [ ] **Step 3: Create BranchPickerButton component**

File: `packages/web/src/features/workspace/components/branch-picker-button.tsx`

```typescript
import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { GitBranch } from 'lucide-react';
import { gitBranchListAtomFamily, branchQuickPickAtom } from '../../../atoms/git';

interface BranchPickerButtonProps {
  workspaceId: string;
}

export const BranchPickerButton: FC<BranchPickerButtonProps> = ({ workspaceId }) => {
  const branchList = useAtomValue(gitBranchListAtomFamily(workspaceId));
  const setQuickPick = useSetAtom(branchQuickPickAtom);

  const handleClick = () => {
    setQuickPick({
      visible: true,
      workspaceId,
      inputValue: '',
    });
  };

  return (
    <button
      className="panel-toolbar-btn branch-picker-btn"
      onClick={handleClick}
      title="Switch Branch"
      type="button"
    >
      <GitBranch size={14} />
      <span className="branch-name">
        {branchList.current || 'No branch'}
      </span>
    </button>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npm test -- branch-picker-button.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit BranchPickerButton**

```bash
git add packages/web/src/features/workspace/components/branch-picker-button.tsx packages/web/src/features/workspace/components/branch-picker-button.test.tsx
git commit -m "feat(web): create BranchPickerButton component"
```

---

### Task 6: Create BranchQuickPick Component (Part 1: Basic Structure)

**Files:**
- Create: `packages/web/src/features/workspace/components/branch-quick-pick.tsx`

- [ ] **Step 1: Create basic BranchQuickPick structure**

File: `packages/web/src/features/workspace/components/branch-quick-pick.tsx`

```typescript
import type { FC } from 'react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Check, Plus } from 'lucide-react';
import {
  branchQuickPickAtom,
  gitBranchListAtomFamily,
} from '../../../atoms/git';
import { dispatchCommandAtom } from '../../../atoms/connection';
import type { GitBranch } from '@coder-studio/core';

export const BranchQuickPick: FC = () => {
  const quickPickState = useAtomValue(branchQuickPickAtom);
  const setQuickPick = useSetAtom(branchQuickPickAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const workspaceId = quickPickState.workspaceId;
  const branchList = useAtomValue(
    gitBranchListAtomFamily(workspaceId ?? '')
  );

  // Filtered branches
  const filteredBranches = branchList.branches.filter((b) =>
    b.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Show create option when input doesn't match any branch
  const showCreateOption =
    inputValue.trim() &&
    !branchList.branches.some((b) => b.name === inputValue);

  // Reset state when opening
  useEffect(() => {
    if (quickPickState.visible) {
      setInputValue('');
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [quickPickState.visible]);

  const handleClose = useCallback(() => {
    setQuickPick({ visible: false, inputValue: '' });
  }, [setQuickPick]);

  const handleSelectBranch = useCallback(
    async (branch: GitBranch) => {
      if (!workspaceId) return;

      try {
        await dispatch('git.checkout', {
          workspaceId,
          ref: branch.name,
        });

        // Refresh branch list and git status
        await dispatch('git.branches', { workspaceId });
        await dispatch('git.status', { workspaceId });

        handleClose();
      } catch (error) {
        console.error('Failed to switch branch:', error);
      }
    },
    [workspaceId, dispatch, handleClose]
  );

  const handleCreateBranch = useCallback(
    async (name: string) => {
      if (!workspaceId) return;

      try {
        await dispatch('git.checkout', {
          workspaceId,
          ref: name,
          createBranch: true,
        });

        // Refresh branch list and git status
        await dispatch('git.branches', { workspaceId });
        await dispatch('git.status', { workspaceId });

        handleClose();
      } catch (error) {
        console.error('Failed to create branch:', error);
      }
    },
    [workspaceId, dispatch, handleClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const totalItems = filteredBranches.length + (showCreateOption ? 1 : 0);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (showCreateOption && selectedIndex === filteredBranches.length) {
            handleCreateBranch(inputValue);
          } else if (filteredBranches[selectedIndex]) {
            handleSelectBranch(filteredBranches[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [
      filteredBranches,
      showCreateOption,
      selectedIndex,
      inputValue,
      handleCreateBranch,
      handleSelectBranch,
      handleClose,
    ]
  );

  if (!quickPickState.visible) {
    return null;
  }

  return (
    <div className="branch-quick-pick-overlay" onClick={handleClose}>
      <div
        className="branch-quick-pick"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="branch-search-input"
          placeholder="Search or create branch..."
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />

        <div className="branch-list">
          {filteredBranches.map((branch, index) => (
            <div
              key={branch.name}
              className={`branch-item ${
                index === selectedIndex ? 'selected' : ''
              }`}
              onClick={() => handleSelectBranch(branch)}
            >
              {branch.isCurrent && (
                <Check size={12} className="branch-item-check" />
              )}
              <span className="branch-name">{branch.name}</span>
              {branch.isRemote && (
                <span className="branch-badge">Remote</span>
              )}
            </div>
          ))}

          {showCreateOption && (
            <div
              className={`branch-item create-option ${
                selectedIndex === filteredBranches.length ? 'selected' : ''
              }`}
              onClick={() => handleCreateBranch(inputValue)}
            >
              <Plus size={12} />
              <span>Create branch: {inputValue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit basic QuickPick structure**

```bash
git add packages/web/src/features/workspace/components/branch-quick-pick.tsx
git commit -m "feat(web): create BranchQuickPick component with keyboard navigation"
```

---

### Task 7: Add BranchQuickPick Tests

**Files:**
- Create: `packages/web/src/features/workspace/components/branch-quick-pick.test.tsx`

- [ ] **Step 1: Write tests for BranchQuickPick**

File: `packages/web/src/features/workspace/components/branch-quick-pick.test.tsx`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'jotai';
import { BranchQuickPick } from './branch-quick-pick';
import {
  branchQuickPickAtom,
  gitBranchListAtomFamily,
} from '../../../atoms/git';
import { dispatchCommandAtom } from '../../../atoms/connection';

const mockDispatch = vi.fn();

describe('BranchQuickPick', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockDispatch.mockResolvedValue({ ok: true, data: {} });
  });

  it('filters branches by input', () => {
    const store = {
      get: (atom: any) => {
        if (atom === branchQuickPickAtom) {
          return { visible: true, workspaceId: 'test', inputValue: '' };
        }
        if (atom.toString().includes('gitBranchList')) {
          return {
            current: 'main',
            branches: [
              { name: 'main', isRemote: false, isCurrent: true },
              { name: 'feature-1', isRemote: false, isCurrent: false },
              { name: 'origin/feature-2', isRemote: true, isCurrent: false },
            ],
            loading: false,
          };
        }
        return undefined;
      },
      set: vi.fn(),
    };

    render(
      <Provider store={store as any}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText('Search or create branch...');
    fireEvent.change(input, { target: { value: 'feature' } });

    // Should show feature-1 and origin/feature-2
    expect(screen.getByText('feature-1')).toBeInTheDocument();
    expect(screen.getByText('origin/feature-2')).toBeInTheDocument();
    // Should not show main
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('shows create option for non-existent branch', () => {
    const store = {
      get: (atom: any) => {
        if (atom === branchQuickPickAtom) {
          return { visible: true, workspaceId: 'test', inputValue: '' };
        }
        if (atom.toString().includes('gitBranchList')) {
          return {
            current: 'main',
            branches: [{ name: 'main', isRemote: false, isCurrent: true }],
            loading: false,
          };
        }
        return undefined;
      },
      set: vi.fn(),
    };

    render(
      <Provider store={store as any}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText('Search or create branch...');
    fireEvent.change(input, { target: { value: 'new-branch' } });

    expect(screen.getByText(/Create branch: new-branch/)).toBeInTheDocument();
  });

  it('calls checkout on Enter', async () => {
    const store = {
      get: (atom: any) => {
        if (atom === branchQuickPickAtom) {
          return { visible: true, workspaceId: 'test', inputValue: '' };
        }
        if (atom.toString().includes('gitBranchList')) {
          return {
            current: 'main',
            branches: [
              { name: 'main', isRemote: false, isCurrent: true },
              { name: 'feature-1', isRemote: false, isCurrent: false },
            ],
            loading: false,
          };
        }
        if (atom === dispatchCommandAtom) {
          return mockDispatch;
        }
        return undefined;
      },
      set: vi.fn(),
    };

    render(
      <Provider store={store as any}>
        <BranchQuickPick />
      </Provider>
    );

    const input = screen.getByPlaceholderText('Search or create branch...');
    fireEvent.change(input, { target: { value: 'feature' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith('git.checkout', {
        workspaceId: 'test',
        ref: 'feature-1',
      });
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/web && npm test -- branch-quick-pick.test.tsx`

Expected: PASS

- [ ] **Step 3: Commit tests**

```bash
git add packages/web/src/features/workspace/components/branch-quick-pick.test.tsx
git commit -m "test(web): add BranchQuickPick component tests"
```

---

## Phase 4: Styling

### Task 8: Add Quick Pick Styles

**Files:**
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add Quick Pick styles**

File: `packages/web/src/styles/components.css`

Add at the end of the file:

```css
/* ========== Branch Quick Pick ========== */

.branch-quick-pick-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: var(--sp-16);
  z-index: var(--z-modal-backdrop);
  animation: fadeIn var(--duration-fast) var(--ease-out);
}

.branch-quick-pick {
  width: 100%;
  max-width: 440px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: slideInUp var(--duration-normal) var(--ease-out);
}

.branch-search-input {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: transparent;
  border: none;
  font-size: var(--text-base);
  color: var(--text-primary);
  outline: none;
  width: 100%;
}

.branch-search-input::placeholder {
  color: var(--text-tertiary);
}

.branch-list {
  max-height: 280px;
  overflow-y: auto;
}

.branch-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease-out);
}

.branch-item:hover,
.branch-item.selected {
  background: var(--bg-surface-hover);
}

.branch-item-check {
  flex-shrink: 0;
  color: var(--text-primary);
}

.branch-name {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.branch-badge {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--bg-surface-elevated);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--radius-sm);
}

.branch-item.create-option {
  border-top: 1px solid var(--border);
  color: var(--text-accent);
}

.branch-item.create-option:hover {
  background: var(--bg-accent-subtle);
}

/* Toolbar Button */
.branch-picker-btn {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-2);
}

.branch-picker-btn .branch-name {
  font-size: var(--text-xs);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Verify styles compile**

Run: `cd packages/web && npm run build:styles`

Expected: No errors

- [ ] **Step 3: Commit styles**

```bash
git add packages/web/src/styles/components.css
git commit -m "style(web): add Branch Quick Pick styles"
```

---

## Phase 5: Integration

### Task 9: Integrate BranchPickerButton into GitPanel

**Files:**
- Modify: `packages/web/src/features/workspace/components/git-panel.tsx`

- [ ] **Step 1: Import BranchPickerButton**

File: `packages/web/src/features/workspace/components/git-panel.tsx`

Add to imports at the top:

```typescript
import { BranchPickerButton } from './branch-picker-button';
import { BranchQuickPick } from './branch-quick-pick';
import { GitBranch } from 'lucide-react';
```

- [ ] **Step 2: Add button to toolbar**

In the GitPanel component, modify the toolbar section (around line 355):

```typescript
<div className="panel-toolbar git-panel-toolbar">
  <div className="git-toolbar-cluster">
    {/* NEW: Branch Picker Button */}
    <BranchPickerButton workspaceId={workspaceId} />

    <button
      className="panel-toolbar-btn"
      onClick={() => void loadGitStatus()}
      disabled={isLoading}
      title="Refresh"
      type="button"
    >
      <RefreshCw size={14} className={isLoading ? 'spin' : undefined} />
    </button>
    {/* ... rest of toolbar buttons ... */}
  </div>
</div>
```

- [ ] **Step 3: Add BranchQuickPick to render**

At the end of the GitPanel return statement (before closing `</div>`):

```typescript
      <GitDiscardConfirmModal
        discard={pendingDiscard}
        onCancel={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
      />

      {/* NEW: Branch Quick Pick */}
      <BranchQuickPick />
    </div>
  );
};
```

- [ ] **Step 4: Test integration**

Run: `cd packages/web && npm run dev`

Manual test:
1. Open workspace
2. Verify branch button appears in Git Panel toolbar
3. Click button - Quick Pick should appear
4. Test keyboard navigation

- [ ] **Step 5: Commit integration**

```bash
git add packages/web/src/features/workspace/components/git-panel.tsx
git commit -m "feat(web): integrate BranchPickerButton into GitPanel"
```

---

### Task 10: Add Branch Loading Logic

**Files:**
- Modify: `packages/web/src/features/workspace/components/git-panel.tsx`

- [ ] **Step 1: Add branch loading function**

File: `packages/web/src/features/workspace/components/git-panel.tsx`

Add after the `loadGitStatus` function:

```typescript
const loadBranchList = useCallback(async () => {
  if (!workspaceId || isLoadingRef.current) {
    return;
  }

  isLoadingRef.current = true;

  try {
    const result = await dispatch<{ branches: GitBranch[], current: string }>(
      'git.branches',
      { workspaceId }
    );

    if (!result.ok || !result.data) {
      console.error('Failed to load branch list:', result.error?.message);
      return;
    }

    setBranchList(result.data);
  } finally {
    isLoadingRef.current = false;
  }
}, [dispatch, workspaceId, setBranchList]);
```

- [ ] **Step 2: Add setBranchList callback**

Add after the `setDiffPreview` callback:

```typescript
const setBranchList = useCallback(
  (list: { branches: GitBranch[], current: string } | null) => {
    store.set(gitBranchListAtomFamily(workspaceId), {
      branches: list?.branches ?? [],
      current: list?.current ?? '',
      loading: false,
    });
  },
  [store, workspaceId]
);
```

- [ ] **Step 3: Load branches on mount**

Add to the useEffect that loads git state:

```typescript
useEffect(() => {
  if (!gitState && !isLoadingRef.current) {
    void loadGitStatus();
    void loadBranchList();  // NEW: Load branches
  }
}, [gitState, loadGitStatus, loadBranchList]);
```

- [ ] **Step 4: Import GitBranch type**

Add to imports:

```typescript
import type { GitBranch, GitFileChange, GitStatus } from '@coder-studio/core';
```

- [ ] **Step 5: Test branch loading**

Run: `cd packages/web && npm run dev`

Manual test:
1. Open workspace with git repo
2. Verify branch button shows current branch name
3. Click button - branch list should appear

- [ ] **Step 6: Commit branch loading**

```bash
git add packages/web/src/features/workspace/components/git-panel.tsx
git commit -m "feat(web): add branch list loading to GitPanel"
```

---

## Phase 6: E2E Testing

### Task 11: Create E2E Tests

**Files:**
- Create: `e2e/specs/git-branch-switching.spec.ts`

- [ ] **Step 1: Write E2E test**

File: `e2e/specs/git-branch-switching.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Git Branch Switching', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to workspace with git repo
    await page.goto('/');
    // TODO: Setup test workspace with git repo
  });

  test('switches to existing local branch', async ({ page }) => {
    // 1. Open Git Panel
    await page.click('[data-testid="git-panel-toggle"]');

    // 2. Click branch picker button
    await page.click('.branch-picker-btn');

    // 3. Wait for Quick Pick to appear
    await page.waitForSelector('.branch-quick-pick');

    // 4. Select a branch
    await page.click('.branch-item:has-text("feature-1")');

    // 5. Verify branch switched
    await page.waitForSelector('.branch-picker-btn:has-text("feature-1")');
  });

  test('creates and switches to new branch', async ({ page }) => {
    // 1. Open branch picker
    await page.click('[data-testid="git-panel-toggle"]');
    await page.click('.branch-picker-btn');

    // 2. Type new branch name
    await page.fill('.branch-search-input', 'new-test-branch');

    // 3. Wait for create option to appear
    await page.waitForSelector('.branch-item.create-option');

    // 4. Click create
    await page.click('.branch-item.create-option');

    // 5. Verify new branch created and switched
    await page.waitForSelector('.branch-picker-btn:has-text("new-test-branch")');
  });

  test('filters branches by input', async ({ page }) => {
    await page.click('[data-testid="git-panel-toggle"]');
    await page.click('.branch-picker-btn');

    await page.fill('.branch-search-input', 'feature');

    // Should show branches matching "feature"
    const items = await page.$$('.branch-item:not(.create-option)');
    expect(items.length).toBeGreaterThan(0);

    // All visible items should contain "feature"
    for (const item of items) {
      const text = await item.textContent();
      expect(text?.toLowerCase()).toContain('feature');
    }
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run: `cd e2e && npm test -- git-branch-switching.spec.ts`

Expected: Tests pass (may need test workspace setup)

- [ ] **Step 3: Commit E2E tests**

```bash
git add e2e/specs/git-branch-switching.spec.ts
git commit -m "test(e2e): add git branch switching integration tests"
```

---

## Phase 7: Final Verification

### Task 12: Manual Testing & Polish

**Files:**
- Test manually

- [ ] **Step 1: Test all features**

Manual checklist:
- [ ] Branch button shows current branch
- [ ] Click opens Quick Pick
- [ ] Input filters branches
- [ ] Keyboard navigation works (↑↓ Enter Esc)
- [ ] Switching local branch works
- [ ] Switching remote branch creates tracking branch
- [ ] Creating new branch works
- [ ] Quick Pick closes after selection
- [ ] Git Panel refreshes after switch
- [ ] Styles match design
- [ ] Animations work smoothly

- [ ] **Step 2: Test edge cases**

Edge cases:
- [ ] Detached HEAD state
- [ ] No branches (empty repo)
- [ ] Many branches (scroll behavior)
- [ ] Special characters in branch names
- [ ] Network timeout on remote branch fetch
- [ ] Uncommitted changes conflict

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete git branch switcher implementation

- Add Quick Pick-style branch switching UI
- Support local and remote branches
- Enable branch creation from Quick Pick
- Add full keyboard navigation
- Include comprehensive tests"
```

---

## Completion Checklist

Before marking complete:

- [ ] All tests pass (unit + E2E)
- [ ] TypeScript compiles without errors
- [ ] Manual testing complete
- [ ] Edge cases tested
- [ ] Code follows project style guide
- [ ] No console.log statements in production code
- [ ] Documentation updated if needed
- [ ] Git commits are atomic and well-named

---

## Post-Implementation

After completion:

1. Run `git log --oneline -20` to review commit history
2. Push branch: `git push origin feature/git-branch-switcher`
3. Create Pull Request with:
   - Summary of changes
   - Test plan
   - Screenshots if applicable
4. Request code review
5. Address review feedback
6. Merge when approved
