function isRestartTraceEnabled(): boolean {
  return process.env.CODER_STUDIO_RESTART_TRACE === "1";
}

export function debugRestartTrace(event: string, details: Record<string, unknown>): void {
  if (!isRestartTraceEnabled()) {
    return;
  }

  console.debug(`[restart-trace] ${event}`, details);
}

export function warnRestartTrace(event: string, details: Record<string, unknown>): void {
  if (!isRestartTraceEnabled()) {
    return;
  }

  console.warn(`[restart-trace] ${event}`, details);
}
