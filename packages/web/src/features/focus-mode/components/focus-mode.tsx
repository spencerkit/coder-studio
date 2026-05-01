/**
 * Focus Mode Component
 *
 * Hides non-essential UI elements for distraction-free work.
 */

import { useEffect, useCallback } from 'react';
import { useAtom } from 'jotai';
import {
  focusModeAtom,
  leftPanelWidthAtom,
  bottomPanelHeightAtom,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from '../../workspace/atoms';

/**
 * Focus Mode
 *
 * PRD §14:
 *   - Hides top bar, left sidebar, bottom terminal panel
 *   - Activated by F key (when not in text input)
 *   - Deactivated by Escape key
 *   - Expands agent workspace to fill available space
 *
 * This component doesn't render anything visible.
 * It applies CSS classes and handles keyboard shortcuts.
 */
export function FocusMode() {
  const [focusMode, setFocusMode] = useAtom(focusModeAtom);
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [terminalPanelVisible, setTerminalPanelVisible] = useAtom(terminalPanelVisibleAtom);

  // Store pre-focus state to restore later
  const savedState = {
    leftPanelWidth,
    bottomPanelHeight,
    sidebarCollapsed,
  };

  // Apply focus mode effects
  useEffect(() => {
    if (focusMode) {
      // Hide panels
      setLeftPanelWidth(0);
      setBottomPanelHeight(0);
      setSidebarCollapsed(true);
    } else {
      // Restore panels
      setLeftPanelWidth(savedState.leftPanelWidth || 280);
      setBottomPanelHeight(savedState.bottomPanelHeight || 200);
      setSidebarCollapsed(savedState.sidebarCollapsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, setLeftPanelWidth, setBottomPanelHeight, setSidebarCollapsed]);

  // Global keyboard shortcut (F key)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only respond to F key when not in a text input
      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (e.key === 'f' && !isTextInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocusMode(!focusMode);
      }

      // Ctrl+` toggles terminal panel visibility
      if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (terminalPanelVisible) {
          setTerminalPanelVisible(false);
        } else {
          setTerminalPanelVisible(true);
          if (bottomPanelHeight === 0) {
            setBottomPanelHeight(200);
          }
        }
      }

      // Escape key exits focus mode
      if (e.key === 'Escape' && focusMode) {
        e.preventDefault();
        setFocusMode(false);
      }
    },
    [focusMode, setFocusMode, terminalPanelVisible, setTerminalPanelVisible, bottomPanelHeight, setBottomPanelHeight]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Apply CSS class to body for focus mode styling
  useEffect(() => {
    if (focusMode) {
      document.body.classList.add('focus-mode-active');
    } else {
      document.body.classList.remove('focus-mode-active');
    }

    return () => {
      document.body.classList.remove('focus-mode-active');
    };
  }, [focusMode]);

  // This component doesn't render anything visible
  return null;
}

export default FocusMode;
