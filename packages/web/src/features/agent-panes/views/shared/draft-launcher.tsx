import type { Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { FlipHorizontal, FlipVertical, GripVertical, X } from "lucide-react";
import { type DragEvent, type FC, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { Button, IconButton, StatusDot, Tag, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  getSkillPathDragPayload,
  hasSkillPathDragType,
  isSkillPathDragPayload,
  SKILL_PATH_DRAG_END_EVENT,
  SKILL_PATH_DRAG_START_EVENT,
  type SkillPathDragPayload,
  toSkillDragEditorPath,
} from "../../../../lib/skill-path-drag";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../../lib/workspace-path-drag";
import { buildDiagnosticsPath } from "../../../diagnostics";
import type { PaneDropIntent, PaneDropPlacement } from "../../actions/pane-drag-types";
import type { PaneDragSourceSnapshot } from "../../actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "../../actions/use-pane-drag-enabled";
import { type ProviderId, useProviderLauncher } from "../../actions/use-provider-launcher";

interface DraftLauncherDragState {
  isDragging: boolean;
  isActiveDropTarget: boolean;
  hoverPlacement: PaneDropPlacement | null;
}

interface DraftLauncherProps {
  dragState?: DraftLauncherDragState;
  workspaceId: string;
  paneId?: string;
  onPaneDragStart?: (source: PaneDragSourceSnapshot) => void;
  onAssignSession?: (paneId: string, sessionId: string) => void;
  onClosePane?: (paneId: string) => void;
  onOpenFile?: (paneId: string, path: string) => void;
  onPaneDrop?: (intent: PaneDropIntent) => void;
  onReplaceWithSession?: (sessionId: string) => void;
  onSplitPane?: (paneId: string, direction: "horizontal" | "vertical") => void;
}

const knownProviderMonogramClasses = new Set(["claude", "codex", "gemini", "cursor", "opencode"]);
const fallbackProviderTones = ["accent", "info", "success", "warning"] as const;

export const DraftLauncher: FC<DraftLauncherProps> = ({
  dragState,
  workspaceId,
  paneId,
  onPaneDragStart,
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
  const [skillPathDragPayload, setSkillPathDragPayload] = useState<SkillPathDragPayload | null>(
    null
  );
  const draftLauncherRef = useRef<HTMLDivElement | null>(null);
  const supportsPaneDrag = usePaneDragEnabled();
  const canDragPane = supportsPaneDrag && Boolean(paneId && onPaneDragStart);
  const paneDropOverlayPlacement = dragState?.isActiveDropTarget ? dragState.hoverPlacement : null;
  const { providers, states, launch } = useProviderLauncher(
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

  const getProviderFallbackToneClass = (providerId: string) => {
    if (knownProviderMonogramClasses.has(providerId)) {
      return "";
    }

    const toneIndex =
      Array.from(providerId).reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      fallbackProviderTones.length;

    return `agent-provider-card-monogram--tone-${fallbackProviderTones[toneIndex]}`;
  };

  const renderProviderIcon = (title: string, providerId: string) => {
    const fallbackToneClass = getProviderFallbackToneClass(providerId);

    return (
      <span
        aria-hidden="true"
        className={`agent-provider-card-monogram agent-provider-card-monogram--${providerId}${fallbackToneClass ? ` ${fallbackToneClass}` : ""}`}
      >
        {title.slice(0, 2).toUpperCase()}
      </span>
    );
  };

  const buildProviderDiagnosticsPath = (providerId: ProviderId) =>
    buildDiagnosticsPath({
      context: "session_start",
      workspaceId,
      providerId,
      paneId,
      launchMode: paneId ? "assign" : "replace",
    });

  const canAutoInstall = (providerId: ProviderId): boolean => {
    const runtime = states[providerId]?.runtime;
    return Boolean(runtime?.autoInstallSupported && runtime.installReadiness === "ready");
  };

  const getProviderCta = (providerId: ProviderId): string => {
    const state = states[providerId];
    if (!state) {
      return t("provider.install.cta.start");
    }

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
    if (!state) {
      return {};
    }

    if (state.runtime?.available) {
      return {
        docUrl: state.runtime.docUrls.provider,
      };
    }

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

    const workspacePayload = getWorkspacePathDragPayload(event.dataTransfer);
    if (workspacePayload) {
      if (workspacePayload.workspaceId !== workspaceId || workspacePayload.kind !== "file") {
        return null;
      }

      return workspacePayload.path;
    }

    const skillPayload = getSkillPathDragPayload(event.dataTransfer) ?? skillPathDragPayload;
    return skillPayload?.kind === "file" ? toSkillDragEditorPath(skillPayload) : null;
  };

  useEffect(() => {
    const handleSkillPathDragStart = (event: Event) => {
      const payload = event instanceof CustomEvent ? event.detail : null;
      setSkillPathDragPayload(isSkillPathDragPayload(payload) ? payload : null);
    };
    const handleSkillPathDragEnd = () => {
      setSkillPathDragPayload(null);
      setIsFileDropTarget(false);
    };

    window.addEventListener(SKILL_PATH_DRAG_START_EVENT, handleSkillPathDragStart);
    window.addEventListener(SKILL_PATH_DRAG_END_EVENT, handleSkillPathDragEnd);
    return () => {
      window.removeEventListener(SKILL_PATH_DRAG_START_EVENT, handleSkillPathDragStart);
      window.removeEventListener(SKILL_PATH_DRAG_END_EVENT, handleSkillPathDragEnd);
    };
  }, []);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!paneId) {
      return;
    }

    const hasWorkspacePath = hasWorkspacePathDragType(event.dataTransfer);
    const hasSkillPath = hasSkillPathDragType(event.dataTransfer);
    if (!hasWorkspacePath && !hasSkillPath) {
      return;
    }

    event.preventDefault();

    if (hasWorkspacePath) {
      setIsFileDropTarget(true);
      return;
    }

    if (resolveDroppedFilePath(event)) {
      setIsFileDropTarget(true);
      return;
    }

    setIsFileDropTarget(false);
  };

  const handleDragLeave = () => {
    setIsFileDropTarget(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const path = resolveDroppedFilePath(event);
    event.preventDefault();
    setIsFileDropTarget(false);
    if (!path || !paneId) {
      return;
    }

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
          <div className="pane-drop-overlay__center">{t("agent_panes.open_in_editor")}</div>
        </div>
      ) : paneDropOverlayPlacement ? (
        <div className={`pane-drop-overlay pane-drop-overlay--${paneDropOverlayPlacement}`}>
          <div className="pane-drop-overlay__center">{t("agent_panes.move_here")}</div>
        </div>
      ) : null}

      <div className="session-header">
        <div className="session-header-left">
          <StatusDot tone="neutral" className="session-dot session-dot-idle" />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{t("session.provider_select")}</span>
              <Tag color="neutral" className="session-state-badge">
                {t("session.state.draft")}
              </Tag>
            </div>
          </div>
        </div>

        <div className="session-header-actions">
          {canDragPane ? (
            <Tooltip content={t("agent_panes.drag_pane")}>
              <IconButton
                aria-label={t("agent_panes.drag_pane")}
                className="session-action-btn session-action-btn-drag"
                data-session-action="drag"
                icon={<GripVertical size={13} />}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();

                  if (event.pointerType === "touch") {
                    return;
                  }

                  if (!paneId) {
                    return;
                  }

                  onPaneDragStart?.({ paneId });
                }}
                size="sm"
              />
            </Tooltip>
          ) : null}
          <Tooltip content={t("agent_panes.split_horizontal")}>
            <IconButton
              aria-label={t("agent_panes.split_horizontal")}
              className="session-action-btn"
              data-session-action="split-horizontal"
              icon={<FlipHorizontal size={13} />}
              onClick={handleSplitHorizontal}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("agent_panes.split_vertical")}>
            <IconButton
              aria-label={t("agent_panes.split_vertical")}
              className="session-action-btn"
              data-session-action="split-vertical"
              icon={<FlipVertical size={13} />}
              onClick={handleSplitVertical}
              size="sm"
            />
          </Tooltip>
          <Tooltip content={t("action.close")}>
            <IconButton
              aria-label={t("action.close")}
              className="session-action-btn session-action-btn-close"
              data-session-action="close"
              icon={<X size={14} />}
              onClick={handleClosePane}
              size="sm"
            />
          </Tooltip>
        </div>
      </div>

      <div className="agent-draft-launcher" ref={draftLauncherRef}>
        <div className="agent-draft-content">
          <div className="agent-draft-workarea">
            <div className="agent-draft-component-row agent-draft-workarea-body">
              <section className="agent-draft-workarea-main">
                <div className="agent-draft-panel-header">
                  <span className="agent-draft-panel-label">
                    {t("agent_panes.draft_agent_header")}
                  </span>
                </div>

                <div className="agent-draft-panel-list">
                  {providers.map((provider) => {
                    const state = states[provider.id];
                    if (!state) {
                      return null;
                    }

                    const guide = getProviderGuide(provider.id);
                    const isBusy =
                      state.loading ||
                      state.installJob?.status === "queued" ||
                      state.installJob?.status === "running";
                    const title = provider.badge || provider.displayName || provider.id;
                    const cardClasses = [
                      "agent-provider-card",
                      `agent-provider-card-${provider.id}`,
                      provider.stability ? `agent-provider-card--${provider.stability}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <Button
                        key={provider.id}
                        className={cardClasses}
                        disabled={isAnyProviderBusy}
                        leadingIcon={
                          <span className="agent-provider-card-icon">
                            {renderProviderIcon(title, provider.id)}
                          </span>
                        }
                        onClick={() => {
                          void launch(provider.id);
                        }}
                        variant="secondary"
                      >
                        <span className="agent-provider-card-body">
                          <span className="agent-provider-card-copy">
                            <span className="agent-provider-card-title-row">
                              <span className="agent-provider-card-title">{title}</span>
                            </span>
                          </span>
                          <span className="agent-provider-card-meta">
                            <span className="agent-provider-card-cta">
                              {getProviderCta(provider.id)}
                            </span>
                            {isBusy ? (
                              <span className="agent-provider-card-status">
                                {t("provider.install.status.installing")}
                              </span>
                            ) : null}
                          </span>
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
              </section>

              <section className="agent-draft-workarea-side">
                <div className="agent-draft-panel-header">
                  <span className="agent-draft-panel-label">
                    {t("agent_panes.draft_file_header")}
                  </span>
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
                  <span className="agent-draft-drop-zone-title">
                    {t("agent_panes.drop_file_to_open")}
                  </span>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
