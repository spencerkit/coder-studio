/**
 * TopBar Feature
 *
 * Main navigation bar with workspace tabs, quick actions, and settings.
 */

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { PanelBottom, PanelLeft, Plus, Search, Settings } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { commandPaletteOpenAtom } from "../../atoms/app-ui";
import {
  activeWorkspaceIdAtom,
  orderedWorkspacesAtom,
  resolvedActiveWorkspaceIdAtom,
} from "../../atoms/workspaces";
import { EmptyState, IconButton, TabList, Tabs, Tooltip } from "../../components/ui";
import { useTranslation } from "../../lib/i18n";
import type { WorkspaceFullscreenController } from "../workspace/actions/use-workspace-fullscreen";
import { sidebarCollapsedAtom, terminalPanelVisibleAtom } from "../workspace/atoms";
import { WorkspaceFullscreenButton } from "../workspace/components/workspace-fullscreen-button";
import { WorkspaceLaunchModal } from "../workspace/views/shared/workspace-launch-modal";
import { ConnectionStatus } from "./components/connection-status";
import { WorkspaceTab } from "./components/tab";

interface TopBarProps {
  fullscreenController?: WorkspaceFullscreenController;
}

const topbarEmptyStateStyle = {
  width: "auto",
  minHeight: "auto",
  padding: 0,
  gap: 0,
};

const topbarEmptyStateTitleStyle = {
  color: "var(--text-tertiary)",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--font-normal)",
};

/**
 * TopBar Component
 *
 * Height: 36px (from PRD §5.1)
 * Layout:
 *   - Left: Workspace tabs + Add button
 *   - Right: ConnectionStatus, Quick Actions, Terminal toggle, Files toggle, Settings
 */
export const TopBar: FC<TopBarProps> = ({ fullscreenController }) => {
  const t = useTranslation();
  const navigate = useNavigate();
  const workspaceList = useAtomValue(orderedWorkspacesAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const selectedWorkspaceId = activeWorkspaceId ?? workspaceList[0]?.id ?? "";
  const setActiveWorkspace = useSetAtom(activeWorkspaceIdAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);
  const [terminalPanelVisible, setTerminalPanelVisible] = useAtom(terminalPanelVisibleAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);

  return (
    <header className="app-topbar">
      <div className="topbar-tabs">
        {workspaceList.length === 0 ? (
          <EmptyState
            className="topbar-empty-state"
            style={topbarEmptyStateStyle}
            title={
              <span className="topbar-hint" style={topbarEmptyStateTitleStyle}>
                {t("workspace.no_workspace")}
              </span>
            }
          />
        ) : (
          <Tabs
            aria-label={t("workspace.tabs")}
            className="topbar-tabs-nav"
            onValueChange={setActiveWorkspace}
            value={selectedWorkspaceId}
          >
            <TabList className="topbar-tablist">
              {workspaceList.map((ws) => (
                <WorkspaceTab key={ws.id} workspace={ws} isActive={ws.id === selectedWorkspaceId} />
              ))}
            </TabList>
          </Tabs>
        )}
        <Tooltip content={t("tooltip.new_workspace")}>
          <IconButton
            aria-label={t("tooltip.new_workspace")}
            className="topbar-add"
            icon={<Plus size={14} />}
            onClick={() => setWorkspaceLaunchOpen(true)}
          />
        </Tooltip>
      </div>

      <div className="topbar-actions">
        <ConnectionStatus />
        <Tooltip content={t("tooltip.quick_actions")}>
          <button
            className="topbar-btn topbar-quick-actions"
            onClick={() => setCommandPaletteOpen(!commandPaletteOpen)}
            aria-label={t("tooltip.quick_actions")}
          >
            <Search size={14} />
            <span className="topbar-btn-label">{t("tooltip.quick_actions")}</span>
          </button>
        </Tooltip>
        <Tooltip
          content={terminalPanelVisible ? t("tooltip.hide_terminal") : t("tooltip.show_terminal")}
        >
          <IconButton
            aria-label={
              terminalPanelVisible ? t("tooltip.hide_terminal") : t("tooltip.show_terminal")
            }
            className={`topbar-btn ${terminalPanelVisible ? "topbar-btn--active" : "topbar-btn--muted"}`}
            icon={<PanelBottom size={14} />}
            onClick={() => setTerminalPanelVisible(!terminalPanelVisible)}
          />
        </Tooltip>
        <Tooltip content={sidebarCollapsed ? t("tooltip.show_files") : t("tooltip.hide_files")}>
          <IconButton
            aria-label={sidebarCollapsed ? t("tooltip.show_files") : t("tooltip.hide_files")}
            className={`topbar-btn ${sidebarCollapsed ? "topbar-btn--muted" : "topbar-btn--active"}`}
            icon={<PanelLeft size={14} />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          />
        </Tooltip>
        <Tooltip content={t("settings.title")}>
          <IconButton
            aria-label={t("settings.title")}
            className="topbar-btn"
            data-testid="settings-open"
            icon={<Settings size={14} />}
            onClick={() => navigate("/settings")}
          />
        </Tooltip>
        <WorkspaceFullscreenButton
          controller={fullscreenController}
          className="topbar-btn"
          iconSize={14}
          dataTestId="workspace-fullscreen-open"
        />
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </header>
  );
};

export default TopBar;
