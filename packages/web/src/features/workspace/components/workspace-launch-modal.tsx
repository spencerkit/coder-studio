/**
 * Workspace Launch Modal
 *
 * Modal for selecting and opening a workspace directory.
 * PRD §7.4: Workspace launch flow
 */

import { useState, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { FolderOpen, X } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { useNavigate } from 'react-router-dom';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { activeWorkspaceIdAtom, commandPaletteOpenAtom } from '../../../atoms/ui';

interface WorkspaceLaunchModalProps {
  onClose: () => void;
}

export function WorkspaceLaunchModal({ onClose }: WorkspaceLaunchModalProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useSetAtom(dispatchCommandAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const [path, setPath] = useState('');
  const [targetRuntime, setTargetRuntime] = useState<'node' | 'bun' | 'deno'>('node');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    if (!path.trim()) {
      setError(t('error.required_field') || 'Path is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await dispatch({
        op: 'workspace.open',
        path: path.trim(),
        targetRuntime,
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
  }, [path, targetRuntime, dispatch, navigate, setActiveWorkspaceId, onClose, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleOpen();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [handleOpen, onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content workspace-launch-modal" onClick={(e) => e.stopPropagation()}>
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
          <div className="form-group">
            <label className="form-label">{t('workspace.path') || 'Path'}</label>
            <input
              type="text"
              className="input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="/path/to/project"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">{t('workspace.runtime') || 'Runtime'}</label>
            <select
              className="input"
              value={targetRuntime}
              onChange={(e) => setTargetRuntime(e.target.value as 'node' | 'bun' | 'deno')}
            >
              <option value="node">Node.js</option>
              <option value="bun">Bun</option>
              <option value="deno">Deno</option>
            </select>
          </div>

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
            disabled={loading || !path.trim()}
          >
            {loading ? t('status.loading') : t('action.open')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspaceLaunchModal;
