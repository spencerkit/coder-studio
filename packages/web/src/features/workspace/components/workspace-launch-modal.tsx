/**
 * Workspace Launch Modal
 *
 * Modal for selecting and opening a workspace directory on the server.
 * PRD §7.4: Workspace launch flow
 */

import { useState, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { FolderOpen, X, ChevronRight, Home, ArrowUp, Folder, Loader2 } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useNavigate } from 'react-router-dom';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { activeWorkspaceIdAtom } from '../../../atoms/ui';

interface DirectoryInfo {
  name: string;
  path: string;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
}

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useSetAtom(dispatchCommandAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

  const [currentPath, setCurrentPath] = useState('');
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial directory listing
  const loadDirectory = useCallback(async (path?: string) => {
    setBrowsing(true);
    setError(null);
    try {
      const result = await dispatch({
        op: 'workspace.browse',
        path,
      }) as BrowseResult;

      setCurrentPath(result.currentPath);
      setDirectories(result.directories);
      setParentPath(result.parentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const handleNavigate = useCallback((path: string) => {
    setSelectedPath(null);
    loadDirectory(path);
  }, [loadDirectory]);

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleOpen = useCallback(async () => {
    if (!selectedPath) {
      setError(t('error.required_field') || 'Please select a directory');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await dispatch({
        op: 'workspace.open',
        path: selectedPath,
      });

      if (result && result.id) {
        setActiveWorkspaceId(result.id);
        navigate(`/workspace/${result.id}`);
        onClose();
      } else {
        setError(t('error.workspace_open') || 'Failed to open workspace');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedPath, dispatch, navigate, setActiveWorkspaceId, onClose, t]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content workspace-launch-modal workspace-launch-modal--browser"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">
            <FolderOpen size={18} />
            {t('workspace.open')}
          </h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Path breadcrumb */}
          <div className="directory-breadcrumb">
            <Home size={14} />
            <span className="breadcrumb-path">{currentPath || '/'}</span>
          </div>

          {/* Directory listing */}
          <div className="directory-list">
            {browsing ? (
              <div className="directory-loading">
                <Loader2 size={20} className="animate-spin" />
                <span>{t('status.loading') || 'Loading...'}</span>
              </div>
            ) : (
              <>
                {/* Parent directory link */}
                {parentPath && (
                  <div
                    className="directory-item directory-item--parent"
                    onClick={() => handleNavigate(parentPath)}
                  >
                    <ArrowUp size={16} />
                    <span>..</span>
                  </div>
                )}

                {/* Directory entries */}
                {directories.length === 0 ? (
                  <div className="directory-empty">
                    {t('workspace.no_directories') || 'No directories found'}
                  </div>
                ) : (
                  directories.map((dir) => (
                    <div
                      key={dir.path}
                      className={`directory-item ${selectedPath === dir.path ? 'directory-item--selected' : ''}`}
                      onClick={() => handleSelect(dir.path)}
                      onDoubleClick={() => handleNavigate(dir.path)}
                    >
                      <Folder size={16} />
                      <span className="directory-name">{dir.name}</span>
                      <ChevronRight
                        size={14}
                        className="directory-navigate"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNavigate(dir.path);
                        }}
                      />
                    </div>
                  ))
                )}
              </>
            )}
          </div>

          {/* Selected path */}
          {selectedPath && (
            <div className="selected-path">
              <span className="selected-path-label">{t('workspace.selected') || 'Selected:'}</span>
              <span className="selected-path-value">{selectedPath}</span>
            </div>
          )}

          {error && (
            <div className="form-error">{error}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleOpen}
            disabled={loading || !selectedPath}
          >
            {loading ? t('status.loading') : t('action.open')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLaunchModal;
