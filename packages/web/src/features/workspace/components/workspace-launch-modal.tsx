/**
 * Workspace Launch Modal
 *
 * Modal for selecting and opening a workspace directory on the server.
 * PRD §7.4: Workspace launch flow
 * Visual spec: docs/mockups.html - Workspace Launch Overlay
 */

import { useState, useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { X, Home, ArrowUp, Folder, Loader2 } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useNavigate } from 'react-router-dom';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { activeWorkspaceIdAtom } from '../../../atoms/ui';

interface DirectoryInfo {
  name: string;
  path: string;
  itemCount?: number;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
  rootPaths?: string[];
}

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

type LaunchChoice = 'local' | 'remote';

type ExecutionTarget = 'native' | 'wsl';

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

  const [currentPath, setCurrentPath] = useState('');
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Launch configuration
  const [launchChoice] = useState<LaunchChoice>('local');
  const [executionTarget, setExecutionTarget] = useState<ExecutionTarget>('native');

  // Root paths for quick navigation
  const rootPaths = ['/', '~', '/home/spencer'];

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Load directory listing
  const loadDirectory = useCallback(async (path?: string) => {
    setBrowsing(true);
    setError(null);
    try {
      const result = await dispatch<BrowseResult>('workspace.browse', { path });

      if (!result.ok || !result.data) {
        setError(result.error?.message || 'Failed to browse directories');
        return;
      }

      setCurrentPath(result.data.currentPath);
      setDirectories(result.data.directories);
      setParentPath(result.data.parentPath);
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
      const result = await dispatch<{ id: string }>('workspace.open', {
        path: selectedPath,
      });

      if (result.ok && result.data?.id) {
        setActiveWorkspaceId(result.data.id);
        navigate(`/workspace/${result.data.id}`);
        onClose();
      } else {
        setError(result.error?.message || t('error.workspace_open') || 'Failed to open workspace');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedPath, dispatch, navigate, setActiveWorkspaceId, onClose, t]);

  const getShortPath = (path: string) => {
    if (path === '~') return '~';
    if (path === '/') return '/';
    const homeMatch = path.match(/^\/home\/[^/]+/);
    if (homeMatch) {
      return path.replace(homeMatch[0], '~');
    }
    return path;
  };

  return (
    <div className="launch-overlay" onClick={onClose}>
      <div className="launch-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="launch-header">
          <div className="launch-header-left">
            <div className="launch-kicker">START WORKSPACE</div>
            <div className="launch-title">
              {launchChoice === 'local' ? 'Local Folder' : 'Remote Git'}
            </div>
            <div className="launch-hint">
              {launchChoice === 'local'
                ? 'Select a directory to use as the workspace root.'
                : 'Clone a repository to use as the workspace root.'}
            </div>
          </div>
          <div className="launch-header-right">
            <div className="launch-path-display">{getShortPath(currentPath) || '/'}</div>
            <div className="launch-target-hint">
              Target: {executionTarget === 'native' ? 'Native' : 'WSL'}
            </div>
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

        {/* Body */}
        <div className="launch-body">
          {/* Choice Cards */}
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

          {/* Execution Target */}
          <div className="launch-target-row">
            <button
              className={`launch-target-btn ${executionTarget === 'native' ? 'active' : ''}`}
              onClick={() => setExecutionTarget('native')}
            >
              Native
            </button>
            <button
              className={`launch-target-btn ${executionTarget === 'wsl' ? 'active' : ''}`}
              onClick={() => setExecutionTarget('wsl')}
            >
              WSL
            </button>
          </div>

          {/* Folder Picker */}
          <div className="folder-picker">
            {/* Toolbar */}
            <div className="fp-toolbar">
              <button className="fp-btn" onClick={() => loadDirectory('~')}>
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

            {/* Root Path Chips */}
            <div className="fp-root-chips">
              {rootPaths.map((rp) => (
                <span
                  key={rp}
                  className={`fp-chip ${currentPath === rp ? 'active' : ''}`}
                  onClick={() => loadDirectory(rp)}
                >
                  {rp}
                </span>
              ))}
              {currentPath && !rootPaths.includes(currentPath) && (
                <span className="fp-chip active">{getShortPath(currentPath)}</span>
              )}
            </div>

            {/* Directory List */}
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

        {/* Footer */}
        <div className="launch-footer">
          <button
            className="launch-start-btn"
            onClick={handleOpen}
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
