import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ArrowRight, Bot, Sparkles, FlipHorizontal, FlipVertical, X } from 'lucide-react';
import type { Session } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../../atoms/connection';
import { sessionsAtom } from '../../../../atoms/sessions';
import { useTranslation } from '../../../../lib/i18n';
import { useProviderLauncher, type ProviderId } from '../../actions/use-provider-launcher';

interface DraftLauncherProps {
  workspaceId: string;
  paneId?: string;
  onAssignSession?: (paneId: string, sessionId: string) => void;
  onClosePane?: (paneId: string) => void;
  onReplaceWithSession?: (sessionId: string) => void;
  onSplitPane?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
}

export const DraftLauncher: FC<DraftLauncherProps> = ({
  workspaceId,
  paneId,
  onAssignSession,
  onClosePane,
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
  );

  const getProviderCta = (providerId: ProviderId): string => {
    const state = states[providerId];
    if (state.loading || state.installJob?.status === 'queued' || state.installJob?.status === 'running') {
      return t('provider.install.cta.installing');
    }
    if (state.runtime?.available) {
      return t('provider.install.cta.start');
    }
    if (state.runtime?.autoInstallSupported) {
      return t('provider.install.cta.install_and_start');
    }
    return t('provider.install.cta.manual');
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

    if (state.inlineError && state.inlineError !== 'manual') {
      return {
        message: state.inlineError,
        docUrl: state.runtime?.docUrls.provider,
      };
    }

    if (state.inlineError === 'manual' || state.runtime?.autoInstallSupported === false) {
      return {
        message: state.runtime?.manualGuideKeys.map((key) => t(key)).join(' '),
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
      state.installJob?.status === 'queued' ||
      state.installJob?.status === 'running',
  );

  const handleSplitHorizontal = () => {
    if (!paneId) return;
    onSplitPane?.(paneId, 'horizontal');
  };

  const handleSplitVertical = () => {
    if (!paneId) return;
    onSplitPane?.(paneId, 'vertical');
  };

  const handleClosePane = () => {
    if (!paneId) return;
    onClosePane?.(paneId);
  };

  return (
    <div className="session-card agent-pane">
      <div className="session-header">
        <div className="session-header-left">
          <span className="session-dot session-dot-idle" />
          <div className="session-header-copy">
            <div className="session-title-row">
              <span className="session-title">{t('session.provider_select') || 'New Session'}</span>
              <span className="session-state-badge badge badge-gray">DRAFT</span>
            </div>
          </div>
        </div>

        <div className="session-header-actions">
          <button
            className="session-action-btn"
            onClick={handleSplitHorizontal}
            title="Split horizontal"
            aria-label="Split horizontal"
          >
            <FlipHorizontal size={13} />
          </button>
          <button
            className="session-action-btn"
            onClick={handleSplitVertical}
            title="Split vertical"
            aria-label="Split vertical"
          >
            <FlipVertical size={13} />
          </button>
          <button
            className="session-action-btn session-action-btn-close"
            onClick={handleClosePane}
            title="Close"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="agent-draft-launcher">
        <div className="agent-draft-content">
          <span className="agent-draft-kicker">SESSION LAUNCHER</span>
          <p className="agent-draft-description">
            选择一个 AI 会话，在当前 workspace 里继续查看文件、运行命令和推进代码修改。
          </p>
          <div className="agent-draft-providers">
            {([
              {
                id: 'claude',
                title: 'Claude',
                meta: 'analysis',
                icon: <Sparkles size={18} />,
                description: '更适合长上下文梳理、方案分析和代码审查。',
                className: 'agent-provider-card-claude',
              },
              {
                id: 'codex',
                title: 'Codex',
                meta: 'workspace',
                icon: <Bot size={18} />,
                description: '更适合终端操作、直接改文件和逐步修复问题。',
                className: 'agent-provider-card-codex',
              },
            ] as const).map((provider) => {
              const state = states[provider.id];
              const guide = getProviderGuide(provider.id);
              const isBusy =
                state.loading ||
                state.installJob?.status === 'queued' ||
                state.installJob?.status === 'running';

              return (
                <button
                  key={provider.id}
                  className={`btn btn-secondary agent-provider-card ${provider.className}`}
                  disabled={isAnyProviderBusy}
                  onClick={() => {
                    void launch(provider.id);
                  }}
                >
                  <span className="agent-provider-card-icon">{provider.icon}</span>
                  <span className="agent-provider-card-body">
                    <span className="agent-provider-card-title-row">
                      <span className="agent-provider-card-title">{provider.title}</span>
                      <span className="agent-provider-card-meta">{provider.meta}</span>
                    </span>
                    <span className="agent-provider-card-desc">{provider.description}</span>
                    <span className="agent-provider-card-cta">{getProviderCta(provider.id)}</span>
                    {isBusy ? (
                      <span className="agent-provider-card-status">
                        {t('provider.install.status.installing')}
                      </span>
                    ) : null}
                    {guide.message ? (
                      <span className="agent-provider-card-guide">
                        <span>{guide.message}</span>
                        {guide.docUrl ? (
                          <a href={guide.docUrl} target="_blank" rel="noreferrer">
                            {t('provider.install.open_docs')}
                          </a>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight size={16} className="agent-provider-card-arrow" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
