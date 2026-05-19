import type { DiagnosticsContext, DiagnosticsRequest } from "@coder-studio/core";

export type DiagnosticsLaunchMode = "assign" | "replace";

export interface DiagnosticsRouteIntent extends DiagnosticsRequest {
  paneId?: string;
  launchMode?: DiagnosticsLaunchMode;
}

const VALID_CONTEXTS = new Set<DiagnosticsContext>([
  "workspace_open",
  "session_start",
  "mobile_continue",
  "manual_check",
]);

export function buildDiagnosticsPath(intent: DiagnosticsRouteIntent): string {
  const params = new URLSearchParams();
  params.set("context", intent.context);

  if (intent.workspaceId) {
    params.set("workspaceId", intent.workspaceId);
  }

  if (intent.workspacePath) {
    params.set("workspacePath", intent.workspacePath);
  }

  if (intent.providerId) {
    params.set("providerId", intent.providerId);
  }

  if (intent.paneId) {
    params.set("paneId", intent.paneId);
  }

  if (intent.launchMode) {
    params.set("launchMode", intent.launchMode);
  }

  const query = params.toString();
  return query.length > 0 ? `/diagnostics?${query}` : "/diagnostics";
}

export function parseDiagnosticsSearch(search: string): DiagnosticsRouteIntent {
  const params = new URLSearchParams(search);
  const contextParam = params.get("context");
  const context = VALID_CONTEXTS.has(contextParam as DiagnosticsContext)
    ? (contextParam as DiagnosticsContext)
    : "manual_check";
  const launchMode = params.get("launchMode");

  return {
    context,
    workspaceId: params.get("workspaceId") ?? undefined,
    workspacePath: params.get("workspacePath") ?? undefined,
    providerId: params.get("providerId") ?? undefined,
    paneId: params.get("paneId") ?? undefined,
    launchMode: launchMode === "assign" || launchMode === "replace" ? launchMode : undefined,
  };
}

export function pushDiagnosticsPath(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
