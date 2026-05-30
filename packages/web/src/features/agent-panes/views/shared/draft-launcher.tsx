import type { Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowRight, FlipHorizontal, FlipVertical, X } from "lucide-react";
import { type DragEvent, type FC, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { Button, IconButton, StatusDot, Tag, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../../lib/workspace-path-drag";
import { buildDiagnosticsPath } from "../../../diagnostics";
import type { PaneDropIntent } from "../../actions/pane-drag-types";
import { type ProviderId, useProviderLauncher } from "../../actions/use-provider-launcher";

interface DraftLauncherDragState {
  isDragging: boolean;
  isActiveDropTarget: boolean;
  hoverPlacement: "center" | null;
}

interface DraftLauncherProps {
  dragState?: DraftLauncherDragState;
  workspaceId: string;
  paneId?: string;
  onAssignSession?: (paneId: string, sessionId: string) => void;
  onClosePane?: (paneId: string) => void;
  onOpenFile?: (paneId: string, path: string) => void;
  onPaneDrop?: (intent: PaneDropIntent) => void;
  onReplaceWithSession?: (sessionId: string) => void;
  onSplitPane?: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export const DraftLauncher: FC<DraftLauncherProps> = ({
  dragState,
  workspaceId,
  paneId,
  onAssignSession,
  onClosePane,
  onOpenFile,
  onPaneDrop: _onPaneDrop,
  onReplaceWithSession,
  onSplitPane,
}) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const [isFileDropTarget, setIsFileDropTarget] = useState(false);
  const { states, launch } = useProviderLauncher(
    dispatch,
    workspaceId,
    (session: Session, _providerId: ProviderId) => {
      setSessions((prev) => ({
        ...prev,
        [session.id]: session,
      }));

      if (paneId) {
        onAssignSession?.(paneId, session.id);
      } else {
        onReplaceWithSession?.(session.id);
      }
    },
    {
      paneId,
      launchMode: paneId ? "assign" : "replace",
    }
  );

  const buildProviderDiagnosticsPath = (providerId: ProviderId) =>
    buildDiagnosticsPath({
      context: "session_start",
      workspaceId,
      providerId,
      paneId,
      launchMode: paneId ? "assign" : "replace",
    });

  const canAutoInstall = (providerId: ProviderId): boolean => {
    const runtime = states[providerId].runtime;
    return Boolean(runtime?.autoInstallSupported && runtime.installReadiness === "ready");
  };

  const _getProviderCta = (providerId: ProviderId): string => {
    const state = states[providerId];
    if (
      state.loading ||
      state.installJob?.status === "queued" ||
      state.installJob?.status === "running"
    ) {
      return t("provider.install.cta.installing");
    }
    if (state.runtime?.available) {
      return t("provider.install.cta.start");
    }
    if (canAutoInstall(providerId)) {
      return t("provider.install.cta.install_and_start");
    }
    return t("provider.install.cta.manual");
  };

  const getProviderGuide = (providerId: ProviderId): { message?: string; docUrl?: string } => {
    const state = states[providerId];
    const failure = state.installJob?.failure;

    if (failure) {
      return {
        message: failure.message,
        docUrl: failure.docUrls.provider,
      };
    }

    if (state.inlineError && state.inlineError !== "manual") {
      return {
        message: state.inlineError,
        docUrl: state.runtime?.docUrls.provider,
      };
    }

    if (state.inlineError === "manual" || !canAutoInstall(providerId)) {
      return {
        message: state.runtime?.manualGuideKeys.map((key) => t(key)).join(" "),
        docUrl: state.runtime?.docUrls.provider,
      };
    }

    return {
      docUrl: state.runtime?.docUrls.provider,
    };
  };

  const isAnyProviderBusy = (Object.values(states) as Array<(typeof states)[ProviderId]>).some(
    (state) =>
      state.loading ||
      state.installJob?.status === "queued" ||
      state.installJob?.status === "running"
  );

  const handleSplitHorizontal = () => {
    if (!paneId) return;
    onSplitPane?.(paneId, "horizontal");
  };

  const handleSplitVertical = () => {
    if (!paneId) return;
    onSplitPane?.(paneId, "vertical");
  };

  const handleClosePane = () => {
    if (!paneId) return;
    onClosePane?.(paneId);
  };

  const resolveDroppedFilePath = (event: DragEvent<HTMLDivElement>): string | null => {
    if (!paneId) {
      return null;
    }

    const payload = getWorkspacePathDragPayload(event.dataTransfer);
    if (!payload || payload.workspaceId !== workspaceId || payload.kind !== "file") {
      return null;
    }

    return payload.path;
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!paneId || !hasWorkspacePathDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsFileDropTarget(true);
  };

  const handleDragLeave = () => {
    setIsFileDropTarget(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const path = resolveDroppedFilePath(event);
    setIsFileDropTarget(false);
    if (!path || !paneId) {
      return;
    }

    event.preventDefault();
    onOpenFile?.(paneId, path);
  };

  return (
    <div
      className={`session-card agent-pane${dragState?.isDragging ? " draft-launcher--dragging" : ""}${dragState?.isActiveDropTarget || isFileDropTarget ? " draft-launcher--drop-target" : ""}`}
      data-pane-id={paneId}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isFileDropTarget ? (
        <div className="pane-drop-overlay pane-drop-overlay--draft">
          <div className="pane-drop-overlay__center">Open in editor</div>
        </div>
      ) : dragState?.isActiveDropTarget ? (
        <div className="pane-drop-overlay pane-drop-overlay--draft">
          <div className="pane-drop-overlay__center">Move here</div>
        </div>
      ) : null}

      <div className="session-header">
        <div className="session-header-left">
          <StatusDot tone="neutral" className="session-dot session-dot-idle" />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{t("session.provider_select") || "New Session"}</span>
              <Tag color="neutral" className="session-state-badge">
                DRAFT
              </Tag>
            </div>
          </div>
        </div>

        <div className="session-header-actions">
          <Tooltip content="Split horizontal">
            <IconButton
              aria-label="Split horizontal"
              className="session-action-btn"
              icon={<FlipHorizontal size={13} />}
              onClick={handleSplitHorizontal}
              size="sm"
            />
          </Tooltip>
          <Tooltip content="Split vertical">
            <IconButton
              aria-label="Split vertical"
              className="session-action-btn"
              icon={<FlipVertical size={13} />}
              onClick={handleSplitVertical}
              size="sm"
            />
          </Tooltip>
          <Tooltip content="Close">
            <IconButton
              aria-label="Close"
              className="session-action-btn session-action-btn-close"
              icon={<X size={14} />}
              onClick={handleClosePane}
              size="sm"
            />
          </Tooltip>
        </div>
      </div>

      <div className="agent-draft-launcher">
        <div className="agent-draft-content">
          <div className="agent-draft-component">
            <div className="agent-draft-component-row">
              {/* Agent panel */}
              <div className="agent-draft-panel">
                <div className="agent-draft-panel-header">
                  <span className="agent-draft-panel-icon">
                    <ThemedIcon semantic="agent.provider.claude" size={13} />
                  </span>
                  <span className="agent-draft-panel-label">Agent</span>
                </div>

                <div className="agent-draft-panel-list">
                  {(
                    [
                      {
                        id: "claude",
                        title: "Claude",
                        icon: <ThemedIcon semantic="agent.provider.claude" size={18} />,
                        className: "agent-provider-card-claude",
                      },
                      {
                        id: "codex",
                        title: "Codex",
                        icon: <ThemedIcon semantic="agent.provider.codex" size={18} />,
                        className: "agent-provider-card-codex",
                      },
                    ] as const
                  ).map((provider) => {
                    const state = states[provider.id];
                    const guide = getProviderGuide(provider.id);
                    const isBusy =
                      state.loading ||
                      state.installJob?.status === "queued" ||
                      state.installJob?.status === "running";

                    return (
                      <Button
                        key={provider.id}
                        className={`agent-provider-card ${provider.className}`}
                        disabled={isAnyProviderBusy}
                        leadingIcon={
                          <span className="agent-provider-card-icon">{provider.icon}</span>
                        }
                        onClick={() => {
                          void launch(provider.id);
                        }}
                        trailingIcon={
                          <ArrowRight size={16} className="agent-provider-card-arrow" />
                        }
                        variant="secondary"
                      >
                        <span className="agent-provider-card-body">
                          <span className="agent-provider-card-title-row">
                            <span className="agent-provider-card-title">{provider.title}</span>
                          </span>
                          {isBusy ? (
                            <span className="agent-provider-card-status">
                              {t("provider.install.status.installing")}
                            </span>
                          ) : null}
                          {guide.message ? (
                            <span className="agent-provider-card-guide">
                              <span>{guide.message}</span>
                              {guide.docUrl ? (
                                <a
                                  href={guide.docUrl}
                                  onClick={(event) => event.stopPropagation()}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {t("provider.install.open_docs")}
                                </a>
                              ) : null}
                              <a
                                href={buildProviderDiagnosticsPath(provider.id)}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {t("diagnostics.actions.open_diagnostics")}
                              </a>
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>

              {/* File Editor panel */}
              <div className="agent-draft-panel">
                <div className="agent-draft-panel-header">
                  <span className="agent-draft-panel-icon">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </span>
                  <span className="agent-draft-panel-label">File Editor</span>
                </div>

                <div className="agent-draft-drop-zone">
                  <div className="agent-draft-drop-zone-icon">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <span className="agent-draft-drop-zone-title">拖入文件打开</span>
                </div>
              </div>
            </div>

            <div className="agent-draft-footer">点击启动 Agent 或直接拖拽文件到右侧区域打开</div>
          </div>
        </div>
      </div>
    </div>
  );
};
