import { Menu, Settings2 } from 'lucide-react';
import type { Workspace } from '@coder-studio/core';
import { useTranslation } from '../../../../lib/i18n';

interface MobileTopBarProps {
  activeWorkspace: Workspace | null;
  drawerOpen: boolean;
  onOpenSettings: () => void;
  onToggleDrawer: () => void;
}

export function MobileTopBar({
  activeWorkspace,
  drawerOpen,
  onOpenSettings,
  onToggleDrawer,
}: MobileTopBarProps) {
  const t = useTranslation();
  const workspaceLabel =
    activeWorkspace?.name ??
    activeWorkspace?.path?.split('/').filter(Boolean).pop() ??
    activeWorkspace?.path ??
    t('mobile.workspace_drawer.select_title');

  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar__workspace-button"
        onClick={() => {
          onToggleDrawer();
        }}
        aria-label={t('mobile.topbar.switch_workspace')}
        aria-expanded={drawerOpen}
      >
        <span className="mobile-topbar__workspace-leading" aria-hidden="true">
          <Menu size={18} />
        </span>
        <span className="mobile-topbar__workspace-copy">
          <span className="mobile-topbar__workspace-label">{t('label.workspace')}</span>
          <span className="mobile-topbar__workspace-name">{workspaceLabel}</span>
        </span>
      </button>

      <div className="mobile-topbar__actions">
        <button
          type="button"
          className="mobile-topbar__icon-button"
          aria-label={t('mobile.topbar.open_settings')}
          onClick={() => {
            onOpenSettings();
          }}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </header>
  );
}
