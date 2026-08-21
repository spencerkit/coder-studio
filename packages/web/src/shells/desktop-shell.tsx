/**
 * Desktop Shell
 *
 * The original AppShell extracted out of app.tsx (zero behavior change).
 * Mobile shell is a sibling under shells/mobile-shell/.
 */

import { useAtomValue } from "jotai";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { authEnabledAtom } from "../atoms";
import { EmptyState } from "../components/ui";
import { LoginPage } from "../features/auth";
import { SessionGatePage } from "../features/auth/session-gate";
import { NotFoundPage } from "../features/not-found";
import { ToastContainer } from "../features/notifications";
import { WelcomePage } from "../features/welcome";
import { WorkspaceLoadingState } from "../features/workspace/views/shared/workspace-loading-state";
import { WorkspaceRouteGate } from "../features/workspace/views/shared/workspace-route-gate";
import { useBootstrap } from "../hooks/use-bootstrap";
import { useTranslation } from "../lib/i18n";
import { logStartupTraceOnce } from "../startup-trace";
import { ConnectionStatusBanner } from "./shared/connection-status-banner";
import { ShellDeferredFallback } from "./shared/shell-deferred-fallback";

const DeferredCommandPalette = lazy(async () => {
  const module = await import("../features/command-palette");
  return { default: module.CommandPalette };
});

const DeferredDiagnosticsPage = lazy(async () => {
  const module = await import("../features/diagnostics");
  return { default: module.DiagnosticsPage };
});

const DeferredMonitoringPage = lazy(async () => {
  const module = await import("../features/monitoring");
  return { default: module.MonitoringPage };
});

const DeferredMoreFeaturesPage = lazy(async () => {
  const module = await import("../features/more");
  return { default: module.MoreFeaturesPage };
});

const DeferredQuickOpen = lazy(async () => {
  const module = await import("../features/quick-open");
  return { default: module.QuickOpen };
});

const DeferredWorkAnalyticsPage = lazy(async () => {
  const module = await import("../features/work-analysis");
  return { default: module.WorkAnalyticsPage };
});

const DeferredWorkspaceDesktopView = lazy(async () => {
  const module = await import("../features/workspace/views/desktop/workspace-desktop-view");
  return { default: module.WorkspaceDesktopView };
});

const appLoadingEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-3)",
  alignItems: "stretch",
  justifyContent: "flex-start",
  textAlign: "left" as const,
};

function DeferredRoute({
  children,
  fallback = <ShellDeferredFallback />,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export function DesktopShell() {
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
  useEffect(() => {
    if (!authUnknown || shouldBypassAuthLoading) {
      return;
    }

    logStartupTraceOnce("shell:loading_visible", {
      path: location.pathname,
      shell: "desktop",
    });
  }, [authUnknown, location.pathname, shouldBypassAuthLoading]);

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
            <Route
              path="/diagnostics"
              element={
                <DeferredRoute>
                  <DeferredDiagnosticsPage />
                </DeferredRoute>
              }
            />
            <Route
              path="/analytics"
              element={
                <DeferredRoute>
                  <DeferredWorkAnalyticsPage />
                </DeferredRoute>
              }
            />
            <Route
              path="/monitoring"
              element={
                <DeferredRoute>
                  <DeferredMonitoringPage />
                </DeferredRoute>
              }
            />
            <Route
              path="/more/*"
              element={
                <DeferredRoute>
                  <DeferredMoreFeaturesPage />
                </DeferredRoute>
              }
            />
            <Route
              path="/workspace"
              element={
                <WorkspaceRouteGate>
                  <DeferredRoute fallback={<WorkspaceLoadingState />}>
                    <DeferredWorkspaceDesktopView />
                  </DeferredRoute>
                </WorkspaceRouteGate>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        )}
      </main>

      <Suspense fallback={null}>
        <DeferredQuickOpen />
        <DeferredCommandPalette />
      </Suspense>
      <ToastContainer />
    </div>
  );
}
