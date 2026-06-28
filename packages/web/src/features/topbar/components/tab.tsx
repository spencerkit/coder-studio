/**
 * Workspace Tab Component
 *
 * Individual workspace tab in the topbar.
 * Shows workspace name, session status mini map, and close button.
 */

import type { Workspace } from "@coder-studio/core";
import { X } from "lucide-react";
import type { FC } from "react";
import { IconButton, Tab, Tooltip } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { useWorkspaceSessions } from "../../agent-panes/actions/use-workspace-sessions";
import { formatWorkspaceLabel } from "../../notifications/format";
import { useSelectWorkspaceTarget } from "../../workspace/actions/use-select-workspace-target";
import { useWorkspaceCloseAction } from "../../workspace/actions/use-workspace-close-action";
import { WorkspaceSessionMiniMap } from "./workspace-session-mini-map";
import {
  buildWorkspaceSessionMiniMapCells,
  measureWorkspaceSessionMiniMapColumns,
} from "./workspace-session-mini-map-model";

interface WorkspaceTabProps {
  workspace: Workspace;
  isActive: boolean;
}

/**
 * Workspace Tab
 *
 * PRD §5.1.2:
 *   - Session mini map (one cell per pane, status-coded)
 *   - Tab text (truncated)
 *   - Close button (visible on hover)
 */
export const WorkspaceTab: FC<WorkspaceTabProps> = ({ workspace, isActive }) => {
  const t = useTranslation();
  const closeWorkspace = useWorkspaceCloseAction();
  const selectWorkspaceTarget = useSelectWorkspaceTarget();
  const { paneLayout, sessions } = useWorkspaceSessions(workspace, { disabled: isActive });
  const displayName = formatWorkspaceLabel(workspace) || workspace.id;
  const isWslWorkspace = workspace.targetRuntime === "wsl";
  const sessionsById = Object.fromEntries(sessions.map((session) => [session.id, session]));
  const miniMapCells = buildWorkspaceSessionMiniMapCells(paneLayout, sessionsById);
  const miniMapColumns = measureWorkspaceSessionMiniMapColumns(paneLayout);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();

    if (isActive) {
      return;
    }

    void selectWorkspaceTarget(workspace.id);
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await closeWorkspace(workspace.id);
  };

  return (
    <div className={`topbar-tab-shell ${isActive ? "active" : ""}`} role="presentation">
      <Tab className="topbar-tab" onClick={handleClick} value={workspace.id}>
        {isWslWorkspace ? (
          <span aria-hidden="true" className="workspace-tab-badge">
            WSL
          </span>
        ) : null}
        <span className="topbar-tab-content">
          <span
            className={`topbar-tab-name-row ${isWslWorkspace ? "topbar-tab-name-row--wsl" : ""}`}
          >
            <Tooltip content={workspace.path || workspace.id}>
              <span className="topbar-tab-name">{displayName}</span>
            </Tooltip>
          </span>
          <WorkspaceSessionMiniMap cells={miniMapCells} columns={miniMapColumns} />
        </span>
      </Tab>
      <IconButton
        className="topbar-close"
        aria-label={t("action.close_workspace")}
        icon={<X size={12} />}
        onClick={handleClose}
        size="sm"
      />
    </div>
  );
};

export default WorkspaceTab;
