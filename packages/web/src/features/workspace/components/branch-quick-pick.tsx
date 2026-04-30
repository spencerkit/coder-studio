/**
 * Branch Quick Pick Component
 *
 * Quick pick overlay for switching branches and creating new branches.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { Check, Plus } from 'lucide-react';
import {
  branchQuickPickAtom,
  gitBranchListAtomFamily,
  gitStateAtomFamily,
} from '../../../atoms/git';
import { dispatchCommandAtom } from '../../../atoms/connection';
import type { GitBranch, GitStatus } from '@coder-studio/core';

interface GitCheckoutResult {
  success: boolean;
  message: string;
  branch?: string;
}

export function BranchQuickPick() {
  const quickPickState = useAtomValue(branchQuickPickAtom);
  const setQuickPick = useSetAtom(branchQuickPickAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const store = useStore();

  const workspaceId = quickPickState.workspaceId;
  const branchList = useAtomValue(
    gitBranchListAtomFamily(workspaceId ?? '')
  );

  const [inputValue, setInputValue] = useState(quickPickState.inputValue);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingCreateBranchName, setPendingCreateBranchName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync input state
  useEffect(() => {
    setInputValue(quickPickState.inputValue);
  }, [quickPickState.inputValue]);

  // Focus input on mount
  useEffect(() => {
    if (quickPickState.visible) {
      inputRef.current?.focus();
      setSelectedIndex(0);
      setPendingCreateBranchName(null);
    }
  }, [quickPickState.visible]);

  const trimmedInput = inputValue.trim();

  const filteredBranches = branchList.branches.filter((branch) =>
    branch.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  // Check if input matches an existing branch
  const exactMatch = filteredBranches.find(
    (branch) => branch.name.toLowerCase() === inputValue.toLowerCase()
  );

  // Determine display items
  const displayItems: Array<{
    type: 'branch' | 'create' | 'confirm-create';
    branch?: (typeof filteredBranches)[0];
    label: string;
  }> = [];

  // Add filtered branches
  filteredBranches.forEach((branch) => {
    displayItems.push({
      type: 'branch',
      branch,
      label: branch.name,
    });
  });

  // Add "Create branch" option if no exact match and input is not empty
  if (!exactMatch && trimmedInput && !branchList.loading) {
    displayItems.push({
      type:
        pendingCreateBranchName === trimmedInput
          ? 'confirm-create'
          : 'create',
      label:
        pendingCreateBranchName === trimmedInput
          ? `Confirm create branch: ${trimmedInput}`
          : `Create branch: ${trimmedInput}`,
    });
  }

  // Close handler
  const handleClose = useCallback(() => {
    setPendingCreateBranchName(null);
    setQuickPick({
      visible: false,
      inputValue: '',
    });
  }, [setQuickPick]);

  const refreshBranchState = useCallback(async () => {
    if (!workspaceId) return false;

    const [branchResult, statusResult] = await Promise.all([
      dispatch<{ current: string; branches: GitBranch[] }>('git.branches', {
        workspaceId,
      }),
      dispatch<GitStatus>('git.status', {
        workspaceId,
      }),
    ]);

    if (branchResult.ok && branchResult.data) {
      store.set(gitBranchListAtomFamily(workspaceId), {
        current: branchResult.data.current,
        branches: branchResult.data.branches,
        loading: false,
      });
    }

    if (statusResult.ok && statusResult.data) {
      store.set(gitStateAtomFamily(workspaceId), statusResult.data);
    }

    return branchResult.ok && statusResult.ok;
  }, [dispatch, store, workspaceId]);

  const handleRequestBranchCreate = useCallback((branchName: string) => {
    if (!branchName) {
      return;
    }

    setPendingCreateBranchName(branchName);
  }, []);

  // Handle branch selection
  const handleBranchSelect = useCallback(
    async (branchName: string) => {
      if (!workspaceId) return;

      const result = await dispatch<GitCheckoutResult>('git.checkout', {
        workspaceId,
        ref: branchName,
      });

      if (!result.ok || !result.data?.success) {
        console.error(
          'Failed to checkout branch:',
          result.error?.message ?? result.data?.message
        );
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, refreshBranchState, workspaceId]
  );

  // Handle branch creation
  const handleBranchCreate = useCallback(
    async (branchName: string) => {
      if (!workspaceId || !branchName) return;

      const result = await dispatch<GitCheckoutResult>('git.checkout', {
        workspaceId,
        ref: branchName,
        createBranch: true,
      });

      if (!result.ok || !result.data?.success) {
        console.error(
          'Failed to create branch:',
          result.error?.message ?? result.data?.message
        );
        return;
      }

      await refreshBranchState();
      handleClose();
    },
    [dispatch, handleClose, refreshBranchState, workspaceId]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setSelectedIndex((prev) =>
            prev < displayItems.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          event.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          event.preventDefault();
          if (displayItems[selectedIndex]) {
            const item = displayItems[selectedIndex];
            if (item.type === 'branch' && item.branch) {
              void handleBranchSelect(item.branch.name);
            } else if (item.type === 'create') {
              handleRequestBranchCreate(trimmedInput);
            } else if (item.type === 'confirm-create') {
              void handleBranchCreate(trimmedInput);
            }
          }
          break;
        case 'Escape':
          event.preventDefault();
          handleClose();
          break;
      }
    },
    [
      displayItems,
      selectedIndex,
      handleBranchCreate,
      handleBranchSelect,
      handleClose,
      handleRequestBranchCreate,
      trimmedInput,
    ]
  );

  // Handle overlay click
  const handleOverlayClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `.branch-quick-pick-item:nth-child(${selectedIndex + 1})`
      );
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!quickPickState.visible) {
    return null;
  }

  return (
    <div className="branch-quick-pick-overlay" onClick={handleOverlayClick}>
      <div className="branch-quick-pick">
        {/* Search Input */}
        <div className="branch-quick-pick-search">
          <input
            ref={inputRef}
            type="text"
            className="branch-quick-pick-input"
            placeholder="Search branches or create new branch..."
            value={inputValue}
            onChange={(event) => {
              setInputValue(event.target.value);
              setPendingCreateBranchName(null);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Branch List */}
        <div className="branch-quick-pick-list" ref={listRef}>
          {branchList.loading ? (
            <div className="branch-quick-pick-empty">Loading branches...</div>
          ) : displayItems.length > 0 ? (
            displayItems.map((item, index) => (
              <div
                key={item.type === 'branch' ? item.branch?.name : 'create'}
                className={`branch-quick-pick-item ${
                  index === selectedIndex ? 'branch-quick-pick-item-selected' : ''
                }`}
                onClick={() => {
                  if (item.type === 'branch' && item.branch) {
                    void handleBranchSelect(item.branch.name);
                  } else if (item.type === 'create') {
                    handleRequestBranchCreate(trimmedInput);
                  } else if (item.type === 'confirm-create') {
                    void handleBranchCreate(trimmedInput);
                  }
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {item.type === 'branch' && item.branch ? (
                  <>
                    {/* Current branch indicator */}
                    {item.branch.isCurrent && (
                      <span className="branch-quick-pick-check">
                        <Check size={14} />
                      </span>
                    )}

                    {/* Branch name */}
                    <span className="branch-quick-pick-name">
                      {item.branch.name}
                    </span>

                    {/* Remote badge */}
                    {item.branch.isRemote && (
                      <span className="branch-quick-pick-badge">Remote</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="branch-quick-pick-create-icon">
                      <Plus size={14} />
                    </span>
                    <span className="branch-quick-pick-create-label">
                      {item.label}
                    </span>
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="branch-quick-pick-empty">
              {inputValue
                ? 'No branches found'
                : 'Type to search branches'}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="branch-quick-pick-hint">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
