import { useAtomValue, useSetAtom } from 'jotai';
import { MoreHorizontal, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { connectionStatusAtom, type ConnectionStatus } from '../../atoms/connection';
import { commandPaletteOpenAtom } from '../../atoms/ui';
import type { Workspace } from '@coder-studio/core';

interface MobileTopBarProps {
  activeWorkspace: Workspace | null;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}

function getConnectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'reconnecting':
      return '重连中';
    case 'rejected':
      return '另一个标签页已激活';
    case 'disconnected':
    default:
      return '离线';
  }
}

export function MobileTopBar({ activeWorkspace, drawerOpen, onToggleDrawer }: MobileTopBarProps) {
  const navigate = useNavigate();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const [actionsOpen, setActionsOpen] = useState(false);

  const workspaceLabel =
    activeWorkspace?.name ??
    activeWorkspace?.path?.split('/').filter(Boolean).pop() ??
    activeWorkspace?.path ??
    '选择工作区';

  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar__workspace-button"
        onClick={onToggleDrawer}
        aria-label="Switch workspace"
        aria-expanded={drawerOpen}
      >
        <span className="mobile-topbar__workspace-leading">☰</span>
        <span className="mobile-topbar__workspace-copy">
          <span className="mobile-topbar__workspace-name">{workspaceLabel}</span>
          <span className="mobile-topbar__workspace-chevron">▾</span>
        </span>
      </button>

      <div className="mobile-topbar__status" aria-label={getConnectionLabel(connectionStatus)}>
        <span className={`mobile-topbar__status-dot mobile-topbar__status-dot--${connectionStatus}`} />
        <span>{getConnectionLabel(connectionStatus)}</span>
      </div>

      <div className="mobile-topbar__actions">
        <button
          type="button"
          className="mobile-topbar__icon-button"
          aria-label="Open more actions"
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((value) => !value)}
        >
          <MoreHorizontal size={18} />
        </button>

        {actionsOpen ? (
          <div className="mobile-topbar__menu" role="menu" aria-label="Mobile actions">
            <button
              type="button"
              className="mobile-topbar__menu-item"
              onClick={() => {
                setCommandPaletteOpen(true);
                setActionsOpen(false);
              }}
              aria-label="Open quick actions"
            >
              <Search size={16} />
              <span>Quick Actions</span>
            </button>
            <button
              type="button"
              className="mobile-topbar__menu-item"
              onClick={() => {
                navigate('/settings');
                setActionsOpen(false);
              }}
              aria-label="Open settings"
            >
              <span>Settings</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
