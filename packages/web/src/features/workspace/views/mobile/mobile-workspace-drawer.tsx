import type { Workspace } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { IconButton } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { formatWorkspaceLabel } from "../../../notifications/format";
import { useWorkspaceCloseAction } from "../../actions/use-workspace-close-action";

interface MobileWorkspaceDrawerProps {
  activeWorkspaceId: string | null;
  isOpen: boolean;
  workspaces: Workspace[];
  onClose: () => void;
  onOpenWorkspaceLauncher: () => void;
}

export function MobileWorkspaceDrawer({
  activeWorkspaceId,
  isOpen,
  workspaces,
  onClose,
  onOpenWorkspaceLauncher,
}: MobileWorkspaceDrawerProps) {
  const navigate = useNavigate();
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const t = useTranslation();
  const closeWorkspace = useWorkspaceCloseAction();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="mobile-drawer-layer">
      <button
        type="button"
        className="mobile-drawer-layer__backdrop"
        aria-label={t("mobile.workspace_drawer.close")}
        onClick={onClose}
      />
      <aside
        className="mobile-workspace-drawer"
        aria-label={t("mobile.workspace_drawer.aria_label")}
      >
        <div className="mobile-workspace-drawer__header">
          <div className="mobile-workspace-drawer__kicker">{t("label.workspace")}</div>
          <h2 className="mobile-workspace-drawer__title">
            {t("mobile.workspace_drawer.select_title")}
          </h2>
        </div>

        <div className="mobile-workspace-drawer__list">
          {workspaces.map((workspace) => {
            const displayName = formatWorkspaceLabel(workspace) || workspace.id;

            return (
              <div
                key={workspace.id}
                className={`mobile-workspace-drawer__item ${
                  workspace.id === activeWorkspaceId ? "mobile-workspace-drawer__item--active" : ""
                }`}
              >
                <button
                  type="button"
                  className="mobile-workspace-drawer__item-main"
                  aria-label={t("mobile.workspace_drawer.switch_to_workspace", {
                    name: displayName,
                  })}
                  onClick={() => {
                    setActiveWorkspaceId(workspace.id);
                    navigate("/workspace");
                    onClose();
                  }}
                >
                  <span className="mobile-workspace-drawer__item-name">{displayName}</span>
                  <span className="mobile-workspace-drawer__item-path">{workspace.path}</span>
                </button>
                <IconButton
                  aria-label={t("mobile.workspace_drawer.close_workspace", { name: displayName })}
                  className="mobile-workspace-drawer__item-close"
                  icon={<X size={16} />}
                  onClick={() => {
                    void closeWorkspace(workspace.id, { navigateHomeWhenEmpty: true }).then(
                      (closed) => {
                        if (closed) {
                          onClose();
                        }
                      }
                    );
                  }}
                  size="lg"
                />
              </div>
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
            {t("tooltip.new_workspace")}
          </button>
        </div>
      </aside>
    </div>
  );
}
