import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { TerminalPanel } from '../../../terminal-panel';
import { AgentPanes } from '../../../agent-panes';
import { SessionCard } from '../../../agent-panes/views/shared/session-card';
import { MobileSupervisorBadge } from '../../../supervisor/views/mobile/mobile-supervisor-badge';
import { MobileSupervisorSheet } from '../../../supervisor/views/mobile/mobile-supervisor-sheet';
import { ConfigDriftBanner } from '../../../config-drift-banner';
import { WorkspaceLaunchModal } from '../shared/workspace-launch-modal';
import { useWorkspaceScreenModel } from '../../actions/use-workspace-screen-model';
import { MobileDock } from './mobile-dock';
import { MobileFilesSheet } from './mobile-files-sheet';
import { MobileSheet } from './mobile-sheet';
import { MobileTopBar } from './mobile-topbar';
import { MobileWorkspaceDrawer } from './mobile-workspace-drawer';
import { useVisualViewportInset } from './hooks/use-visual-viewport-inset';
import { useMobileLayoutMode } from './hooks/use-mobile-layout-mode';
import { useMobileMotionMode } from './hooks/use-mobile-motion-mode';
import { pendingFocusSessionAtom } from '../../../../atoms/app-ui';
import { useAtomValue } from 'jotai';

export function WorkspaceMobileView() {
  const navigate = useNavigate();
  const pendingFocusSessionId = useAtomValue(pendingFocusSessionAtom);
  const {
    activeSession,
    activeWorkspaceId,
    closeMobileSheet,
    mobileActiveSessionId,
    mobileFilesRoute,
    mobileSheet,
    openMobileSheet,
    orderedSessions,
    selectMobileSession,
    updateMobileFilesRoute,
    workspace,
    workspaces,
  } = useWorkspaceScreenModel();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [workspaceLaunchOpen, setWorkspaceLaunchOpen] = useState(false);
  const keyboardInset = useVisualViewportInset();
  const layoutMode = useMobileLayoutMode();
  const motionMode = useMobileMotionMode();

  useEffect(() => {
    if (!pendingFocusSessionId) {
      return;
    }

    if (pendingFocusSessionId === mobileActiveSessionId) {
      return;
    }

    if (orderedSessions.some((session) => session.id === pendingFocusSessionId)) {
      selectMobileSession(pendingFocusSessionId);
    }
  }, [mobileActiveSessionId, orderedSessions, pendingFocusSessionId, selectMobileSession]);

  const sheetBody =
    mobileSheet === 'files'
      ? {
          title:
            mobileFilesRoute.kind === 'editor'
              ? mobileFilesRoute.path.split('/').pop() ?? 'Editor'
              : mobileFilesRoute.kind === 'diff'
                ? mobileFilesRoute.path.split('/').pop() ?? 'Diff'
                : 'Files',
          body: (
            activeWorkspaceId ? (
              <MobileFilesSheet
                workspaceId={activeWorkspaceId}
                route={mobileFilesRoute}
                onRouteChange={updateMobileFilesRoute}
              />
            ) : null
          ),
        }
      : mobileSheet === 'terminal'
        ? {
            title: 'Terminal',
            body: (
              <div className="mobile-terminal-sheet">
                <TerminalPanel />
              </div>
            ),
          }
        : null;

  return (
    <div
      className={`mobile-shell mobile-shell--${layoutMode} mobile-shell--motion-${motionMode}`}
      data-testid="mobile-shell"
      data-layout-mode={layoutMode}
      data-motion-mode={motionMode}
    >
      <MobileTopBar
        activeWorkspace={workspace}
        activeSessionId={mobileActiveSessionId}
        drawerOpen={drawerOpen}
        sessions={orderedSessions}
        onSelectSession={selectMobileSession}
        onToggleDrawer={() => setDrawerOpen((value) => !value)}
      />

      <ConfigDriftBanner />

      <main className="mobile-shell__viewport">
        <div className="mobile-shell__content">
          {orderedSessions.length > 0 ? (
            <>
              {activeSession ? (
                <section className="mobile-shell__agent-stage">
                  <SessionCard
                    sessionId={activeSession.id}
                    showHeaderActions={false}
                    showSupervisorInline={false}
                    headerAccessory={
                      <MobileSupervisorBadge
                        sessionId={activeSession.id}
                        onOpen={() => openMobileSheet('supervisor')}
                      />
                    }
                  />
                </section>
              ) : null}
            </>
          ) : (
            <section className="mobile-shell__agent-empty" data-testid="mobile-agent-empty">
              <div className="mobile-shell__workspace-meta">
                <span className="mobile-shell__workspace-badge">
                  {workspace?.name ?? workspace?.path ?? 'No active workspace'}
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
        style={{ '--mobile-keyboard-inset': `${keyboardInset}px` } as CSSProperties}
      >
        <MobileDock activeSheet={mobileSheet} onSelectSheet={openMobileSheet} />
      </div>

      {mobileSheet === 'supervisor' && activeSession ? (
        <MobileSupervisorSheet
          sessionId={activeSession.id}
          workspaceId={activeSession.workspaceId}
          onClose={closeMobileSheet}
        />
      ) : null}

      {sheetBody ? (
        <MobileSheet
          title={sheetBody.title}
          body={sheetBody.body}
          onClose={closeMobileSheet}
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

export default WorkspaceMobileView;
