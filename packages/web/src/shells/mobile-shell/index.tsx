import { useAtomValue } from "jotai";
import { Route, Routes, useLocation } from "react-router-dom";
import { authEnabledAtom } from "../../atoms/connection";
import { EmptyState } from "../../components/ui";
import { LoginPage } from "../../features/auth";
import { SessionGatePage } from "../../features/auth/session-gate";
import { CommandPalette } from "../../features/command-palette";
import { DiagnosticsPage } from "../../features/diagnostics";
import { MonitoringPage } from "../../features/monitoring";
import { MoreFeaturesPage } from "../../features/more";
import { NotFoundPage } from "../../features/not-found";
import { ToastContainer } from "../../features/notifications";
import { WelcomePage } from "../../features/welcome";
import { WorkAnalyticsPage } from "../../features/work-analysis";
import { WorkspaceMobileView } from "../../features/workspace/views/mobile/workspace-mobile-view";
import { BranchQuickPick } from "../../features/workspace/views/shared/branch-quick-pick";
import { WorkspaceRouteGate } from "../../features/workspace/views/shared/workspace-route-gate";
import { useBootstrap } from "../../hooks/use-bootstrap";
import { useTranslation } from "../../lib/i18n";
import { ConnectionStatusBanner } from "../shared/connection-status-banner";

const appLoadingEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-3)",
  alignItems: "stretch",
  justifyContent: "flex-start",
  textAlign: "left" as const,
};

export function MobileShell() {
  useBootstrap();
  const t = useTranslation();
  const authEnabled = useAtomValue(authEnabledAtom);
  const location = useLocation();
  const authUnknown = authEnabled === null;
  const shouldBypassAuthLoading =
    location.pathname.startsWith("/analytics") ||
    location.pathname.startsWith("/monitoring") ||
    location.pathname.startsWith("/diagnostics") ||
    location.pathname.startsWith("/more") ||
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
                    <h1 className="app-loading-title">{t("shell.loading_title")}</h1>
                  </div>
                }
                description={<p className="app-loading-desc">{t("shell.loading_description")}</p>}
              />
            </div>
          </div>
        ) : (
          <Routes>
            <Route path="/" element={<WelcomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/session-gate" element={<SessionGatePage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
            <Route path="/analytics" element={<WorkAnalyticsPage />} />
            <Route path="/monitoring" element={<MonitoringPage />} />
            <Route path="/more/*" element={<MoreFeaturesPage />} />
            <Route
              path="/workspace"
              element={
                <WorkspaceRouteGate>
                  <WorkspaceMobileView />
                </WorkspaceRouteGate>
              }
            />
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
