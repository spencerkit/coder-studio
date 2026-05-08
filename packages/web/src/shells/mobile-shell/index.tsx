import { useAtomValue } from "jotai";
import { Route, Routes } from "react-router-dom";
import { authEnabledAtom } from "../../atoms/connection";
import { LoginPage } from "../../features/auth";
import { CommandPalette } from "../../features/command-palette";
import { NotFoundPage } from "../../features/not-found";
import { ToastContainer } from "../../features/notifications";
import { SettingsPage } from "../../features/settings";
import { WelcomePage } from "../../features/welcome";
import { WorkspaceMobileView } from "../../features/workspace/views/mobile/workspace-mobile-view";
import { BranchQuickPick } from "../../features/workspace/views/shared/branch-quick-pick";
import { WorkspaceRouteGate } from "../../features/workspace/views/shared/workspace-route-gate";
import { useBootstrap } from "../../hooks/use-bootstrap";
import { ConnectionStatusBanner } from "../shared/connection-status-banner";

export function MobileShell() {
  useBootstrap();
  const authEnabled = useAtomValue(authEnabledAtom);
  const authUnknown = authEnabled === null;

  return (
    <div className="app">
      <ConnectionStatusBanner />

      <main className="main-content">
        {authUnknown ? (
          <div className="app-loading-shell">
            <div className="app-loading-card">
              <div className="app-loading-kicker">CODER STUDIO</div>
              <h1 className="app-loading-title">正在连接工作区...</h1>
              <p className="app-loading-desc">
                正在同步认证与连接状态，随后会自动进入当前 workspace。
              </p>
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/workspace"
              element={
                <WorkspaceRouteGate>
                  <WorkspaceMobileView />
                </WorkspaceRouteGate>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>

      <CommandPalette />
      <BranchQuickPick />
      <ToastContainer />
    </div>
  );
}
