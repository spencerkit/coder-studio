/**
 * TopBar Feature
 *
 * Main navigation bar with workspace tabs, quick actions, and settings.
 */

import { useAtom, useAtomValue } from "jotai";
import { PanelBottom, PanelLeft, Plus, Search, Settings } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { commandPaletteOpenAtom } from "../../atoms/app-ui";
import { orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from "../../atoms/workspaces";
import { useTranslation } from "../../lib/i18n";
import { sidebarCollapsedAtom, terminalPanelVisibleAtom } from "../workspace/atoms";
import { WorkspaceLaunchModal } from "../workspace/views/shared/workspace-launch-modal";
import { ConnectionStatus } from "./components/connection-status";
import { WorkspaceTab } from "./components/tab";

/**
 * TopBar Component
 *
 * Height: 36px (from PRD §5.1)
 * Layout:
 *   - Left: Workspace tabs + Add button
 *   - Right: ConnectionStatus, Quick Actions, Terminal toggle, Files toggle, Settings
 */
export const TopBar: FC = () => {
  const t = useTranslation();
  const navigate = useNavigate();
  const workspaceList = useAtomValue(orderedWorkspacesAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const [commandPaletteOpen, setCommandPaletteOpen] = useAtom(commandPaletteOpenAtom);
  const [terminalPanelVisible, setTerminalPanelVisible] = useAtom(terminalPanelVisibleAtom);
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);

  return (
    <header className="app-topbar">
      <div className="topbar-tabs">
        {workspaceList.length === 0 ? (
          <div className="topbar-empty-state">
            <span className="topbar-hint">{t("workspace.no_workspace")}</span>
          </div>
        ) : (
          workspaceList.map((ws) => (
            <WorkspaceTab key={ws.id} workspace={ws} isActive={ws.id === activeWorkspaceId} />
          ))
        )}
        <button
          className="topbar-add"
          onClick={() => setWorkspaceLaunchOpen(true)}
          aria-label={t("tooltip.new_workspace")}
          title={t("tooltip.new_workspace")}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="topbar-actions">
        <ConnectionStatus />
        <button
          className="topbar-btn topbar-quick-actions"
          onClick={() => setCommandPaletteOpen(!commandPaletteOpen)}
          aria-label={t("tooltip.quick_actions")}
          title={t("tooltip.quick_actions")}
        >
          <Search size={14} />
          <span className="topbar-btn-label">{t("tooltip.quick_actions")}</span>
        </button>
        <button
          className={`topbar-btn ${terminalPanelVisible ? "topbar-btn--active" : "topbar-btn--muted"}`}
          onClick={() => setTerminalPanelVisible(!terminalPanelVisible)}
          aria-label={
            terminalPanelVisible ? t("tooltip.hide_terminal") : t("tooltip.show_terminal")
          }
          title={terminalPanelVisible ? t("tooltip.hide_terminal") : t("tooltip.show_terminal")}
        >
          <PanelBottom size={14} />
        </button>
        <button
          className={`topbar-btn ${sidebarCollapsed ? "topbar-btn--muted" : "topbar-btn--active"}`}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? t("tooltip.show_files") : t("tooltip.hide_files")}
          title={sidebarCollapsed ? t("tooltip.show_files") : t("tooltip.hide_files")}
        >
          <PanelLeft size={14} />
        </button>
        <button
          className="topbar-btn"
          onClick={() => navigate("/settings")}
          aria-label={t("settings.title")}
          title={t("settings.title")}
          data-testid="settings-open"
        >
          <Settings size={14} />
        </button>
      </div>
      {workspaceLaunchOpen ? (
        <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} />
      ) : null}
    </header>
  );
};

export default TopBar;
