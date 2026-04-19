/**
 * Agent Panes Feature
 *
 * Manages agent session panels with split layout support.
 * Each panel contains a terminal showing agent output.
 */

import type { FC } from 'react';
import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ArrowRight, Bot, Sparkles } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { sessionsAtom, sessionsByWorkspaceAtomFamily } from '../../atoms/sessions';
import { paneLayoutAtomFamily, type PaneNode } from '../../atoms/ui';
import { dispatchCommandAtom } from '../../atoms/connection';
import { useTranslation } from '../../lib/i18n';
import { PaneLayout } from './components/pane-layout';
import { SessionCard } from './components/session-card';
import type { Session } from '@coder-studio/core';
import {
  assignSessionToPane,
  closePaneBySessionId,
  paneLayoutHasSession,
  paneLayoutReferencesMissingSession,
  splitPaneBySessionId,
  sanitizePaneLayout,
} from './pane-layout-tree';

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
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));
  const initializedWorkspaceRef = useRef<string | null>(null);
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!workspace) {
      initializedWorkspaceRef.current = null;
      pendingSessionIdsRef.current.clear();
      return;
    }

    dispatch<Session[]>('session.list', { workspaceId: workspace.id })
      .then((result) => {
        if (!result.ok || !result.data) {
          console.error('Failed to fetch sessions:', result.error?.message);
          return;
        }

        const nextSessions = result.data;
        const nextSessionIds = new Set(nextSessions.map((session) => session.id));

        setSessions((prev) => {
          const next = Object.fromEntries(
            Object.entries(prev).filter(([, session]) => session.workspaceId !== workspace.id)
          );

          for (const session of nextSessions) {
            next[session.id] = session;
          }

          return next;
        });

        // Always sanitize: replace ended/removed session references with draft leaves
        // while preserving the full split structure.
        const liveSessionIds = new Set(
          nextSessions
            .filter((s) => s.state !== 'ended' && s.state !== 'unavailable')
            .map((s) => s.id)
        );

        const sanitized = sanitizePaneLayout(paneLayout, liveSessionIds);
        if (sanitized !== paneLayout) {
          setPaneLayout(sanitized);
          initializedWorkspaceRef.current = workspace.id;
          return;
        }

        // Only auto-assign first live session if layout has no sessions at all
        const hasAnySessionInLayout = collectSessionIds(paneLayout).length > 0;
        if (!hasAnySessionInLayout) {
          const liveSessions = nextSessions.filter(
            (s) => s.state !== 'ended' && s.state !== 'unavailable'
          );
          if (liveSessions.length > 0) {
            setPaneLayout({
              id: 'root',
              type: 'leaf',
              sessionId: liveSessions[0]!.id,
            });
          }
        }

        initializedWorkspaceRef.current = workspace.id;
      })
      .catch((error) => {
        console.error('Failed to fetch sessions:', error);
      });
  }, [workspace, dispatch, setSessions, setPaneLayout]);

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

  // Allow child DraftLaunchers to register newly created sessions so
  // the session.list refetch doesn't clobber splits.
  const handleSessionCreated = (sessionId: string) => {
    pendingSessionIdsRef.current.add(sessionId);
    setTimeout(() => pendingSessionIdsRef.current.delete(sessionId), 8000);
  };

  if (!workspace) {
    return (
      <div className="agent-panes-empty">
        <p>{t('workspace.no_workspace')}</p>
      </div>
    );
  }

  // If no sessions, show draft launcher
  if (sessions.length === 0) {
    return <DraftLauncher workspaceId={workspaceId} onSessionCreated={handleSessionCreated} />;
  }

  // Render pane tree recursively
  return (
    <div className="agent-panes">
      <PaneNodeRenderer node={paneLayout} workspaceId={workspaceId} onSessionCreated={handleSessionCreated} />
    </div>
  );
};

interface PaneNodeRendererProps {
  node: PaneNode;
  workspaceId: string;
  onSessionCreated?: (sessionId: string) => void;
}

/**
 * Recursively render pane tree
 */
const PaneNodeRenderer: FC<PaneNodeRendererProps> = ({ node, workspaceId, onSessionCreated }) => {
  if (node.type === 'leaf') {
    // Render session card or draft launcher
    if (node.sessionId) {
      return <SessionCard sessionId={node.sessionId} />;
    } else {
      return <DraftLauncher workspaceId={workspaceId} paneId={node.id} onSessionCreated={onSessionCreated} />;
    }
  }

  // Render split container
  return (
    <PaneLayout direction={node.direction || 'horizontal'} ratio={node.ratio || 0.5}>
      {node.children?.map((child) => (
        <PaneNodeRenderer key={child.id} node={child} workspaceId={workspaceId} onSessionCreated={onSessionCreated} />
      ))}
    </PaneLayout>
  );
};

interface DraftLauncherProps {
  workspaceId: string;
  paneId?: string;
  onSessionCreated?: (sessionId: string) => void;
}

/**
 * Draft Session Launcher
 *
 * PRD §8.4:
 *   - Provider selection buttons (Claude, Codex)
 *   - Click to start new session
 */
const DraftLauncher: FC<DraftLauncherProps> = ({ workspaceId, paneId, onSessionCreated }) => {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setSessions = useSetAtom(sessionsAtom);
  const setPaneLayout = useSetAtom(paneLayoutAtomFamily(workspaceId));

  const handleSelectProvider = async (provider: 'claude' | 'codex') => {
    const result = await dispatch<Session>('session.create', {
      workspaceId,
      providerId: provider,
    });

    if (result.ok && result.data) {
      const session = result.data;
      setSessions((prev) => ({
        ...prev,
        [session.id]: session,
      }));

      // Register so session.list refetch doesn't clobber split layout
      onSessionCreated?.(session.id);

      // Update pane layout to show the new session
      setPaneLayout((current) =>
        paneId
          ? assignSessionToPane(current, paneId, session.id)
          : {
              id: 'root',
              type: 'leaf',
              sessionId: session.id,
            }
      );
    } else {
      console.error('Failed to create session:', result.error?.message);
    }
  };

  return (
    <div className="agent-draft-launcher">
      <div className="agent-draft-content">
        <span className="agent-draft-kicker">SESSION LAUNCHER</span>
        <h3 className="agent-draft-title">{t('session.provider_select')}</h3>
        <p className="agent-draft-description">
          选择一个 AI 会话，在当前 workspace 里继续查看文件、运行命令和推进代码修改。
        </p>
        <div className="agent-draft-providers">
          <button
            className="btn btn-secondary agent-provider-card agent-provider-card-claude"
            onClick={() => handleSelectProvider('claude')}
          >
            <span className="agent-provider-card-icon">
              <Sparkles size={18} />
            </span>
            <span className="agent-provider-card-body">
              <span className="agent-provider-card-title-row">
                <span className="agent-provider-card-title">Claude</span>
                <span className="agent-provider-card-meta">analysis</span>
              </span>
              <span className="agent-provider-card-desc">
                更适合长上下文梳理、方案分析和代码审查。
              </span>
            </span>
            <ArrowRight size={16} className="agent-provider-card-arrow" />
          </button>
          <button
            className="btn btn-secondary agent-provider-card agent-provider-card-codex"
            onClick={() => handleSelectProvider('codex')}
          >
            <span className="agent-provider-card-icon">
              <Bot size={18} />
            </span>
            <span className="agent-provider-card-body">
              <span className="agent-provider-card-title-row">
                <span className="agent-provider-card-title">Codex</span>
                <span className="agent-provider-card-meta">workspace</span>
              </span>
              <span className="agent-provider-card-desc">
                更适合终端操作、直接改文件和逐步修复问题。
              </span>
            </span>
            <ArrowRight size={16} className="agent-provider-card-arrow" />
          </button>
        </div>
      </div>
    </div>
  );
};

function collectSessionIds(node: PaneNode): string[] {
  if (node.type === 'leaf') {
    return node.sessionId ? [node.sessionId] : [];
  }
  return (
    node.children?.flatMap((child) => collectSessionIds(child)) ?? []
  );
}

export default AgentPanes;