/**
 * Application root.
 *
 * Provides BrowserRouter and picks a shell based on viewport:
 * - mobile (< 900px) -> MobileShell
 * - desktop -> DesktopShell
 */

import { BrowserRouter } from 'react-router-dom';
import { DesktopShell } from './shells/desktop-shell';
import { MobileShell } from './shells/mobile-shell';
import { useViewport } from './hooks/use-viewport';

function ShellSwitch() {
  const viewport = useViewport();

  return viewport === 'mobile' ? <MobileShell /> : <DesktopShell />;
}

function App() {
  return (
    <BrowserRouter>
      <ShellSwitch />
    </BrowserRouter>
  );
}

export default App;
