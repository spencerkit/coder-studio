export const TERMINAL_REPLAY_TIMEOUT_MS = 120_000;

export type RecoveryUiMode =
  | "silent"
  | "closed"
  | "checking"
  | "non_blocking_recovering"
  | "blocking_rebuild"
  | "error";

export interface RecoveryUiModeDetail {
  reason?: "too_old_no_snapshot" | "unknown_terminal";
}

export type TerminalReplayUiState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "closed" }
  | { kind: "unavailable" }
  | { kind: "truncated" }
  | { kind: "retryable_failure"; reason: "timeout" | "failed" }
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
