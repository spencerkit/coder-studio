import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, Plus } from 'lucide-react';
import { useBranchQuickPickActions } from '../../actions/use-git-actions';

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
    selectedIndex,
    setInputValue,
    setPendingCreateBranchName,
    setSelectedIndex,
    trimmedInput,
  } = useBranchQuickPickActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (quickPickState.visible) {
      inputRef.current?.focus();
    }
  }, [quickPickState.visible]);

  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `.branch-quick-pick-item:nth-child(${selectedIndex + 1})`
      );
      selectedElement?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => (prev < displayItems.length - 1 ? prev + 1 : prev));
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
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  if (!quickPickState.visible) {
    return null;
  }

  return (
    <div className="branch-quick-pick-overlay" onClick={handleOverlayClick}>
      <div className="branch-quick-pick">
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
                    {item.branch.isCurrent && (
                      <span className="branch-quick-pick-check">
                        <Check size={14} />
                      </span>
                    )}

                    <span className="branch-quick-pick-name">{item.branch.name}</span>

                    {item.branch.isRemote && (
                      <span className="branch-quick-pick-badge">Remote</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="branch-quick-pick-create-icon">
                      <Plus size={14} />
                    </span>
                    <span className="branch-quick-pick-create-label">{item.label}</span>
                  </>
                )}
              </div>
            ))
          ) : (
            <div className="branch-quick-pick-empty">
              {inputValue ? 'No branches found' : 'Type to search branches'}
            </div>
          )}
        </div>

        <div className="branch-quick-pick-hint">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
