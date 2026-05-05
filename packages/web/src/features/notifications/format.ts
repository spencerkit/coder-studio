/**
 * Notification formatting helpers
 *
 * Pure functions only — no React, no atoms. Easy to unit-test, and shared by
 * the notification engine + (eventually) any other "session summary" UI.
 */

const ESC = 0x1b;
const BEL = 0x07;

function isRemovableControl(code: number): boolean {
  return (
    (code >= 0x00 && code <= 0x08) ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0d && code <= 0x1f) ||
    code === 0x7f
  );
}

function findCsiEnd(text: string, start: number): number | null {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index + 1;
    }
  }
  return null;
}

function findOscEnd(text: string, start: number): number | null {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === BEL) {
      return index + 1;
    }
    if (code === ESC) {
      if (index + 1 >= text.length) {
        return null;
      }
      if (text.charAt(index + 1) === "\\") {
        return index + 2;
      }
    }
  }
  return null;
}

function findStEnd(text: string, start: number): number | null {
  for (let index = start + 2; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === ESC) {
      if (index + 1 >= text.length) {
        return null;
      }
      if (text.charAt(index + 1) === "\\") {
        return index + 2;
      }
    }
  }
  return null;
}

export interface StripAnsiChunkResult {
  cleaned: string;
  carry: string;
}

/**
 * Incrementally strip ANSI/control sequences from a terminal text stream.
 *
 * `carry` stores any incomplete escape sequence from the previous chunk so
 * callers can safely sanitize websocket/PTTY frames without leaking split
 * ANSI fragments into user-visible text.
 */
export function stripAnsiChunk(input: string, carry = ""): StripAnsiChunkResult {
  if (!input && !carry) {
    return { cleaned: "", carry: "" };
  }

  const text = carry + input;
  let cleaned = "";

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code === ESC) {
      if (index + 1 >= text.length) {
        return { cleaned, carry: text.slice(index) };
      }

      const next = text.charAt(index + 1);
      let end: number | null = null;

      if (next === "[") {
        end = findCsiEnd(text, index);
      } else if (next === "]") {
        end = findOscEnd(text, index);
      } else if (next === "P" || next === "X" || next === "^" || next === "_") {
        end = findStEnd(text, index);
      } else if (next === "O" || next === "N") {
        end = index + 3 <= text.length ? index + 3 : null;
      } else {
        const nextCode = text.charCodeAt(index + 1);
        if ((nextCode >= 0x40 && nextCode <= 0x5f) || (nextCode >= 0x60 && nextCode <= 0x7e)) {
          end = index + 2;
        }
      }

      if (end === null) {
        return { cleaned, carry: text.slice(index) };
      }

      index = end - 1;
      continue;
    }

    if (isRemovableControl(code)) {
      continue;
    }

    cleaned += text.charAt(index);
  }

  return { cleaned, carry: "" };
}

/**
 * Strip ANSI escape sequences and most other control bytes from PTY output
 * so the result is something we can safely show in a notification.
 *
 * Covers:
 *   - CSI / OSC / SS2 / SS3 / SOS / PM / APC / DCS sequences
 *   - ESC [@\] etc. single-character introducers
 *   - Bell, backspace, vertical tab, form feed, carriage return (kept newlines)
 *   - DEL (0x7f)
 *
 * We deliberately KEEP `\n` and `\t` so paragraph structure / indentation
 * survive enough to read.
 */
export function stripAnsi(input: string): string {
  return stripAnsiChunk(input).cleaned;
}

/**
 * Sanitize text that should render on a single metadata/title line.
 * Drops ANSI/control bytes, collapses whitespace, trims the result.
 */
export function sanitizeInlineText(input: string): string {
  return stripAnsi(input).replace(/\s+/g, " ").trim();
}

/**
 * Reduce arbitrary multi-line agent output to a single-line summary suitable
 * for a 1–2 line toast / browser notification.
 *
 * Strategy: take the LAST non-empty line (that's where Claude/Codex put their
 * final answer or status), collapse internal whitespace, hard-cap length.
 */
export function summarizeOutput(rawCleanedText: string, maxChars = 140): string {
  if (!rawCleanedText) return "";
  const lines = rawCleanedText
    .split("\n")
    .map((l) => l.trim())
    // Drop empty lines and lines that look like prompt characters only
    .filter((l) => l.length > 0 && !/^[>$%#❯➜•]+$/.test(l));
  if (lines.length === 0) return "";
  const last = lines[lines.length - 1]!.replace(/\s+/g, " ");
  if (last.length <= maxChars) return last;
  return `${last.slice(0, maxChars - 1).trimEnd()}…`;
}

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
  if (name) return name;
  const path = workspace.path?.trim();
  if (!path) return "";
  // Strip trailing slashes, then take last segment.
  const cleaned = path.replace(/[/\\]+$/, "");
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
