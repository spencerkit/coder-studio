import { ShellEntry } from "../shells/shell-entry";
import { AppProviders } from "./providers";

export function RuntimeShell() {
  return (
    <AppProviders>
      <ShellEntry />
    </AppProviders>
  );
}
