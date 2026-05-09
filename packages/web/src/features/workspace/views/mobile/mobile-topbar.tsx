import type { Workspace } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { Menu, MoreHorizontal, Search, Settings2 } from "lucide-react";
import { useState } from "react";
import { commandPaletteOpenAtom } from "../../../../atoms/app-ui";
import { ActionMenu, IconButton } from "../../../../components/ui";
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
  const setCommandPaletteOpen = useSetAtom(commandPaletteOpenAtom);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
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
        <span className="mobile-topbar__workspace-copy">
          <span className="mobile-topbar__workspace-label">{t("label.workspace")}</span>
          <span className="mobile-topbar__workspace-name">{workspaceLabel}</span>
        </span>
      </button>

      <div className="mobile-topbar__actions">
        <ActionMenu
          forceMode="mobile"
          items={[
            {
              id: "settings",
              label: t("settings.title"),
              icon: <Settings2 size={16} />,
              onSelect: () => {
                onOpenSettings();
              },
            },
            {
              id: "quick-actions",
              label: t("tooltip.quick_actions"),
              icon: <Search size={16} />,
              onSelect: () => {
                setCommandPaletteOpen(true);
              },
            },
          ]}
          onOpenChange={setMoreActionsOpen}
          open={moreActionsOpen}
          title={t("mobile.topbar.more_actions")}
        >
          <IconButton
            aria-label={t("mobile.topbar.open_more_actions")}
            className="mobile-topbar__icon-button"
            icon={<MoreHorizontal size={18} />}
          />
        </ActionMenu>
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
