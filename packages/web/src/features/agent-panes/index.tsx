/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import type { FC } from 'react';
import { useEffect } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { ArrowRight, Bot, Sparkles, FlipHorizontal, FlipVertical, X } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from '../../atoms/sessions';
import { paneLayoutAtomFamily, type PaneNode } from '../../atoms/ui';
import { dispatchCommandAtom, connectionStatusAtom } from '../../atoms/connection';
import { useTranslation } from '../../lib/i18n';
import { PaneLayout } from './components/pane-layout';
import { SessionCard } from './components/session-card';
import type { Session } from '@coder-studio/core';
import type { ProviderId } from './use-provider-launcher';
import {
  assignSessionToPane,
  closePaneBySessionId,
  splitPaneBySessionId,
  sanitizePaneLayout,
  collectSessionIds,
} from './pane-layout-tree';
import { useProviderLauncher } from './use-provider-launcher';

interface PanelSplitDetail {
  sessionId?: string;
  direction?: 'horizontal' | 'vertical';
}

interface PanelCloseDetail {
  sessionId?: string;
}

/**
 * Agent Panes Container
 *
 * PRD §8:
 *   - Split panel layout (vertical/horizontal)
 *   - Multiple concurrent sessions
 *   - Each panel: terminal + session card
 *   - Draft launcher for new sessions
 */
export const AgentPanes: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceId = workspace?.id ?? '__workspace_empty__';
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const store = useStore();

  useEffect(() => {
    if (!workspace) {
      return;
    }

    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;
    dispatch<Session[]>('session.list', { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          console.error('Failed to fetch sessions:', result.error?.message);
          return;
        }

        const nextSessions = result.data;

        setSessions((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([, session]) => session.workspaceId !== workspace.id)
          );

          for (const session of nextSessions) {
            next[session.id] = session;
          }

          return next;
        });

        // Read layout from store to ensure we have the latest value
        const currentLayout = store.get(paneLayoutAtomFamily(workspaceId));

        // Always sanitize: replace ended/removed session references with draft leaves
        // while preserving the full split structure.
        const liveSessionIds = new Set(
          nextSessions
            .filter((s) => s.state !== 'ended')
            .map((s) => s.id)
        );

        const sanitized = sanitizePaneLayout(currentLayout, liveSessionIds);
        if (sanitized !== currentLayout) {
          setPaneLayout(sanitized);
          return;
        }

        // Only auto-assign first live session if layout has no sessions at all
        const hasAnySessionInLayout = collectSessionIds(currentLayout).length > 0;
        if (!hasAnySessionInLayout) {
          const liveSessions = nextSessions.filter(
            (s) => s.state !== 'ended'
          );
          if (liveSessions.length > 0) {
            setPaneLayout({
              id: 'root',
              type: 'leaf',
              sessionId: liveSessions[0]!.id,
            });
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to fetch sessions:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspace, workspaceId, connectionStatus, dispatch, setSessions, setPaneLayout, store]);

  useEffect(() => {
    const handlePanelSplit = (event: Event) => {
      const detail = (event as CustomEvent<PanelSplitDetail>).detail;

      if (!detail?.sessionId || !detail.direction) {
        return;
      }

      setPaneLayout((current) => splitPaneBySessionId(current, detail.sessionId!, detail.direction!));
    };

    const handlePanelClose = (event: Event) => {
      const detail = (event as CustomEvent<PanelCloseDetail>).detail;

      if (!detail?.sessionId) {
        return;
      }

      setPaneLayout((current) => closePaneBySessionId(current, detail.sessionId!));
    };

    window.addEventListener('coder-studio:panel-split', handlePanelSplit as EventListener);
    window.addEventListener('coder-studio:panel-close', handlePanelClose as EventListener);

    return () => {
      window.removeEventListener('coder-studio:panel-split', handlePanelSplit as EventListener);
      window.removeEventListener('coder-studio:panel-close', handlePanelClose as EventListener);
    };
  }, [setPaneLayout]);

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <p>{t('workspace.no_workspace')}</p>
      </div>
    );
  }

  // If no sessions, show draft launcher
  if (sessions.length === 0) {
    return <DraftLauncher workspaceId={workspaceId} />;
  }

  // Render pane tree recursively
  return (
    <div className="agent-panes">
      <PaneNodeRenderer node={paneLayout} workspaceId={workspaceId} />
    </div>
  );
};

interface PaneNodeRendererProps {
  node: PaneNode;
  workspaceId: string;
}

/**
 * Recursively render pane tree
 */
const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({ node, workspaceId }) => {
  if (node.type === 'leaf') {
    // Render session card or draft launcher
    if (node.sessionId) {
      return <SessionCard sessionId={node.sessionId} />;
    } else {
      return <DraftLauncher workspaceId={workspaceId} paneId={node.id} />;
    }
  }

  // Render split container
  return (
    <PaneLayout direction={node.direction || 'horizontal'} ratio={node.ratio || 0.5}>
      {node.children?.map((child) => (
        <PaneNodeRenderer key={child.id} node={child} workspaceId={workspaceId} />
      ))}
    </PaneLayout>
  );
};

interface DraftLauncherProps {
  workspaceId: string;
  paneId?: string;
}

/**
 * Draft Session Launcher
 *
 * PRD §8.4:
 *   - Provider selection buttons (Claude, Codex)
 *   - Click to start new session
 */
const DraftLauncher: FC<DraftLauncherProps> = ({ workspaceId, paneId }) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const { states, launch } = useProviderLauncher(
    dispatch,
    workspaceId,
    (session: Session, _providerId: ProviderId) => {
      setSessions((prev) => ({
        ...prev,
        [session.id]: session,
      }));

      setPaneLayout((current) =>
        paneId
          ? assignSessionToPane(current, paneId, session.id)
          : {
              id: 'root',
              type: 'leaf',
              sessionId: session.id,
            }
      );
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

  /**
   * Split handlers for draft pane
   */
  const handleSplitHorizontal = () => {
    if (!paneId) return;
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId: undefined, direction: 'horizontal' as const },
      })
    );
  };

  const handleSplitVertical = () => {
    if (!paneId) return;
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-split', {
        detail: { sessionId: undefined, direction: 'vertical' as const },
      })
    );
  };

  const handleClosePane = () => {
    if (!paneId) return;
    // Dispatch close with a special marker so the layout handler can find the draft pane
    window.dispatchEvent(
      new CustomEvent('coder-studio:panel-close', {
        detail: { sessionId: `__draft__${paneId}` },
      })
    );
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

export default AgentPanes;
