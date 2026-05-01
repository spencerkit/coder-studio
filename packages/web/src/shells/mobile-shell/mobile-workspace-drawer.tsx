import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { activeWorkspaceIdAtom } from '../../atoms/workspaces';
import type { Workspace } from '@coder-studio/core';

interface MobileWorkspaceDrawerProps {
  activeWorkspaceId: string | null;
  isOpen: boolean;
  workspaces: Workspace[];
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWorkspaceLauncher: () => void;
}

export function MobileWorkspaceDrawer({
  activeWorkspaceId,
  isOpen,
  workspaces,
  onClose,
  onOpenSettings,
  onOpenWorkspaceLauncher,
}: MobileWorkspaceDrawerProps) {
  const navigate = useNavigate();
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="mobile-drawer-layer">
      <button
        type="button"
        className="mobile-drawer-layer__backdrop"
        aria-label="Close workspace drawer"
        onClick={onClose}
      />
      <aside className="mobile-workspace-drawer" aria-label="Workspace drawer">
        <div className="mobile-workspace-drawer__header">
          <div className="mobile-workspace-drawer__kicker">Workspace</div>
          <h2 className="mobile-workspace-drawer__title">选择工作区</h2>
        </div>

        <div className="mobile-workspace-drawer__list">
          {workspaces.map((workspace) => {
            const displayName =
              workspace.name ||
              workspace.path?.split('/').filter(Boolean).pop() ||
              workspace.path ||
              workspace.id;

            return (
              <button
                key={workspace.id}
                type="button"
                className={`mobile-workspace-drawer__item ${
                  workspace.id === activeWorkspaceId ? 'mobile-workspace-drawer__item--active' : ''
                }`}
                aria-label={`Switch to workspace ${displayName}`}
                onClick={() => {
                  setActiveWorkspaceId(workspace.id);
                  navigate('/workspace');
                  onClose();
                }}
              >
                <span className="mobile-workspace-drawer__item-name">{displayName}</span>
                <span className="mobile-workspace-drawer__item-path">{workspace.path}</span>
              </button>
            );
          })}
        </div>

        <div className="mobile-workspace-drawer__footer">
          <button
            type="button"
            className="mobile-workspace-drawer__footer-button"
            onClick={() => {
              onOpenWorkspaceLauncher();
              onClose();
            }}
          >
            New Workspace
          </button>
          <button
            type="button"
            className="mobile-workspace-drawer__footer-button"
            onClick={() => {
              onOpenSettings();
              onClose();
            }}
          >
            Settings
          </button>
        </div>
      </aside>
    </div>
  );
}
