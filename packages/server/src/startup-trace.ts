const STARTUP_TRACE_ENABLED = process.env.CODER_STUDIO_STARTUP_TRACE === "1";
const STARTUP_TRACE_STARTED_AT = process.hrtime.bigint();
const seenLabels = new Set<string>();

function getElapsedMs(): number {
  return Number(process.hrtime.bigint() - STARTUP_TRACE_STARTED_AT) / 1_000_000;
}

export function getStartupTraceDurationMs(startedAt: bigint): number {
  return Math.round((Number(process.hrtime.bigint() - startedAt) / 1_000_000) * 10) / 10;
}

export function isStartupTraceEnabled(): boolean {
  return STARTUP_TRACE_ENABLED;
}

export function logStartupTrace(label: string, data: Record<string, unknown> = {}): void {
  if (!STARTUP_TRACE_ENABLED) {
    return;
  }

  const payload = {
    label,
    elapsedMs: Math.round(getElapsedMs() * 10) / 10,
    ...data,
  };
  console.log(`[startup-trace][server] ${JSON.stringify(payload)}`);
}

export function logStartupTraceOnce(label: string, data: Record<string, unknown> = {}): void {
  if (!STARTUP_TRACE_ENABLED || seenLabels.has(label)) {
    return;
  }

  seenLabels.add(label);
  logStartupTrace(label, data);
}
