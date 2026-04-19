/**
 * Workspace Tab Component
 *
 * Individual workspace tab in the topbar.
 * Shows workspace name, status indicator, unread badge, and close button.
 */

import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Workspace } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { workspacesAtom } from '../../../atoms/workspaces';
import { activeWorkspaceIdAtom } from '../../../atoms/ui';
import { useTranslation } from '../../../lib/i18n';

interface WorkspaceTabProps {
  workspace: Workspace;
  isActive: boolean;
}

/**
 * Workspace Tab
 *
 * PRD §5.1.2:
 *   - Status dot (green = running, gray-blue = idle, with pulse animation)
 *   - Tab text (truncated)
 *   - Unread badge (conditional, count display)
 *   - Close button (visible on hover)
 */
export const WorkspaceTab: FC<WorkspaceTabProps> = ({ workspace, isActive }) => {
  const t = useTranslation();
  const setActiveWorkspace = useSetAtom(activeWorkspaceIdAtom);
  const workspaces = useAtomValue(workspacesAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const navigate = useNavigate();
  const displayName =
    workspace.name || workspace.path?.split('/').filter(Boolean).pop() || workspace.path || workspace.id;

  const handleClick = () => {
    setActiveWorkspace(workspace.id);
    navigate(`/workspace/${workspace.id}`);
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();

    const result = await dispatch<void>('workspace.close', {
      id: workspace.id,
    });

    if (!result.ok) {
      console.error('Failed to close workspace:', result.error?.message);
      return;
    }

    const remainingIds = Object.keys(workspaces).filter((id) => id !== workspace.id);

    setWorkspaces((prev) => {
      const next = { ...prev };
      delete next[workspace.id];
      return next;
    });

    if (isActive) {
      const nextWorkspaceId = remainingIds[0] ?? null;
      setActiveWorkspace(nextWorkspaceId);
      navigate(nextWorkspaceId ? `/workspace/${nextWorkspaceId}` : '/');
    }
  };

  return (
    <div
      className={`topbar-tab ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-selected={isActive}
      title={workspace.path || workspace.id}
    >
      <span className={`topbar-dot ${workspace.isActive ? 'active' : 'idle'}`} />

      <span className="topbar-tab-name">{displayName}</span>

      {workspace.unreadCount && workspace.unreadCount > 0 ? (
        <span className="topbar-unread">
          {workspace.unreadCount > 9 ? '9+' : workspace.unreadCount}
        </span>
      ) : null}

      <button
        className="topbar-close"
        onClick={handleClose}
        aria-label={t('action.close_workspace')}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default WorkspaceTab;
