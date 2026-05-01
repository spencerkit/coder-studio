/**
 * Desktop Shell
 *
 * The original AppShell extracted out of app.tsx (zero behavior change).
 * Mobile shell is a sibling under shells/mobile-shell/.
 */

import { useAtomValue } from 'jotai';
import { Route, Routes, useLocation } from 'react-router-dom';
import { authEnabledAtom, connectionStatusAtom } from '../atoms';
import { authenticatedAtom } from '../atoms/ui';
import { LoginPage } from '../features/auth';
import { CommandPalette } from '../features/command-palette';
import { ConfigDriftBanner } from '../features/config-drift-banner';
import { ToastContainer } from '../features/notifications';
import { SettingsPage } from '../features/settings';
import { WelcomePage } from '../features/welcome';
import { WorkspacePage } from '../features/workspace';
import { BranchQuickPick } from '../features/workspace/components/branch-quick-pick';
import { useWorkspaceBootstrap } from './shared/use-workspace-bootstrap';

export function DesktopShell() {
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

      {shouldShowGlobalConfigDriftBanner && <ConfigDriftBanner />}

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

      <CommandPalette />
      <BranchQuickPick />
      <ToastContainer />
    </div>
  );
}
