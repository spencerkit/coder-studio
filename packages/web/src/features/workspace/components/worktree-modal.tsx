/**
 * Worktree Modal Component (Phase 3)
 *
 * Modal dialog for inspecting Git worktrees.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import type { WorktreeInfo, GitStatus, FileNode } from '@coder-studio/core';
import { wsClientAtom } from '../../../atoms/connection';
import { useViewport } from '../../../hooks/use-viewport';
import { MobileSheet } from '../../../shells/mobile-shell/mobile-sheet';

type TabType = 'status' | 'diff' | 'tree';

interface WorktreeModalProps {
  worktree: WorktreeInfo | null;
  onClose: () => void;
}

export function WorktreeModal({ worktree, onClose }: WorktreeModalProps) {
  const wsClient = useAtomValue(wsClientAtom);
  const isMobile = useViewport() === 'mobile';
  const [activeTab, setActiveTab] = useState<TabType>('status');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worktree || !wsClient) {
      setStatus(null);
      setDiff('');
      setTree([]);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        if (activeTab === 'status') {
          const result = await wsClient.sendCommand<{ status: GitStatus }>(
            'worktree.status',
            { worktreePath: worktree.path }
          );
          setStatus(result.status);
        } else if (activeTab === 'diff') {
          const result = await wsClient.sendCommand<{ diff: string }>(
            'worktree.diff',
            { worktreePath: worktree.path }
          );
          setDiff(result.diff);
        } else if (activeTab === 'tree') {
          const result = await wsClient.sendCommand<{ tree: FileNode[] }>(
            'worktree.tree',
            { worktreePath: worktree.path }
          );
          setTree(result.tree);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [worktree, activeTab, wsClient]);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  if (!worktree) {
    return null;
  }

  const worktreeSummary = (
    <div className="worktree-chips">
      <span className="worktree-chip worktree-chip-branch">
        🌿 {worktree.branch}
      </span>
      <span className="worktree-chip worktree-chip-path">
        📁 {worktree.path}
      </span>
      <span
        className={`worktree-chip worktree-chip-status ${
          worktree.status === 'clean' ? 'worktree-clean' : 'worktree-dirty'
        }`}
      >
        {worktree.status === 'clean' ? '✓ Clean' : '● Dirty'}
      </span>
    </div>
  );

  const worktreeTabs = (
    <div className={`modal-tabs${isMobile ? ' mobile-worktree-sheet__tabs' : ''}`}>
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

  const worktreeContent = (
    <div className="modal-body worktree-content">
      {error && (
        <div className="worktree-error">{error}</div>
      )}
      {loading ? (
        <div className="worktree-loading">Loading...</div>
      ) : (
        <>
          {activeTab === 'status' && (
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
              {status && (
                <div className="worktree-changes">
                  <h4>Changes</h4>
                  {status.staged.length > 0 && (
                    <div className="worktree-change-group">
                      <span>Staged: {status.staged.length}</span>
                    </div>
                  )}
                  {status.modified.length > 0 && (
                    <div className="worktree-change-group">
                      <span>Modified: {status.modified.length}</span>
                    </div>
                  )}
                  {status.untracked.length > 0 && (
                    <div className="worktree-change-group">
                      <span>Untracked: {status.untracked.length}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'diff' && (
            <div className="worktree-diff-tab">
              {diff ? (
                <pre className="worktree-diff-output">{diff}</pre>
              ) : (
                <div className="worktree-empty">No changes</div>
              )}
            </div>
          )}

          {activeTab === 'tree' && (
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
          )}
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <MobileSheet
        kicker="WORKTREE"
        title={worktree.name}
        body={(
          <div className="mobile-worktree-sheet">
            <div className="mobile-worktree-sheet__summary">{worktreeSummary}</div>
            {worktreeTabs}
            <div className="mobile-worktree-sheet__content">{worktreeContent}</div>
          </div>
        )}
        bodyClassName="mobile-sheet__body--flush"
        contentClassName="mobile-sheet--worktree"
        onClose={onClose}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card modal-card-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="worktree-header-info">
            <h3>{worktree.name}</h3>
            {worktreeSummary}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {worktreeTabs}
        {worktreeContent}
      </div>
    </div>
  );
}
