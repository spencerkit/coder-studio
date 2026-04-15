/**
 * Workspace Tab Component
 *
 * Individual workspace tab in the topbar.
 * Shows workspace name, status indicator, unread badge, and close button.
 */

import type { FC } from 'react';
import { useSetAtom } from 'jotai';
import { X } from 'lucide-react';
import type { Workspace } from '@coder-studio/core';
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

  const handleClick = () => {
    setActiveWorkspace(workspace.id);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Dispatch close workspace command
  };

  return (
    <div
      className={`topbar-tab ${isActive ? 'active' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-selected={isActive}
    >
      <span className={`topbar-dot ${workspace.isActive ? 'active' : 'idle'}`} />

      <span className="topbar-tab-name">{workspace.name}</span>

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
