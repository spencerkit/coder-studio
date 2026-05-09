/**
 * Workspace Tab Component
 *
 * Individual workspace tab in the topbar.
 * Shows workspace name, status indicator, unread badge, and close button.
 */

import type { Workspace } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { X } from "lucide-react";
import type { FC } from "react";
import { activeWorkspaceIdAtom } from "../../../atoms/workspaces";
import { Badge, IconButton } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { formatWorkspaceLabel } from "../../notifications/format";
import { useWorkspaceCloseAction } from "../../workspace/actions/use-workspace-close-action";

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
  const closeWorkspace = useWorkspaceCloseAction();
  const displayName = formatWorkspaceLabel(workspace) || workspace.id;

  const handleClick = () => {
    setActiveWorkspace(workspace.id);
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closeWorkspace(workspace.id);
  };

  return (
    <div
      className={`topbar-tab ${isActive ? "active" : ""}`}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-selected={isActive}
      title={workspace.path || workspace.id}
    >
      <span className={`topbar-dot ${workspace.isActive ? "active" : "idle"}`} />

      <span className="topbar-tab-name">{displayName}</span>

      <Badge count={workspace.unreadCount ?? 0} max={9} />

      <IconButton
        className="topbar-close"
        aria-label={t("action.close_workspace")}
        icon={<X size={14} />}
        onClick={handleClose}
        size="sm"
      />
    </div>
  );
};

export default WorkspaceTab;
