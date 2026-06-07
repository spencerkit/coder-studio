import type { IdleHeuristics } from "@coder-studio/core";

/**
 * Debounce-only idle detection for CLIs whose prompt format is not yet modeled.
 * After the last PTY output, wait {@link debounceIdleHeuristics.idleDebounceMs}
 * with no further output before declaring the session idle.
 */
export const debounceIdleHeuristics: IdleHeuristics = {
  idlePromptPatterns: [],
  idleDebounceMs: 4000,
};
