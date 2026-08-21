/**
 * Application router.
 *
 * Keeps the initial entry thin and defers heavyweight app/runtime routes.
 */

import { lazy, type ReactNode, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ShellDeferredFallback } from "./shells/shared/shell-deferred-fallback";

const DeferredRuntimeShell = lazy(async () => {
  const module = await import("./app/runtime-shell");
  return { default: module.RuntimeShell };
});

const DeferredEmbeddedCanvasRoute = lazy(async () => {
  const module = await import("./features/canvas/routes/embedded-canvas-route");
  return { default: module.EmbeddedCanvasRoute };
});

const DeferredEmbeddedCanvasSnapshotRoute = lazy(async () => {
  const module = await import("./features/canvas/routes/embedded-canvas-snapshot-route");
  return { default: module.EmbeddedCanvasSnapshotRoute };
});

function DeferredRoute({
  children,
  fallback = <ShellDeferredFallback />,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/embedded/canvas/:workspaceId"
          element={
            <DeferredRoute>
              <DeferredEmbeddedCanvasRoute />
            </DeferredRoute>
          }
        />
        <Route
          path="/embedded/canvas-snapshot/:snapshotId"
          element={
            <DeferredRoute>
              <DeferredEmbeddedCanvasSnapshotRoute />
            </DeferredRoute>
          }
        />
        <Route
          path="*"
          element={
            <DeferredRoute>
              <DeferredRuntimeShell />
            </DeferredRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
