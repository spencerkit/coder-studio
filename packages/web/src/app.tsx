/**
 * Application Shell
 *
 * Root component that sets up:
 * - Router (BrowserRouter)
 * - UI layout with connection status banner
 */

import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { connectionStatusAtom, authEnabledAtom, dispatchCommandAtom } from './atoms';
import { authenticatedAtom } from './atoms/ui';
import {
  orderedWorkspacesAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from './atoms/workspaces';
import { WelcomePage } from './features/welcome';
import { SettingsPage } from './features/settings';
import { WorkspacePage } from './features/workspace';
import { CommandPalette } from './features/command-palette';
import { BranchQuickPick } from './features/workspace/components/branch-quick-pick';
import { LoginPage } from './features/auth';
import { ConfigDriftBanner } from './features/config-drift-banner';
import { ToastContainer } from './features/notifications';
import { useSetAtom } from 'jotai';
import type { Workspace } from '@coder-studio/core';

function useWorkspaceBootstrap() {
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    const authRequired = authEnabled === true;
    if (authRequired && !authenticated) {
      if (location.pathname !== '/auth') {
        navigate('/auth', { replace: true });
      }
      return;
    }

    if (location.pathname === '/auth') {
      navigate('/', { replace: true });
      return;
    }

    if (location.pathname !== '/' && location.pathname !== '/workspace') {
      return;
    }

    if (connectionStatus !== 'connected') {
      return;
    }

    if (workspacesLoadState === 'idle') {
      const requestId = bootstrapRequestIdRef.current + 1;
      bootstrapRequestIdRef.current = requestId;

      setWorkspacesLoadState('loading');
      setWorkspacesLoadError(null);

      dispatch<Workspace[]>('workspace.list', {})
        .then((result) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }

          if (!result.ok) {
            setWorkspacesLoadState('error');
            setWorkspacesLoadError(result.error?.message ?? 'Failed to fetch workspace list');
            return;
          }

          const nextWorkspaces = Array.isArray(result.data) ? result.data : [];
          const wsMap: Record<string, Workspace> = {};
          for (const workspace of nextWorkspaces) {
            wsMap[workspace.id] = workspace;
          }

          setWorkspaces(wsMap);
          setWorkspaceOrder(nextWorkspaces.map((workspace) => workspace.id));
          setWorkspacesLoadState('ready');
          setWorkspacesLoadError(null);
        })
        .catch((error) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspacesLoadState('error');
          setWorkspacesLoadError(error instanceof Error ? error.message : 'Failed to fetch workspace list');
        });
      return;
    }

    if (workspacesLoadState !== 'ready') {
      return;
    }

    if (location.pathname === '/' && workspaces.length > 0) {
      navigate('/workspace', { replace: true });
      return;
    }

    if (location.pathname === '/workspace' && workspaces.length === 0) {
      navigate('/', { replace: true });
    }
  }, [
    authEnabled,
    authenticated,
    connectionStatus,
    dispatch,
    location.pathname,
    navigate,
    setWorkspaceOrder,
    setWorkspaces,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    workspaces.length,
    workspacesLoadState,
  ]);
}

function AppShell() {
  useWorkspaceBootstrap();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authRequired = authEnabled === true;
  const authUnknown = authEnabled === null;
  const shouldShowLogin = authRequired && !authenticated && location.pathname === '/auth';
  const shouldShowGlobalConfigDriftBanner =
    !shouldShowLogin && !authUnknown && !location.pathname.startsWith('/settings');

  return (
    <div className="app">
      {/* Connection status indicator */}
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

      {/*
        Codex config.toml drift banner: shows only when the server detects
        interfering settings in the user's ~/.codex/config.toml. Hidden for
        unauthenticated users (WS not fully usable yet) and during login.
        The settings page renders its own embedded copy to avoid duplicate UI.
      */}
      {shouldShowGlobalConfigDriftBanner && <ConfigDriftBanner />}

      {/* Main content with routing */}
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
            <Route path="/workspace" element={<WorkspacePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        )}
      </main>

      {/* Command Palette (global overlay) */}
      <CommandPalette />
      <BranchQuickPick />
      <ToastContainer />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
