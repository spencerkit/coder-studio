/**
 * Notification formatting helpers
 *
 * Pure functions only — no React, no atoms. Easy to unit-test, and shared by
 * the notification engine + (eventually) any other "session summary" UI.
 */

/**
 * Human-readable display name for a provider id.
 * Falls back to title-casing the id if we don't have a hard-coded mapping.
 */
const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
};
export function formatProviderLabel(providerId: string): string {
  if (PROVIDER_LABELS[providerId]) return PROVIDER_LABELS[providerId]!;
  if (!providerId) return "Agent";
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

/**
 * Workspace name → use `name` if set, otherwise basename of `path`.
 * Returns empty string if neither is available, so callers can hide the field.
 */
export function formatWorkspaceLabel(
  workspace: { name?: string; path?: string } | null | undefined
): string {
  if (!workspace) return "";
  const name = workspace.name?.trim();
  if (name) return extractWorkspaceLeafName(name);
  const path = workspace.path?.trim();
  if (!path) return "";
  return extractWorkspaceLeafName(path);
}

function extractWorkspaceLeafName(value: string): string {
  // Strip trailing slashes, then take last segment.
  const cleaned = value.replace(/[/\\]+$/, "");
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || cleaned;
}

/**
 * Compact human-readable duration. Examples:
 *   400         -> "<1s"
 *   1500        -> "1s"
 *   59_000      -> "59s"
 *   65_000      -> "1m 5s"
 *   3_600_000   -> "1h 0m"
 *   3_905_000   -> "1h 5m"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1_000) return "<1s";
  const totalSeconds = Math.floor(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
