/**
 * Application Shell
 *
 * Root component that sets up:
 * - Router (BrowserRouter)
 * - UI layout with connection status banner
 */

import { useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { connectionStatusAtom, authEnabledAtom } from './atoms';
import { authenticatedAtom } from './atoms/ui';
import { orderedWorkspacesAtom } from './atoms/workspaces';
import { WelcomePage } from './features/welcome';
import { SettingsPage } from './features/settings';
import { WorkspacePage } from './features/workspace';
import { CommandPalette } from './features/command-palette';
import { BranchQuickPick } from './features/workspace/components/branch-quick-pick';
import { LoginPage } from './features/auth';
import { ConfigDriftBanner } from './features/config-drift-banner';
import { ToastContainer } from './features/notifications';

/**
 * Hook to auto-navigate to workspace if authenticated and has workspaces
 */
function useAutoWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);

  useEffect(() => {
    if (location.pathname !== '/') return;
    if (authEnabled === true && !authenticated) return;
    if (authEnabled === null) return;
    if (workspaces.length > 0) {
      navigate('/workspace', { replace: true });
    }
  }, [location.pathname, authenticated, authEnabled, workspaces.length, navigate]);
}

/**
 * Root Route Component
 *
 * Shows the Welcome page.
 */
function RootRoute() {
  useAutoWorkspace();
  return <WelcomePage />;
}

function AppShell() {
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authRequired = authEnabled === true;
  const authUnknown = authEnabled === null;
  const shouldShowLogin = authRequired && !authenticated;
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
            {shouldShowLogin ? (
              <>
                <Route path="*" element={<LoginPage />} />
              </>
            ) : (
              <>
                <Route path="/" element={<RootRoute />} />
                <Route path="/workspace" element={<WorkspacePage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </>
            )}
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
