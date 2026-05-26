export const TERMINAL_REPLAY_TIMEOUT_MS = 120_000;

export type RecoveryOperation =
  | "connection.probe"
  | "recovery.reconcile"
  | "terminal.replay"
  | "terminal.snapshot";

export type RecoveryUiMode =
  | "silent"
  | "closed"
  | "checking"
  | "non_blocking_recovering"
  | "blocking_rebuild"
  | "error";

export interface RecoveryUiModeDetail {
  reason?: "too_old_no_snapshot" | "unknown_terminal" | "reconcile_failed";
  operation?: RecoveryOperation;
  errorCode?: string;
}

export type TerminalReplayUiState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "closed" }
  | { kind: "unavailable" }
  | { kind: "recovery_check_failed" }
  | { kind: "retryable_failure"; reason: "timeout" | "failed" }
  | { kind: "failed"; reason: "timeout" | "failed" }
  | { kind: "unrecoverable_history"; reason: "too_old_no_snapshot" };

export function classifyReplayFailure(error: unknown): "timeout" | "failed" {
  if (error instanceof Error && error.message.includes("Command timeout: terminal.replay")) {
    return "timeout";
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string" &&
    String((error as { message: string }).message).includes("Command timeout: terminal.replay")
  ) {
    return "timeout";
  }

  return "failed";
}

function getErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return String((error as { code: string }).code);
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return String((error as { message: string }).message);
  }

  return "";
}

export function isRecoveryControlPlaneError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (
    code === "no_client" ||
    code === "unknown_op" ||
    code === "activation_required" ||
    code === "validation_error" ||
    code === "internal_error"
  ) {
    return true;
  }

  const message = getErrorMessage(error);
  return (
    message.startsWith("Unknown operation:") ||
    message.includes("active session") ||
    message.includes("WebSocket client not initialized")
  );
}
