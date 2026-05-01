export interface ResolveSettingsExitTargetOptions {
  historyIndex?: number | null;
  historyLength: number;
  hasActiveWorkspace: boolean;
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
