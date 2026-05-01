import { Home, ArrowUp, Folder, Loader2, X } from 'lucide-react';
import { useViewport } from '../../../../hooks/use-viewport';
import { MobileSheet } from '../../../../shells/mobile-shell/mobile-sheet';
import { useWorkspaceLaunchActions } from '../../actions/use-workspace-launch-actions';

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const isMobile = useViewport() === 'mobile';
  const {
    browsing,
    currentPath,
    directories,
    error,
    getShortPath,
    handleNavigate,
    handleOpen,
    handleSelect,
    launchChoice,
    launchTitle,
    loading,
    parentPath,
    rootPaths,
    selectedPath,
  } = useWorkspaceLaunchActions(onClose);

  const launchBody = (
    <div className="launch-body">
      <div className="launch-choice-row">
        <div className={`launch-choice ${launchChoice === 'local' ? 'active' : ''}`}>
          <div className="launch-choice-title">Local Folder</div>
          <div className="launch-choice-desc">Select a directory on your machine</div>
        </div>
        <div className="launch-choice disabled">
          <div className="launch-choice-title">Remote Git</div>
          <div className="launch-choice-desc">Clone a repository (Coming Soon)</div>
        </div>
      </div>

      <div className="folder-picker">
        <div className="fp-toolbar">
          <button className="fp-btn" onClick={() => handleNavigate('~')}>
            <Home size={12} />
            Home Directory
          </button>
          {parentPath && (
            <button className="fp-btn" onClick={() => handleNavigate(parentPath)}>
              <ArrowUp size={12} />
              Go Up
            </button>
          )}
        </div>

        <div className="fp-root-chips">
          {rootPaths.map((rp) => (
            <span
              key={rp}
              className={`fp-chip ${currentPath === rp ? 'active' : ''}`}
              onClick={() => handleNavigate(rp)}
            >
              {rp}
            </span>
          ))}
          {currentPath && !rootPaths.includes(currentPath) && (
            <span className="fp-chip active">{getShortPath(currentPath)}</span>
          )}
        </div>

        <div className="fp-dir-list">
          {browsing ? (
            <div className="directory-loading">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : directories.length === 0 ? (
            <div className="directory-empty">No directories found</div>
          ) : (
            directories.map((dir) => (
              <div
                key={dir.path}
                className={`fp-dir ${selectedPath === dir.path ? 'selected' : ''}`}
                onClick={() => handleSelect(dir.path)}
                onDoubleClick={() => handleNavigate(dir.path)}
              >
                <span className="fp-dir-icon">
                  <Folder size={14} />
                </span>
                <span className={`fp-dir-name ${selectedPath === dir.path ? 'selected' : ''}`}>
                  {dir.name}
                </span>
                {dir.itemCount !== undefined && (
                  <span className="fp-dir-hint">{dir.itemCount} items</span>
                )}
                {selectedPath === dir.path && (
                  <button
                    className="fp-dir-action"
                    type="button"
                    aria-label={`Enter ${dir.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleNavigate(dir.path);
                    }}
                  >
                    Enter folder →
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {error && <div className="form-error" style={{ marginTop: 'var(--sp-3)' }}>{error}</div>}
    </div>
  );

  const launchFooter = (
    <div className="mobile-launch-sheet__footer">
      <button className="btn btn-secondary" onClick={onClose}>
        取消
      </button>
      <button
        className="launch-start-btn"
        onClick={() => void handleOpen()}
        disabled={loading || !selectedPath}
      >
        {loading ? 'Starting...' : 'Start Workspace'}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <MobileSheet
        kicker="START WORKSPACE"
        title={launchTitle}
        body={launchBody}
        footer={launchFooter}
        bodyClassName="mobile-launch-sheet"
        contentClassName="mobile-sheet--launch"
        onClose={onClose}
      />
    );
  }

  return (
    <div className="launch-overlay" onClick={onClose}>
      <div className="launch-modal" onClick={(event) => event.stopPropagation()}>
        <div className="launch-header">
          <div className="launch-header-left">
            <div className="launch-kicker">START WORKSPACE</div>
            <div className="launch-title">{launchTitle}</div>
            <div className="launch-hint">
              {launchChoice === 'local'
                ? 'Select a directory to use as the workspace root.'
                : 'Clone a repository to use as the workspace root.'}
            </div>
          </div>
          <div className="launch-header-right">
            <div className="launch-path-display">{getShortPath(currentPath) || '/'}</div>
            <div
              className="launch-close-btn"
              onClick={onClose}
              role="button"
              tabIndex={0}
              aria-label="Close"
            >
              <X size={16} />
            </div>
          </div>
        </div>

        {launchBody}

        <div className="launch-footer">
          <button
            className="launch-start-btn"
            onClick={() => void handleOpen()}
            disabled={loading || !selectedPath}
          >
            {loading ? 'Starting...' : 'Start Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLaunchModal;
