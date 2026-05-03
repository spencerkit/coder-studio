export interface IdleHeuristics {
  /** Regex patterns indicating the CLI is idle at a prompt. */
  idlePromptPatterns: RegExp[]
  /** Wait this many ms after the last output before declaring idle. */
  idleDebounceMs: number
  /** Optional regexes that can extract a session identifier from stdout. */
  sessionIdPatterns?: RegExp[]
}
