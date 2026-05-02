import { Home, ArrowUp, Folder, Loader2, X } from 'lucide-react';
import { useViewport } from '../../../../hooks/use-viewport';
import { useTranslation } from '../../../../lib/i18n';
import { MobileSheet } from '../mobile/mobile-sheet';
import { useWorkspaceLaunchActions } from '../../actions/use-workspace-launch-actions';

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const isMobile = useViewport() === 'mobile';
  const t = useTranslation();
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
          <div className="launch-choice-title">{t('workspace.launch.local_title')}</div>
          <div className="launch-choice-desc">{t('workspace.launch.local_description')}</div>
        </div>
        <div className="launch-choice disabled">
          <div className="launch-choice-title">{t('workspace.launch.remote_title')}</div>
          <div className="launch-choice-desc">{t('workspace.launch.remote_description')}</div>
        </div>
      </div>

      <div className="folder-picker">
        <div className="fp-toolbar">
          <button className="fp-btn" onClick={() => handleNavigate('~')}>
            <Home size={12} />
            {t('workspace.launch.home_directory')}
          </button>
          {parentPath && (
            <button className="fp-btn" onClick={() => handleNavigate(parentPath)}>
              <ArrowUp size={12} />
              {t('workspace.launch.go_up')}
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
            <div className="directory-empty">{t('workspace.launch.no_directories')}</div>
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
                  <span className="fp-dir-hint">
                    {t('workspace.launch.items_count', { count: dir.itemCount })}
                  </span>
                )}
                {selectedPath === dir.path && (
                  <button
                    className="fp-dir-action"
                    type="button"
                    aria-label={t('workspace.launch.enter_folder', { name: dir.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleNavigate(dir.path);
                    }}
                  >
                    {t('workspace.launch.enter_folder_action')}
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
        {t('workspace.launch.cancel')}
      </button>
      <button
        className="launch-start-btn"
        onClick={() => void handleOpen()}
        disabled={loading || !selectedPath}
      >
        {loading ? t('workspace.launch.starting') : t('workspace.launch.start')}
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <MobileSheet
        kicker={t('workspace.launch.kicker')}
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
            <div className="launch-kicker">{t('workspace.launch.kicker')}</div>
            <div className="launch-title">{launchTitle}</div>
            <div className="launch-hint">
              {launchChoice === 'local'
                ? t('workspace.launch.hint_local')
                : t('workspace.launch.hint_remote')}
            </div>
          </div>
          <div className="launch-header-right">
            <div className="launch-path-display">{getShortPath(currentPath) || '/'}</div>
            <div
              className="launch-close-btn"
              onClick={onClose}
              role="button"
              tabIndex={0}
              aria-label={t('action.close')}
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
            {loading ? t('workspace.launch.starting') : t('workspace.launch.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLaunchModal;
