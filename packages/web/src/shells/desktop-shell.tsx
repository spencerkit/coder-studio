/**
 * Desktop Shell
 *
 * The original AppShell extracted out of app.tsx (zero behavior change).
 * Mobile shell is a sibling under shells/mobile-shell/.
 */

import { useAtomValue } from "jotai";
import { Route, Routes, useLocation } from "react-router-dom";
import { authEnabledAtom, connectionStatusAtom } from "../atoms";
import { authenticatedAtom } from "../atoms/app-ui";
import { EmptyState } from "../components/ui";
import { LoginPage } from "../features/auth";
import { CommandPalette } from "../features/command-palette";
import { NotFoundPage } from "../features/not-found";
import { ToastContainer } from "../features/notifications";
import { SettingsPage } from "../features/settings";
import { WelcomePage } from "../features/welcome";
import { WorkspaceDesktopView } from "../features/workspace/views/desktop/workspace-desktop-view";
import { WorkspaceRouteGate } from "../features/workspace/views/shared/workspace-route-gate";
import { useBootstrap } from "../hooks/use-bootstrap";
import { ConnectionStatusBanner } from "./shared/connection-status-banner";

const appLoadingEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-3)",
  alignItems: "stretch",
  justifyContent: "flex-start",
  textAlign: "left" as const,
};

export function DesktopShell() {
  useBootstrap();
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authRequired = authEnabled === true;
  const authUnknown = authEnabled === null;
  const shouldShowLogin = authRequired && !authenticated && location.pathname === "/login";
  !shouldShowLogin && !authUnknown && !location.pathname.startsWith("/settings");

  return (
    <div className="app">
      <ConnectionStatusBanner />

      <main className="main-content">
        {authUnknown ? (
          <div className="app-loading-shell">
            <div className="app-loading-card">
              <EmptyState
                style={appLoadingEmptyStateStyle}
                title={
                  <div>
                    <div className="app-loading-kicker">CODER STUDIO</div>
                    <h1 className="app-loading-title">正在连接工作区...</h1>
                  </div>
                }
                description={
                  <p className="app-loading-desc">
                    正在同步认证与连接状态，随后会自动进入当前 workspace。
                  </p>
                }
              />
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
                  <WorkspaceDesktopView />
                </WorkspaceRouteGate>
              }
            />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>

      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
