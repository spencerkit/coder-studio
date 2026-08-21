import { lazy, Suspense } from "react";
import { useViewport } from "../hooks/use-viewport";
import { ShellDeferredFallback } from "./shared/shell-deferred-fallback";

const DeferredDesktopShell = lazy(async () => {
  const module = await import("./desktop-shell");
  return { default: module.DesktopShell };
});

const DeferredMobileShell = lazy(async () => {
  const module = await import("./mobile-shell");
  return { default: module.MobileShell };
});

export function ShellEntry() {
  const viewport = useViewport();
  const ActiveShell = viewport === "mobile" ? DeferredMobileShell : DeferredDesktopShell;

  return (
    <Suspense fallback={<ShellDeferredFallback />}>
      <ActiveShell />
    </Suspense>
  );
}
