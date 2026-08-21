const TRACE_QUERY_PARAM = "startupTrace";
const TRACE_ELEMENT_ID = "coder-studio-startup-trace";
const TRACE_ENABLED =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get(TRACE_QUERY_PARAM) === "1";
const TRACE_STARTED_AT = typeof performance !== "undefined" ? performance.now() : 0;
const seenLabels = new Set<string>();
const entries: Array<Record<string, unknown>> = [];

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function getTraceMountTarget(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.body ?? document.head ?? document.documentElement;
}

function updateTraceDom(): void {
  if (!TRACE_ENABLED || typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  let element = document.getElementById(TRACE_ELEMENT_ID) as HTMLDivElement | null;
  if (!element) {
    element = document.createElement("div");
    element.id = TRACE_ELEMENT_ID;
    element.hidden = true;
    element.setAttribute("data-startup-trace", "1");
    getTraceMountTarget()?.appendChild(element);
  }

  element.textContent = JSON.stringify({
    href: window.location.href,
    entries,
  });
}

export function isStartupTraceEnabled(): boolean {
  return TRACE_ENABLED;
}

export function logStartupTrace(label: string, data: Record<string, unknown> = {}): void {
  if (!TRACE_ENABLED || typeof performance === "undefined") {
    return;
  }

  const entry = {
    label,
    elapsedMs: roundMs(performance.now() - TRACE_STARTED_AT),
    ...data,
  };
  entries.push(entry);
  updateTraceDom();
  console.log(`[startup-trace][web] ${JSON.stringify(entry)}`);
}

export function logStartupTraceOnce(label: string, data: Record<string, unknown> = {}): void {
  if (!TRACE_ENABLED || seenLabels.has(label)) {
    return;
  }

  seenLabels.add(label);
  logStartupTrace(label, data);
}
