/**
 * Worktree Modal Component (Phase 3)
 *
 * Modal dialog for inspecting Git worktrees.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WorktreeInfo, GitStatus, FileNode } from '@coder-studio/core';

type TabType = 'status' | 'diff' | 'tree';

interface WorktreeModalProps {
  worktree: WorktreeInfo | null;
  onClose: () => void;
}

export function WorktreeModal({ worktree, onClose }: WorktreeModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('status');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch data when worktree changes
  useEffect(() => {
    if (!worktree) {
      setStatus(null);
      setDiff('');
      setTree([]);
      return;
    }

    setLoading(true);

    // Fetch based on active tab
    const fetchData = async () => {
      try {
        if (activeTab === 'status') {
          // TODO: Call worktree.status command via WebSocket
          console.log('Fetch status for:', worktree.path);
        } else if (activeTab === 'diff') {
          // TODO: Call worktree.diff command
          console.log('Fetch diff for:', worktree.path);
        } else if (activeTab === 'tree') {
          // TODO: Call worktree.tree command
          console.log('Fetch tree for:', worktree.path);
        }
      } catch (error) {
        console.error('Failed to fetch worktree data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [worktree, activeTab]);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  if (!worktree) {
    return null;
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
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
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

        {/* Content */}
        <div className="modal-body worktree-content">
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
      </div>
    </div>
  );
}
