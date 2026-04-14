/**
 * Reconnection Utilities
 *
 * Exponential backoff and reconnect state management.
 */

export interface ReconnectState {
  attempts: number;
  lastAttemptAt: number | null;
  nextDelayMs: number;
  maxAttemptsReached: boolean;
}

export interface ReconnectConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

const DEFAULT_CONFIG: ReconnectConfig = {
  maxAttempts: 30,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 100,
};

/**
 * Calculate next reconnect delay using exponential backoff with jitter
 */
export function calculateReconnectDelay(
  attempts: number,
  config: Partial<ReconnectConfig> = {}
): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Exponential backoff: base * 2^attempts
  const exponentialDelay = cfg.baseDelayMs * Math.pow(2, attempts);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, cfg.maxDelayMs);

  // Add jitter to prevent thundering herd
  const jitter = Math.random() * cfg.jitterMs;

  return cappedDelay + jitter;
}

/**
 * Create reconnect state tracker
 */
export function createReconnectTracker(config: Partial<ReconnectConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let attempts = 0;
  let lastAttemptAt: number | null = null;

  return {
    recordAttempt(): ReconnectState {
      attempts++;
      lastAttemptAt = Date.now();

      return {
        attempts,
        lastAttemptAt,
        nextDelayMs: calculateReconnectDelay(attempts, cfg),
        maxAttemptsReached: attempts >= cfg.maxAttempts,
      };
    },

    reset(): void {
      attempts = 0;
      lastAttemptAt = null;
    },

    getState(): ReconnectState {
      return {
        attempts,
        lastAttemptAt,
        nextDelayMs: calculateReconnectDelay(attempts, cfg),
        maxAttemptsReached: attempts >= cfg.maxAttempts,
      };
    },
  };
}