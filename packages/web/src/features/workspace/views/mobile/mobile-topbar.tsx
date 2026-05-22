import type { Workspace } from "@coder-studio/core";
import { Menu } from "lucide-react";
import { IconButton, ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { formatWorkspaceLabel } from "../../../notifications/format";
import type { WorkspaceFullscreenController } from "../../actions/use-workspace-fullscreen";
import { WorkspaceFullscreenButton } from "../../components/workspace-fullscreen-button";

interface MobileTopBarProps {
  activeWorkspace: Workspace | null;
  drawerOpen: boolean;
  fullscreenController?: WorkspaceFullscreenController;
  onOpenSettings: () => void;
  onToggleDrawer: () => void;
}

export function MobileTopBar({
  activeWorkspace,
  drawerOpen,
  fullscreenController,
  onOpenSettings,
  onToggleDrawer,
}: MobileTopBarProps) {
  const t = useTranslation();
  const workspaceLabel =
    formatWorkspaceLabel(activeWorkspace) || t("mobile.workspace_drawer.select_title");

  return (
    <header className="mobile-topbar">
      <button
        type="button"
        className="mobile-topbar__workspace-button"
        onClick={() => {
          onToggleDrawer();
        }}
        aria-label={t("mobile.topbar.switch_workspace")}
        aria-expanded={drawerOpen}
      >
        <span className="mobile-topbar__workspace-leading" aria-hidden="true">
          <Menu size={18} />
        </span>
        <span className="mobile-topbar__workspace-name">{workspaceLabel}</span>
      </button>

      <div className="mobile-topbar__actions">
        <IconButton
          aria-label={t("mobile.topbar.open_settings")}
          className="mobile-topbar__icon-button"
          icon={<ThemedIcon semantic="nav.settings" size={18} />}
          onClick={onOpenSettings}
        />
        <WorkspaceFullscreenButton
          controller={fullscreenController}
          className="mobile-topbar__icon-button"
          iconSize={18}
          dataTestId="mobile-fullscreen-toggle"
        />
      </div>
    </header>
  );
}
