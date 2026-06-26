import type { Session, Workspace } from "@coder-studio/core";
import { useSetAtom } from "jotai";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { activeWorkspaceIdAtom } from "../../../../atoms/workspaces";
import { IconButton, ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { formatWorkspaceLabel } from "../../../notifications/format";
import { usePersistWorkspaceLastViewedTarget } from "../../actions/use-persist-workspace-last-viewed-target";
import { useWorkspaceCloseAction } from "../../actions/use-workspace-close-action";

interface MobileWorkspaceDrawerSessionItem {
  id: string;
  workspaceId: string;
  providerId: string;
  title?: string;
  state: Session["state"];
}

interface MobileWorkspaceDrawerProps {
  activeWorkspaceId: string | null;
  activeSessionId?: string | null;
  isOpen: boolean;
  sessionsByWorkspaceId?: Record<string, MobileWorkspaceDrawerSessionItem[]>;
  workspaces: Workspace[];
  onClose: () => void;
  onCloseSession?: (sessionId: string) => Promise<void>;
  onCreateSession?: () => void;
  onOpenWorkspaceLauncher: () => void;
  onSelectSession?: (sessionId: string) => void;
}

function formatDrawerSessionLabel(session: MobileWorkspaceDrawerSessionItem) {
  if (session.title?.trim()) {
    return session.title.trim();
  }

  if (session.providerId) {
    return session.providerId.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  const numericId = session.id.match(/(\d+)/)?.[1];
  if (numericId) {
    return `SESSION-${numericId.slice(-2).padStart(2, "0")}`;
  }

  return session.id.replace(/[_-]/g, " ").toUpperCase();
}

function formatDrawerSessionStateLabel(
  state: Session["state"],
  t: ReturnType<typeof useTranslation>
) {
  switch (state) {
    case "starting":
      return t("status.starting");
    case "running":
      return t("status.running");
    case "idle":
      return t("status.idle");
    case "ended":
      return t("status.ended");
    default:
      return state;
  }
}

export function MobileWorkspaceDrawer({
  activeWorkspaceId,
  activeSessionId,
  isOpen,
  sessionsByWorkspaceId = {},
  workspaces,
  onClose,
  onCloseSession = async () => {},
  onCreateSession = () => {},
  onOpenWorkspaceLauncher,
  onSelectSession = () => {},
}: MobileWorkspaceDrawerProps) {
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const t = useTranslation();
  const closeWorkspace = useWorkspaceCloseAction();
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(
    () => new Set(activeWorkspaceId ? [activeWorkspaceId] : [])
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setExpandedWorkspaceIds((currentExpandedWorkspaceIds) => {
      if (!activeWorkspaceId || currentExpandedWorkspaceIds.has(activeWorkspaceId)) {
        return currentExpandedWorkspaceIds;
      }

      const nextExpandedWorkspaceIds = new Set(currentExpandedWorkspaceIds);
      nextExpandedWorkspaceIds.add(activeWorkspaceId);
      return nextExpandedWorkspaceIds;
    });
  }, [activeWorkspaceId, isOpen]);

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
            const isExpanded = expandedWorkspaceIds.has(workspace.id);
            const workspaceSessions = sessionsByWorkspaceId[workspace.id] ?? [];

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
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded
                      ? t("mobile.workspace_drawer.collapse_workspace", {
                          name: displayName,
                        })
                      : t("mobile.workspace_drawer.expand_workspace", {
                          name: displayName,
                        })
                  }
                  onClick={() =>
                    setExpandedWorkspaceIds((currentExpandedWorkspaceIds) => {
                      const nextExpandedWorkspaceIds = new Set(currentExpandedWorkspaceIds);

                      if (nextExpandedWorkspaceIds.has(workspace.id)) {
                        nextExpandedWorkspaceIds.delete(workspace.id);
                      } else {
                        nextExpandedWorkspaceIds.add(workspace.id);
                      }

                      return nextExpandedWorkspaceIds;
                    })
                  }
                >
                  <span className="mobile-workspace-drawer__item-name-row">
                    <span className="mobile-workspace-drawer__item-name">{displayName}</span>
                  </span>
                  <span className="mobile-workspace-drawer__item-path">{workspace.path}</span>
                </button>
                <div className="mobile-workspace-drawer__item-actions">
                  {isActive ? (
                    <IconButton
                      aria-label={t("mobile.workspace_drawer.create_session_in_workspace", {
                        name: displayName,
                      })}
                      className="mobile-workspace-drawer__item-create"
                      icon={<ThemedIcon semantic="agent.action.newSession" size={12} />}
                      onClick={onCreateSession}
                      size="sm"
                    />
                  ) : null}
                  <IconButton
                    aria-label={t("mobile.workspace_drawer.close_workspace", { name: displayName })}
                    className="mobile-workspace-drawer__item-close"
                    icon={<X size={14} />}
                    onClick={() => {
                      void closeWorkspace(workspace.id, { navigateHomeWhenEmpty: true }).then(
                        (closed) => {
                          if (closed) {
                            onClose();
                          }
                        }
                      );
                    }}
                    size="sm"
                  />
                </div>
                {isExpanded ? (
                  <div className="mobile-workspace-drawer__item-children">
                    {workspaceSessions.length === 0 ? (
                      <button
                        type="button"
                        className="mobile-workspace-drawer__child-empty"
                        aria-label={t("mobile.workspace_drawer.switch_to_workspace", {
                          name: displayName,
                        })}
                        onClick={() => {
                          if (workspace.id === activeWorkspaceId) {
                            return;
                          }

                          void persistLastViewedTarget({ workspaceId: workspace.id });
                          setActiveWorkspaceId(workspace.id);
                          onClose();
                        }}
                      >
                        <span className="mobile-workspace-drawer__child-empty-title">
                          {t("mobile.agent.empty")}
                        </span>
                        <span className="mobile-workspace-drawer__child-empty-hint">
                          {t("mobile.workspace_drawer.switch_to_workspace", {
                            name: displayName,
                          })}
                        </span>
                      </button>
                    ) : (
                      workspaceSessions.map((session) => {
                        const sessionLabel = formatDrawerSessionLabel(session);
                        const isActiveSession = session.id === activeSessionId;

                        return (
                          <div
                            key={session.id}
                            className={`mobile-workspace-drawer__child-session-row ${
                              isActiveSession
                                ? "mobile-workspace-drawer__child-session-row--active"
                                : ""
                            }`}
                          >
                            <button
                              type="button"
                              className={`mobile-workspace-drawer__child-session ${
                                isActiveSession
                                  ? "mobile-workspace-drawer__child-session--active"
                                  : ""
                              }`}
                              aria-current={isActiveSession ? "page" : undefined}
                              aria-label={t("mobile.agent.switch_to_agent", { name: sessionLabel })}
                              onClick={() => {
                                void persistLastViewedTarget({
                                  workspaceId: workspace.id,
                                  sessionId: session.id,
                                });
                                if (workspace.id !== activeWorkspaceId) {
                                  setActiveWorkspaceId(workspace.id);
                                } else {
                                  onSelectSession(session.id);
                                }
                                onClose();
                              }}
                            >
                              <span className="mobile-workspace-drawer__child-session-label">
                                {sessionLabel}
                              </span>
                              <span className="mobile-workspace-drawer__child-session-meta">
                                {`${session.providerId.toUpperCase()} · ${formatDrawerSessionStateLabel(
                                  session.state,
                                  t
                                )}`}
                              </span>
                            </button>
                            <IconButton
                              aria-label={t("mobile.agent.close_current_session")}
                              className="mobile-workspace-drawer__child-session-close"
                              icon={<X size={12} />}
                              onClick={async () => {
                                await onCloseSession(session.id);
                                onClose();
                              }}
                              size="sm"
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
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
