import type { RecoveryCoordinator } from "./recovery-coordinator";

let globalRecoveryCoordinator: RecoveryCoordinator | null = null;

export function setGlobalRecoveryCoordinator(coordinator: RecoveryCoordinator | null): void {
  if (globalRecoveryCoordinator === coordinator) {
    return;
  }

  globalRecoveryCoordinator?.dispose();
  globalRecoveryCoordinator = coordinator;
}

export function getGlobalRecoveryCoordinator(): RecoveryCoordinator | null {
  return globalRecoveryCoordinator;
}

export function resetGlobalRecoveryCoordinator(): void {
  setGlobalRecoveryCoordinator(null);
}
