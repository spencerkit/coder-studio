/**
 * Workspace Page Feature
 *
 * Main workspace view with left panel (file tree/git), central panel (agent panes),
 * and bottom panel (terminal). All panels are resizable.
 */

import type { FC } from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { GitBranch, RefreshCw } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { focusModeAtom, leftPanelWidthAtom, bottomPanelHeightAtom } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';
import { TopBar } from '../topbar';
import { AgentPanes } from '../agent-panes';
import { TerminalPanel } from '../terminal-panel';
import { FileTreePanel } from './components/file-tree';
import { GitPanel } from './components/git-panel';

/** Minimum panel sizes in pixels */
const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 600;
const MIN_BOTTOM_HEIGHT = 100;
const MAX_BOTTOM_HEIGHT = 400;
const DIVIDER_SIZE = 8;

/**
 * Workspace Page
 *
 * PRD §7:
 *   - Layout: TopBar | Left panel | Central panel | Bottom panel
 *   - Left panel: File tree / Git diff switcher (resizable)
 *   - Central: Agent pane tree (multiple sessions)
 *   - Bottom: Terminal panel (resizable)
 */
export const WorkspacePage: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const focusMode = useAtomValue(focusModeAtom);
  const [leftPanelWidth, setLeftPanelWidth] = useAtom(leftPanelWidthAtom);
  const [bottomPanelHeight, setBottomPanelHeight] = useAtom(bottomPanelHeightAtom);

  // Sidebar tab state
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');

  // Resizer drag state
  const leftResizerRef = useRef<HTMLDivElement>(null);
  const bottomResizerRef = useRef<HTMLDivElement>(null);
  const isDraggingLeft = useRef(false);
  const isDraggingBottom = useRef(false);

  // Left panel resize handlers
  const handleLeftMouseDown = useCallback(() => {
    isDraggingLeft.current = true;
    document.body.classList.add('is-resizing-panels');
  }, []);

  const handleLeftMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingLeft.current) return;
    const newWidth = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, e.clientX));
    setLeftPanelWidth(newWidth);
  }, [setLeftPanelWidth]);

  const handleLeftMouseUp = useCallback(() => {
    isDraggingLeft.current = false;
    document.body.classList.remove('is-resizing-panels');
  }, []);

  // Bottom panel resize handlers
  const handleBottomMouseDown = useCallback(() => {
    isDraggingBottom.current = true;
    document.body.classList.add('is-resizing-panels');
  }, []);

  const handleBottomMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingBottom.current) return;
    const newHeight = Math.max(
      MIN_BOTTOM_HEIGHT,
      Math.min(MAX_BOTTOM_HEIGHT, window.innerHeight - e.clientY)
    );
    setBottomPanelHeight(newHeight);
  }, [setBottomPanelHeight]);

  const handleBottomMouseUp = useCallback(() => {
    isDraggingBottom.current = false;
    document.body.classList.remove('is-resizing-panels');
  }, []);

  // Setup event listeners for resize
  useEffect(() => {
    document.addEventListener('mousemove', handleLeftMouseMove);
    document.addEventListener('mousemove', handleBottomMouseMove);
    document.addEventListener('mouseup', handleLeftMouseUp);
    document.addEventListener('mouseup', handleBottomMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleLeftMouseMove);
      document.removeEventListener('mousemove', handleBottomMouseMove);
      document.removeEventListener('mouseup', handleLeftMouseUp);
      document.removeEventListener('mouseup', handleBottomMouseUp);
    };
  }, [handleLeftMouseMove, handleLeftMouseUp, handleBottomMouseMove, handleBottomMouseUp]);

  if (!workspace) {
    return (
      <div className="workspace-page workspace-page-empty">
        <TopBar />
        <div className="workspace-empty-content">
          <p>{t('workspace.no_workspace')}</p>
        </div>
      </div>
    );
  }

  // Calculate grid template areas based on focus mode
  const gridTemplateColumns = focusMode
    ? '1fr'
    : `${leftPanelWidth}px ${DIVIDER_SIZE}px 1fr`;

  const gridTemplateRows = focusMode
    ? 'var(--topbar-height) 1fr'
    : `var(--topbar-height) 1fr ${DIVIDER_SIZE}px ${bottomPanelHeight}px`;

  return (
    <div
      className={`workspace-page ${focusMode ? 'workspace-page-focus' : ''}`}
      style={{
        gridTemplateColumns,
        gridTemplateRows,
      }}
    >
      {/* TopBar - always visible */}
      <TopBar />

      {/* Left panel - hidden in focus mode */}
      {!focusMode && (
        <>
          <aside className="left-panel">
            <div className="panel-header">
              <div className="panel-kicker">REPOSITORY NAVIGATOR</div>
              <div className="panel-branch">
                <GitBranch size={12} />
                <span>main</span>
              </div>
              <div className="panel-tabs">
                <button
                  className={`panel-tab ${activeTab === 'files' ? 'active' : ''}`}
                  onClick={() => setActiveTab('files')}
                >
                  Files
                </button>
                <button
                  className={`panel-tab ${activeTab === 'git' ? 'active' : ''}`}
                  onClick={() => setActiveTab('git')}
                >
                  Git Diff
                </button>
              </div>
            </div>

            <div className="panel-toolbar">
              <button className="panel-toolbar-btn" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>

            <div className="file-tree">
              {activeTab === 'files' ? (
                <FileTreePanel workspaceId={workspace.id} />
              ) : (
                <GitPanel workspaceId={workspace.id} />
              )}
            </div>
          </aside>

          {/* Left panel resizer */}
          <div
            ref={leftResizerRef}
            className="workspace-resizer workspace-resizer-vertical"
            onMouseDown={handleLeftMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
          />
        </>
      )}

      {/* Central panel - Agent Panes */}
      <main className="center-area workspace-main-area">
        <AgentPanes />
      </main>

      {/* Bottom panel - hidden in focus mode */}
      {!focusMode && (
        <>
          {/* Bottom panel resizer */}
          <div
            ref={bottomResizerRef}
            className="workspace-resizer workspace-resizer-horizontal"
            onMouseDown={handleBottomMouseDown}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize bottom panel"
          />

          <footer className="bottom-terminal">
            <TerminalPanel />
          </footer>
        </>
      )}
    </div>
  );
};

export default WorkspacePage;
