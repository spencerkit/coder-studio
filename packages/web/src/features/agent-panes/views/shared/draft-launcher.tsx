import type { Session } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowRight, FlipHorizontal, FlipVertical, X } from "lucide-react";
import type { FC } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { sessionsAtom } from "../../../../atoms/sessions";
import { Button, IconButton, StatusDot, Tag, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { buildDiagnosticsPath } from "../../../diagnostics";
import type { PaneDropIntent } from "../../actions/pane-drag-types";
import { type ProviderId, useProviderLauncher } from "../../actions/use-provider-launcher";

interface DraftLauncherProps {
  workspaceId: string;
  paneId?: string;
  onAssignSession?: (paneId: string, sessionId: string) => void;
  onClosePane?: (paneId: string) => void;
  onPaneDrop?: (intent: PaneDropIntent) => void;
  onReplaceWithSession?: (sessionId: string) => void;
  onSplitPane?: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export const DraftLauncher: FC<DraftLauncherProps> = ({
  workspaceId,
  paneId,
  onAssignSession,
  onClosePane,
  onPaneDrop: _onPaneDrop,
  onReplaceWithSession,
  onSplitPane,
}) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
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

  const getProviderCta = (providerId: ProviderId): string => {
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

  return (
    <div className="session-card agent-pane">
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
          <span className="agent-draft-kicker">SESSION LAUNCHER</span>
          <p className="agent-draft-description">
            选择一个 AI 会话，在当前 workspace 里继续查看文件、运行命令和推进代码修改。
          </p>
          <div className="agent-draft-providers">
            {(
              [
                {
                  id: "claude",
                  title: "Claude",
                  meta: "analysis",
                  icon: <ThemedIcon semantic="agent.provider.claude" size={18} />,
                  description: "更适合长上下文梳理、方案分析和代码审查。",
                  className: "agent-provider-card-claude",
                },
                {
                  id: "codex",
                  title: "Codex",
                  meta: "workspace",
                  icon: <ThemedIcon semantic="agent.provider.codex" size={18} />,
                  description: "更适合终端操作、直接改文件和逐步修复问题。",
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
                  leadingIcon={<span className="agent-provider-card-icon">{provider.icon}</span>}
                  onClick={() => {
                    void launch(provider.id);
                  }}
                  trailingIcon={<ArrowRight size={16} className="agent-provider-card-arrow" />}
                  variant="secondary"
                >
                  <span className="agent-provider-card-body">
                    <span className="agent-provider-card-title-row">
                      <span className="agent-provider-card-title">{provider.title}</span>
                      <span className="agent-provider-card-meta">{provider.meta}</span>
                    </span>
                    <span className="agent-provider-card-desc">{provider.description}</span>
                    <span className="agent-provider-card-cta">{getProviderCta(provider.id)}</span>
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
      </div>
    </div>
  );
};
