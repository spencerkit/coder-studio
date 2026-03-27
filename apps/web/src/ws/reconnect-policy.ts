export const WS_RECONNECT_BASE_DELAY_MS = 800;
export const WS_RECONNECT_MAX_DELAY_MS = 10_000;

export const getReconnectDelayMs = (attempt: number) => {
  const normalizedAttempt = Number.isFinite(attempt) && attempt > 0
    ? Math.floor(attempt)
    : 0;
  return Math.min(
    WS_RECONNECT_BASE_DELAY_MS * (2 ** normalizedAttempt),
    WS_RECONNECT_MAX_DELAY_MS,
  );
};
