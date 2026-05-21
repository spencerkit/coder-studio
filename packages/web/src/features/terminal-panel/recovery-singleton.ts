import type { RecoveryCoordinator } from "./recovery-coordinator";

let globalRecoveryCoordinator: RecoveryCoordinator | null = null;

export function setGlobalRecoveryCoordinator(coordinator: RecoveryCoordinator | null) {
  if (globalRecoveryCoordinator === coordinator) {
    return;
  }

  globalRecoveryCoordinator?.dispose();
  globalRecoveryCoordinator = coordinator;
}

export function getGlobalRecoveryCoordinator() {
  return globalRecoveryCoordinator;
}

export function resetGlobalRecoveryCoordinator() {
  setGlobalRecoveryCoordinator(null);
}
