import type { Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowRight, FlipHorizontal, FlipVertical, GripVertical, X } from "lucide-react";
import { type DragEvent, type FC, type PointerEvent, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { Button, IconButton, StatusDot, Tag, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  getWorkspacePathDragPayload,
  hasWorkspacePathDragType,
} from "../../../../lib/workspace-path-drag";
import { buildDiagnosticsPath } from "../../../diagnostics";
import type { PaneDropIntent, PaneDropPlacement } from "../../actions/pane-drag-types";
import type { PaneDragSourceSnapshot } from "../../actions/use-pane-drag-controller";
import { usePaneDragEnabled } from "../../actions/use-pane-drag-enabled";
import { type ProviderId, useProviderLauncher } from "../../actions/use-provider-launcher";

const COMPACT_CAROUSEL_MAX_WIDTH_REM = 28;
const COMPACT_CAROUSEL_INTERVAL_MS = 4000;

function getCompactCarouselMaxWidthPx(): number {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return COMPACT_CAROUSEL_MAX_WIDTH_REM * 16;
  }

  const rootFontSize = window.getComputedStyle(document.documentElement).fontSize;
  const parsedRootFontSize = Number.parseFloat(rootFontSize);

  if (!Number.isFinite(parsedRootFontSize) || parsedRootFontSize <= 0) {
    return COMPACT_CAROUSEL_MAX_WIDTH_REM * 16;
  }

  return COMPACT_CAROUSEL_MAX_WIDTH_REM * parsedRootFontSize;
}

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
  const [activePanel, setActivePanel] = useState<"agent" | "file">("agent");
  const [isCompactCarousel, setIsCompactCarousel] = useState(false);
  const [isFileDropTarget, setIsFileDropTarget] = useState(false);
  const draftLauncherRef = useRef<HTMLDivElement | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const supportsPaneDrag = usePaneDragEnabled();
  const canDragPane = supportsPaneDrag && Boolean(paneId && onPaneDragStart);
  const paneDropOverlayPlacement = dragState?.isActiveDropTarget ? dragState.hoverPlacement : null;
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

  const handleCarouselPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      return;
    }

    swipeStartXRef.current = event.clientX;
  };

  const handleCarouselPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const startX = swipeStartXRef.current;
    swipeStartXRef.current = null;

    if (startX === null || event.pointerType === "mouse") {
      return;
    }

    const deltaX = event.clientX - startX;
    if (Math.abs(deltaX) < 48) {
      return;
    }

    setActivePanel(deltaX < 0 ? "file" : "agent");
  };

  const handleCarouselPointerCancel = () => {
    swipeStartXRef.current = null;
  };

  useEffect(() => {
    const element = draftLauncherRef.current;

    if (!element) {
      return;
    }

    const updateCompactState = (width: number) => {
      setIsCompactCarousel(width > 0 && width <= getCompactCarouselMaxWidthPx());
    };

    updateCompactState(element.getBoundingClientRect().width);

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];

        if (!entry) {
          return;
        }

        updateCompactState(entry.contentRect.width || entry.target.getBoundingClientRect().width);
      });

      observer.observe(element);

      return () => {
        observer.disconnect();
      };
    }

    const handleWindowResize = () => {
      updateCompactState(element.getBoundingClientRect().width);
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (!isCompactCarousel) {
      return;
    }

    const timer = window.setTimeout(() => {
      setActivePanel((currentPanel) => (currentPanel === "agent" ? "file" : "agent"));
    }, COMPACT_CAROUSEL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activePanel, isCompactCarousel]);

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
          <div className="agent-draft-component">
            <div
              className={`agent-draft-component-row${activePanel === "file" ? " agent-draft-component-row--file" : ""}`}
              onPointerCancel={handleCarouselPointerCancel}
              onPointerDown={handleCarouselPointerDown}
              onPointerUp={handleCarouselPointerUp}
            >
              <div className="agent-draft-panel">
                <div className="agent-draft-panel-header">
                  <span className="agent-draft-panel-icon">
                    <ThemedIcon semantic="agent.provider.claude" size={13} />
                  </span>
                  <span className="agent-draft-panel-label">{t("agent_panes.agent_panel")}</span>
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
                  <span className="agent-draft-panel-label">{t("agent_panes.file_editor")}</span>
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
              </div>
            </div>

            <div
              className="agent-draft-carousel-dots"
              role="group"
              aria-label={t("agent_panes.draft_panels")}
            >
              {[
                { id: "agent" as const, label: t("agent_panes.agent_panel") },
                { id: "file" as const, label: t("agent_panes.file_editor") },
              ].map((panel) => (
                <button
                  key={panel.id}
                  aria-label={panel.label}
                  aria-pressed={activePanel === panel.id}
                  className={`agent-draft-carousel-dot${activePanel === panel.id ? " agent-draft-carousel-dot--active" : ""}`}
                  onClick={() => setActivePanel(panel.id)}
                  type="button"
                />
              ))}
            </div>

            <div className="agent-draft-footer">{t("agent_panes.draft_footer")}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
