import type { Workspace } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { IconButton, ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { formatWorkspaceLabel } from "../../../notifications/format";
import { usePersistWorkspaceLastViewedTarget } from "../../actions/use-persist-workspace-last-viewed-target";
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
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();

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
          <div className="mobile-workspace-drawer__header-copy">
            <div className="mobile-workspace-drawer__kicker">{t("label.workspace")}</div>
            <h2 className="mobile-workspace-drawer__title">
              {t("mobile.workspace_drawer.select_title")}
            </h2>
          </div>
          <IconButton
            aria-label={t("action.close")}
            className="mobile-workspace-drawer__dismiss"
            icon={<X size={16} />}
            onClick={onClose}
            size="lg"
          />
        </div>

        <div className="mobile-workspace-drawer__list">
          {workspaces.map((workspace) => {
            const displayName = formatWorkspaceLabel(workspace) || workspace.id;
            const isActive = workspace.id === activeWorkspaceId;

            return (
              <div
                key={workspace.id}
                className={`mobile-workspace-drawer__item ${
                  isActive ? "mobile-workspace-drawer__item--active" : ""
                }`}
              >
                <button
                  type="button"
                  className="mobile-workspace-drawer__item-main"
                  aria-current={isActive ? "page" : undefined}
                  aria-label={t("mobile.workspace_drawer.switch_to_workspace", {
                    name: displayName,
                  })}
                  onClick={() => {
                    if (isActive) {
                      navigate("/workspace");
                      onClose();
                      return;
                    }

                    void persistLastViewedTarget({ workspaceId: workspace.id });
                    setActiveWorkspaceId(workspace.id);
                    navigate("/workspace");
                    onClose();
                  }}
                >
                  <span className="mobile-workspace-drawer__item-name-row">
                    <span className="mobile-workspace-drawer__item-name">{displayName}</span>
                    {isActive ? (
                      <span className="mobile-workspace-drawer__item-state">
                        <Check size={12} />
                        <span>Current</span>
                      </span>
                    ) : null}
                  </span>
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
            <ThemedIcon semantic="nav.newWorkspace" size={14} />
            <span>{t("tooltip.new_workspace")}</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
