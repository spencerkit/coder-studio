/**
 * Application root.
 *
 * Provides BrowserRouter and picks a shell based on viewport:
 * - mobile (< 900px) -> MobileShell
 * - desktop -> DesktopShell
 */

import { BrowserRouter, Route, Routes } from "react-router-dom";
import { EmbeddedCanvasRoute } from "./features/canvas/routes/embedded-canvas-route";
import { EmbeddedCanvasSnapshotRoute } from "./features/canvas/routes/embedded-canvas-snapshot-route";
import { useViewport } from "./hooks/use-viewport";
import { DesktopShell } from "./shells/desktop-shell";
import { MobileShell } from "./shells/mobile-shell";

function ShellSwitch() {
  const viewport = useViewport();

  return viewport === "mobile" ? <MobileShell /> : <DesktopShell />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        <Route
          path="/embedded/canvas-snapshot/:snapshotId"
          element={<EmbeddedCanvasSnapshotRoute />}
        />
        <Route path="*" element={<ShellSwitch />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
