/**
 * Notification formatting helpers
 *
 * Pure functions only — no React, no atoms. Easy to unit-test, and shared by
 * the notification engine + (eventually) any other "session summary" UI.
 */

/**
 * Strip ANSI escape sequences and most other control bytes from PTY output
 * so the result is something we can safely show in a notification.
 *
 * Covers:
 *   - CSI / OSC / SS3 / SOS / PM / APC / DCS sequences (ESC [ … final byte etc.)
 *   - ESC [@\] etc. introducers
 *   - Bell, backspace, vertical tab, form feed, carriage return (kept newlines)
 *   - DEL (0x7f)
 *
 * We deliberately KEEP `\n` and `\t` so paragraph structure / indentation
 * survive enough to read.
 */
export function stripAnsi(input: string): string {
  if (!input) return '';
  // ESC sequences. The outer alternation handles all the SGR-style
  // CSI/OSC/etc. Sequences may end with various final bytes.
  // eslint-disable-next-line no-control-regex
  const ansiPattern = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-_])/g;
  // Other C0 controls except \t (0x09) and \n (0x0a). 0x0d (\r) is dropped
  // because PTY uses CRLF and we don't want stray carriage returns.
  // eslint-disable-next-line no-control-regex
  const controlPattern = /[\x00-\x08\x0B-\x1F\x7F]/g;
  return input
    .replace(ansiPattern, '')
    .replace(controlPattern, '');
}

/**
 * Reduce arbitrary multi-line agent output to a single-line summary suitable
 * for a 1–2 line toast / browser notification.
 *
 * Strategy: take the LAST non-empty line (that's where Claude/Codex put their
 * final answer or status), collapse internal whitespace, hard-cap length.
 */
export function summarizeOutput(rawCleanedText: string, maxChars = 140): string {
  if (!rawCleanedText) return '';
  const lines = rawCleanedText
    .split('\n')
    .map((l) => l.trim())
    // Drop empty lines and lines that look like prompt characters only
    .filter((l) => l.length > 0 && !/^[>$%#❯➜•]+$/.test(l));
  if (lines.length === 0) return '';
  const last = lines[lines.length - 1]!.replace(/\s+/g, ' ');
  if (last.length <= maxChars) return last;
  return `${last.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * Human-readable display name for a provider id.
 * Falls back to title-casing the id if we don't have a hard-coded mapping.
 */
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
};
export function formatProviderLabel(providerId: string): string {
  if (PROVIDER_LABELS[providerId]) return PROVIDER_LABELS[providerId]!;
  if (!providerId) return 'Agent';
  return providerId.charAt(0).toUpperCase() + providerId.slice(1);
}

/**
 * Workspace name → use `name` if set, otherwise basename of `path`.
 * Returns empty string if neither is available, so callers can hide the field.
 */
export function formatWorkspaceLabel(workspace: { name?: string; path?: string } | null | undefined): string {
  if (!workspace) return '';
  const name = workspace.name?.trim();
  if (name) return name;
  const path = workspace.path?.trim();
  if (!path) return '';
  // Strip trailing slashes, then take last segment.
  const cleaned = path.replace(/[/\\]+$/, '');
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
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1_000) return '<1s';
  const totalSeconds = Math.floor(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
