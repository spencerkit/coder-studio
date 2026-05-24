/**
 * Desktop Shell
 *
 * The original AppShell extracted out of app.tsx (zero behavior change).
 * Mobile shell is a sibling under shells/mobile-shell/.
 */

import { useAtomValue } from "jotai";
import { Route, Routes, useLocation } from "react-router-dom";
import { authEnabledAtom } from "../atoms";
import { EmptyState } from "../components/ui";
import { LoginPage } from "../features/auth";
import { SessionGatePage } from "../features/auth/session-gate";
import { CommandPalette } from "../features/command-palette";
import { DiagnosticsPage } from "../features/diagnostics";
import { MonitoringPage } from "../features/monitoring";
import { NotFoundPage } from "../features/not-found";
import { ToastContainer } from "../features/notifications";
import { QuickOpen } from "../features/quick-open";
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
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authUnknown = authEnabled === null;
  const shouldBypassAuthLoading =
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/diagnostics") ||
    location.pathname.startsWith("/monitoring") ||
    location.pathname === "/session-gate";

  return (
    <div className="app">
      <ConnectionStatusBanner />

      <main className="main-content">
        {authUnknown && !shouldBypassAuthLoading ? (
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
            <Route path="/session-gate" element={<SessionGatePage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
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

      <QuickOpen />
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
