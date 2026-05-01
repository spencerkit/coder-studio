import type { WorktreeInfo } from '@coder-studio/core';
import { useViewport } from '../../../../hooks/use-viewport';
import { MobileSheet } from '../../../../shells/mobile-shell/mobile-sheet';
import { useWorktreeActions } from '../../actions/use-workspace-launch-actions';

type TabType = 'status' | 'diff' | 'tree';

interface WorktreeModalProps {
  worktree: WorktreeInfo | null;
  onClose: () => void;
}

export function WorktreeModal({ worktree, onClose }: WorktreeModalProps) {
  const isMobile = useViewport() === 'mobile';
  const { activeTab, diff, error, handleTabChange, loading, status, tree } = useWorktreeActions(worktree);

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
      {(['status', 'diff', 'tree'] as TabType[]).map((tab) => (
        <button
          key={tab}
          className={`modal-tab ${activeTab === tab ? 'active' : ''}`}
          onClick={() => handleTabChange(tab)}
        >
          {tab === 'status' ? 'Status' : tab === 'diff' ? 'Diff' : 'Tree'}
        </button>
      ))}
    </div>
  );

  const worktreeContent = (
    <div className="modal-body worktree-content">
      {error && <div className="worktree-error">{error}</div>}
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card modal-card-lg" onClick={(event) => event.stopPropagation()}>
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
