import type { SessionState } from "@coder-studio/core";

import type { PtyDerivedState } from "./pty-state-detector.js";

export interface ShadowComparatorSnapshot {
  hookState: SessionState | null;
  ptyState: PtyDerivedState | null;
  lastDivergedAt: number | null;
}

export interface ShadowComparator {
  observeHookState(state: SessionState): void;
  observePtyState(state: PtyDerivedState): void;
  snapshot(): ShadowComparatorSnapshot;
}

function areStatesAligned(
  hookState: SessionState | null,
  ptyState: PtyDerivedState | null
): boolean {
  if (!hookState || !ptyState) {
    return true;
  }

  return (
    (hookState === "running" && ptyState === "running") ||
    (hookState === "idle" && ptyState === "idle")
  );
}

export function createShadowComparator(
  log: (info: Record<string, unknown>) => void
): ShadowComparator {
  let hookState: SessionState | null = null;
  let ptyState: PtyDerivedState | null = null;
  let lastDivergedAt: number | null = null;

  const compare = () => {
    if (areStatesAligned(hookState, ptyState)) {
      return;
    }

    lastDivergedAt = Date.now();
    log({
      metric: "session.state.shadow.diverge",
      hookState,
      ptyState,
      at: lastDivergedAt,
    });
  };

  return {
    observeHookState(state) {
      hookState = state;
      compare();
    },
    observePtyState(state) {
      ptyState = state;
      compare();
    },
    snapshot() {
      return {
        hookState,
        ptyState,
        lastDivergedAt,
      };
    },
  };
}
