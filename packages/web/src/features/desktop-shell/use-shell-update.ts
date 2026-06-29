import { useEffect, useState } from "react";
import type { DesktopShellUpdateState } from "../../desktop-bridge";

export function useShellUpdate() {
  const api = window.coderStudioDesktop?.shellUpdate;
  const [state, setState] = useState<DesktopShellUpdateState | null>(null);

  useEffect(() => {
    if (!api) {
      setState(null);
      return;
    }

    void api.getState().then((next) => {
      setState(next);
    });

    return api.subscribe((next) => {
      setState(next);
    });
  }, [api]);

  return {
    available: Boolean(api),
    state,
    check: async () => {
      if (!api) {
        return null;
      }
      const next = await api.check();
      setState(next);
      return next;
    },
    install: async () => {
      if (!api) {
        return null;
      }
      const next = await api.install();
      setState(next);
      return next;
    },
    restartToApply: async () => {
      if (!api) {
        return;
      }
      await api.restartToApply();
    },
  };
}
