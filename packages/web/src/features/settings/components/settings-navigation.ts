export interface ResolveSettingsExitTargetOptions {
  historyIndex?: number | null;
  historyLength: number;
  hasActiveWorkspace: boolean;
}

interface HistoryLike {
  state: unknown;
  length: number;
}

export function resolveSettingsExitTarget({
  historyIndex,
  historyLength,
  hasActiveWorkspace,
}: ResolveSettingsExitTargetOptions): 'history' | '/workspace' | '/' {
  const canUseHistory =
    typeof historyIndex === 'number' ? historyIndex > 0 : historyLength > 1;

  if (canUseHistory) {
    return 'history';
  }

  return hasActiveWorkspace ? '/workspace' : '/';
}

export function resolveSettingsExitTargetFromHistory(
  options: {
    history: HistoryLike;
    hasActiveWorkspace: boolean;
  }
): 'history' | '/workspace' | '/' {
  const { history, hasActiveWorkspace } = options;
  const historyState = history.state as { idx?: number } | null;

  return resolveSettingsExitTarget({
    historyIndex: historyState?.idx ?? null,
    historyLength: history.length,
    hasActiveWorkspace,
  });
}

export function resolveSettingsExitTargetFromBrowserHistory(
  hasActiveWorkspace: boolean
): 'history' | '/workspace' | '/' {
  return resolveSettingsExitTargetFromHistory({
    history: typeof window !== 'undefined' ? window.history : { state: null, length: 1 },
    hasActiveWorkspace,
  });
}
