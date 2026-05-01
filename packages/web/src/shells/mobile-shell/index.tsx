import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { TerminalPanel } from '../../features/terminal-panel';
import { authEnabledAtom, connectionStatusAtom } from '../../atoms/connection';
import { activeWorkspaceAtom, orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from '../../atoms/workspaces';
import { LoginPage } from '../../features/auth';
import { AgentPanes } from '../../features/agent-panes';
import { SessionCard } from '../../features/agent-panes/components/session-card';
import { useWorkspaceSessions } from '../../features/agent-panes/use-workspace-sessions';
import { CommandPalette } from '../../features/command-palette';
import { ConfigDriftBanner } from '../../features/config-drift-banner';
import { ToastContainer } from '../../features/notifications';
import { SettingsPage } from '../../features/settings';
import { WelcomePage } from '../../features/welcome';
import { WorkspaceLaunchModal } from '../../features/workspace/components/workspace-launch-modal';
import { BranchQuickPick } from '../../features/workspace/components/branch-quick-pick';
import { useWorkspaceBootstrap } from '../shared/use-workspace-bootstrap';
import { MobileDock } from './mobile-dock';
import { MobileAgentStrip } from './mobile-agent-strip';
import { MobileComposer } from './mobile-composer';
import { MobileFilesSheet, type MobileFilesRoute } from './mobile-files-sheet';
import { MobileSheet } from './mobile-sheet';
import { MobileSupervisorBadge } from './mobile-supervisor-badge';
import { MobileSupervisorSheet } from './mobile-supervisor-sheet';
import { MobileTopBar } from './mobile-topbar';
import { MobileWorkspaceDrawer } from './mobile-workspace-drawer';
import { useVisualViewportInset } from './hooks/use-visual-viewport-inset';
import { collectSessionIds } from '../../features/agent-panes/pane-layout-tree';

type MobileSheetKind = 'files' | 'terminal' | 'supervisor' | null;

function MobileWorkspaceScaffold() {
  const navigate = useNavigate();
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const { sessions, paneLayout } = useWorkspaceSessions(activeWorkspace);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const [sheet, setSheet] = useState<MobileSheetKind>(null);
  const [filesRoute, setFilesRoute] = useState<MobileFilesRoute>({ kind: 'root' });
  const keyboardInset = useVisualViewportInset();
  const flattenedSessionIds = useMemo(() => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));

    return Array.from(new Set(collectSessionIds(paneLayout))).filter((sessionId) => sessionMap.has(sessionId));
  }, [paneLayout, sessions]);
  const orderedSessions = useMemo(() => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    return flattenedSessionIds
      .map((sessionId) => sessionMap.get(sessionId))
      .filter((session): session is NonNullable<typeof session> => Boolean(session));
  }, [flattenedSessionIds, sessions]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (orderedSessions.some((session) => session.id === activeSessionId)) {
      return;
    }

    const mostRecentSession = [...orderedSessions].sort((left, right) => right.lastActiveAt - left.lastActiveAt)[0];
    setActiveSessionId(mostRecentSession?.id ?? orderedSessions[0]?.id ?? null);
  }, [activeSessionId, orderedSessions]);

  const activeSession = orderedSessions.find((session) => session.id === activeSessionId) ?? null;

  const sheetBody =
    sheet === 'files'
      ? {
          title:
            filesRoute.kind === 'editor'
              ? filesRoute.path.split('/').pop() ?? 'Editor'
              : filesRoute.kind === 'diff'
                ? filesRoute.path.split('/').pop() ?? 'Diff'
                : 'Files',
          body: (
            activeWorkspaceId ? (
              <MobileFilesSheet workspaceId={activeWorkspaceId} onRouteChange={setFilesRoute} />
            ) : null
          ),
        }
      : sheet === 'terminal'
        ? {
            title: 'Terminal',
            body: (
              <div className="mobile-terminal-sheet">
                <TerminalPanel />
              </div>
            ),
          }
        : sheet === 'supervisor'
          ? {
              title: 'Supervisor',
              body:
                activeSession ? (
                  <MobileSupervisorSheet
                    sessionId={activeSession.id}
                    workspaceId={activeSession.workspaceId}
                  />
                ) : null,
            }
        : null;

  return (
    <div className="mobile-shell" data-testid="mobile-shell">
      <MobileTopBar
        activeWorkspace={activeWorkspace}
        drawerOpen={drawerOpen}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
      />

      <ConfigDriftBanner />

      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content">
          {orderedSessions.length > 0 ? (
            <>
              <MobileAgentStrip
                activeSessionId={activeSessionId}
                sessions={orderedSessions}
                onSelect={setActiveSessionId}
              />
              <MobileSupervisorBadge
                sessionId={activeSessionId}
                onOpen={() => setSheet('supervisor')}
              />

              {activeSession ? (
                <section className="mobile-shell__agent-stage">
                  <SessionCard
                    sessionId={activeSession.id}
                    showHeaderActions={false}
                    showSupervisorInline={false}
                    terminalReadOnlyOverride
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="mobile-shell__agent-empty" data-testid="mobile-agent-empty">
              <div className="mobile-shell__workspace-meta">
                <span className="mobile-shell__workspace-badge">
                  {activeWorkspace?.name ?? activeWorkspace?.path ?? 'No active workspace'}
                </span>
                <span className="mobile-shell__workspace-badge mobile-shell__workspace-badge--muted">
                  {workspaces.length} workspaces
                </span>
              </div>
              <AgentPanes />
            </section>
          )}
        </div>
      </main>

      <div
        className="mobile-shell__bottom-stack"
        data-testid="mobile-bottom-stack"
        style={{ paddingBottom: `${keyboardInset}px` }}
      >
        <MobileComposer activeSession={activeSession} />
        <MobileDock
          activeSheet={sheet}
          onSelectSheet={(nextSheet) => {
            setSheet(nextSheet);
            if (nextSheet !== 'files') {
              setFilesRoute({ kind: 'root' });
            }
          }}
        />
      </div>

      {sheetBody ? (
        <MobileSheet
          title={sheetBody.title}
          body={sheetBody.body}
          onClose={() => {
            setSheet(null);
            setFilesRoute({ kind: 'root' });
          }}
        />
      ) : null}

      <MobileWorkspaceDrawer
        activeWorkspaceId={activeWorkspaceId}
        isOpen={drawerOpen}
        workspaces={workspaces}
        onClose={() => setDrawerOpen(false)}
        onOpenSettings={() => navigate('/settings')}
        onOpenWorkspaceLauncher={() => setWorkspaceLaunchOpen(true)}
      />

      {workspaceLaunchOpen ? <WorkspaceLaunchModal onClose={() => setWorkspaceLaunchOpen(false)} /> : null}
    </div>
  );
}

export function MobileShell() {
  useWorkspaceBootstrap();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const authUnknown = authEnabled === null;

  return (
    <div className="app">
      {connectionStatus === 'reconnecting' && (
        <div className="connection-banner">
          <span>正在重新连接...</span>
        </div>
      )}
      {connectionStatus === 'rejected' && (
        <div className="connection-banner connection-banner--error">
          <span>另一个标签页已激活</span>
        </div>
      )}

      <main className="main-content">
        {authUnknown ? (
          <div className="app-loading-shell">
            <div className="app-loading-card">
              <div className="app-loading-kicker">CODER STUDIO</div>
              <h1 className="app-loading-title">正在连接工作区...</h1>
              <p className="app-loading-desc">正在同步认证与连接状态，随后会自动进入当前 workspace。</p>
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/auth" element={<LoginPage />} />
            <Route path="/workspace" element={<MobileWorkspaceScaffold />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        )}
      </main>

      <CommandPalette />
      <BranchQuickPick />
      <ToastContainer />
    </div>
  );
}
