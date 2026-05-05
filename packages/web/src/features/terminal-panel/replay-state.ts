export const TERMINAL_REPLAY_TIMEOUT_MS = 120_000;

export type TerminalReplayUiState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "degraded"; reason: "timeout" | "failed" | "truncated" | "closed" };

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
