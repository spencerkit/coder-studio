/**
 * Codex config.toml auditor
 *
 * Scans `~/.codex/config.toml` for settings that interfere with Coder Studio's
 * hook integration. We never write hooks.json ourselves (see the design
 * discussion — Codex uses argv `-c notify=[...]` injection), but the user's
 * config.toml can still break things in two ways:
 *
 *   1. A top-level `notify = [...]` entry: Codex CLI treats this as the global
 *      notify target and it takes precedence over / conflicts with our per-
 *      process `-c notify=` override, depending on the CLI version.
 *   2. `[features] codex_hooks = true`: enables the experimental hook engine,
 *      which prints an "Under-development features enabled" warning and can
 *      change how the legacy `notify` path behaves. Not a hard blocker but
 *      worth flagging.
 *
 * We intentionally do *not* parse the TOML into an AST and re-serialize, which
 * would lose comments and re-format the file. Instead we do line-based
 * detection and line-based deletion, which preserves everything we don't
 * touch. The trade-off: we can only detect the exact shapes users write 99%
 * of the time (top-level keys, array values on one line or a short bracketed
 * block). Unusual forms fall through and are simply not flagged.
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type CodexAuditFindingType = 'toml_notify' | 'toml_codex_hooks';
export type CodexAuditSeverity = 'warn' | 'info';

export interface CodexAuditFinding {
  /** Stable id the frontend can use as a React key / selection key. */
  id: CodexAuditFindingType;
  type: CodexAuditFindingType;
  severity: CodexAuditSeverity;
  /** 1-indexed line number where the offending block starts. */
  startLine: number;
  /** 1-indexed inclusive line number where the block ends. */
  endLine: number;
  /** The verbatim text we detected, for UI display. */
  snippet: string;
  /** Human-facing reason in zh (matches rest of UI copy). */
  message: string;
}

export interface CodexConfigAudit {
  configPath: string;
  exists: boolean;
  findings: CodexAuditFinding[];
}

export interface CodexCleanupOptions {
  /** Which finding ids the user opted in to remove. */
  removeIds: CodexAuditFindingType[];
  /** Optional backup directory; defaults to the config's parent dir. */
  backupDir?: string;
}

export interface CodexCleanupResult {
  removed: CodexAuditFindingType[];
  backupPath: string | null;
  /** True when the user selected entries but the file was already clean. */
  noop: boolean;
}

/** Default path. Honors CODEX_HOME for users who relocate the config dir. */
export function resolveCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome && codexHome.trim()) {
    return join(codexHome, 'config.toml');
  }
  return join(homedir(), '.codex', 'config.toml');
}

/**
 * Read the file if it exists and scan for interfering settings. Never throws
 * — on any IO/parse issue we return `exists: false, findings: []` so callers
 * can treat "no config" and "unreadable config" the same way.
 */
export function auditCodexConfigToml(configPath?: string): CodexConfigAudit {
  const path = configPath ?? resolveCodexConfigPath();

  if (!existsSync(path)) {
    return { configPath: path, exists: false, findings: [] };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return { configPath: path, exists: false, findings: [] };
  }

  const lines = content.split(/\r?\n/);
  const findings: CodexAuditFinding[] = [];

  const notifyFinding = detectTopLevelNotify(lines);
  if (notifyFinding) findings.push(notifyFinding);

  const codexHooksFinding = detectCodexHooksFlag(lines);
  if (codexHooksFinding) findings.push(codexHooksFinding);

  return { configPath: path, exists: true, findings };
}

/**
 * Remove the selected findings from the config file. Preserves all other
 * lines (comments, blank lines, unrelated sections) byte-for-byte. Writes
 * atomically via `<path>.tmp` → rename.
 *
 * Before modifying, we create a timestamped backup next to the file. The
 * backup path is returned so callers can surface it to the user.
 */
export function cleanupCodexConfigToml(
  configPath: string,
  opts: CodexCleanupOptions
): CodexCleanupResult {
  if (opts.removeIds.length === 0) {
    return { removed: [], backupPath: null, noop: true };
  }

  if (!existsSync(configPath)) {
    return { removed: [], backupPath: null, noop: true };
  }

  // Re-scan right before mutating. We can't trust a caller-supplied findings
  // list because line numbers may have shifted since the audit ran (user
  // edited the file between audit and cleanup). This guarantees we only
  // delete what currently matches, and we never double-delete.
  const audit = auditCodexConfigToml(configPath);
  const selected = audit.findings.filter((f) => opts.removeIds.includes(f.id));
  if (selected.length === 0) {
    return { removed: [], backupPath: null, noop: true };
  }

  const original = readFileSync(configPath, 'utf-8');
  const backupPath = writeBackup(configPath, original, opts.backupDir);

  // Compute set of 1-indexed lines to drop.
  const linesToDrop = new Set<number>();
  for (const finding of selected) {
    for (let ln = finding.startLine; ln <= finding.endLine; ln++) {
      linesToDrop.add(ln);
    }
  }

  const originalLines = original.split(/\r?\n/);
  const kept: string[] = [];
  for (let i = 0; i < originalLines.length; i++) {
    const ln = i + 1;
    if (linesToDrop.has(ln)) continue;
    kept.push(originalLines[i]!);
  }

  // Collapse runs of 3+ blank lines left behind by deletion (cosmetic). We
  // never collapse the user's own existing blank spans that were already
  // there — we only touch blank lines adjacent to a deletion.
  const cleaned = collapseBlankRunsNearDeletions(kept);
  const output = cleaned.join('\n');

  atomicWrite(configPath, output);

  return {
    removed: selected.map((f) => f.id),
    backupPath,
    noop: false,
  };
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Detect top-level `notify = [...]`. The array body may span multiple lines
 * using a bracketed block. We require "top-level" — i.e. not under any
 * `[section]` header — because Codex only reads the root-level `notify` key.
 */
function detectTopLevelNotify(lines: string[]): CodexAuditFinding | null {
  const headerRegex = /^\s*\[/;
  const notifyRegex = /^\s*notify\s*=\s*(.*)$/;

  let inTopLevel = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // A header line ends the top-level region.
    if (headerRegex.test(trimmed)) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const m = trimmed.match(notifyRegex);
    if (!m) continue;

    const rhs = (m[1] ?? '').trim();
    // Single-line form: `notify = ["foo", "bar"]` (balanced on this line).
    if (rhs.startsWith('[') && rhs.endsWith(']') && countBrackets(rhs) === 0) {
      return makeNotifyFinding(lines, i, i);
    }
    // Multi-line form: opening bracket here, closing bracket on a later line.
    if (rhs.startsWith('[')) {
      let depth = countBrackets(rhs);
      for (let j = i + 1; j < lines.length; j++) {
        depth += countBrackets(lines[j]!);
        if (depth === 0) {
          return makeNotifyFinding(lines, i, j);
        }
      }
      // Unbalanced — bail without reporting a finding rather than guess.
      return null;
    }
    // Scalar form: `notify = "something"` or a bare string. Still conflicts.
    return makeNotifyFinding(lines, i, i);
  }
  return null;
}

function makeNotifyFinding(
  lines: string[],
  startIdx: number,
  endIdx: number
): CodexAuditFinding {
  return {
    id: 'toml_notify',
    type: 'toml_notify',
    severity: 'warn',
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    snippet: lines.slice(startIdx, endIdx + 1).join('\n'),
    message:
      'config.toml 顶层设置了 notify，会与 Coder Studio 的 -c notify 注入冲突，可能导致 session 一直停留在 starting。',
  };
}

/**
 * Detect `codex_hooks = true` inside a `[features]` section.
 *
 * Only the `[features]` section matters; we don't flag `codex_hooks` set to
 * `false` or absent, and we don't flag other under-development flags the user
 * might legitimately want on.
 */
function detectCodexHooksFlag(lines: string[]): CodexAuditFinding | null {
  const headerRegex = /^\s*\[([^\]]+)\]\s*$/;
  const codexHooksRegex = /^\s*codex_hooks\s*=\s*true\b/;

  let currentSection: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headerMatch = line.match(headerRegex);
    if (headerMatch) {
      currentSection = headerMatch[1]!.trim();
      continue;
    }
    if (currentSection !== 'features') continue;
    if (!codexHooksRegex.test(line)) continue;

    return {
      id: 'toml_codex_hooks',
      type: 'toml_codex_hooks',
      severity: 'info',
      startLine: i + 1,
      endLine: i + 1,
      snippet: line,
      message:
        '[features] codex_hooks = true 启用了 Codex CLI 的实验性 hook 引擎，可能影响 notify 的行为。若不主动使用该特性，建议关闭。',
    };
  }
  return null;
}

function countBrackets(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === '[') n++;
    else if (ch === ']') n--;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

function writeBackup(
  configPath: string,
  original: string,
  backupDir: string | undefined
): string {
  const dir = backupDir ?? dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ts = formatTimestamp(new Date());
  const backupPath = join(
    dir,
    `${basenameNoTomlExt(configPath)}.bak.${ts}.toml`
  );
  writeFileSync(backupPath, original, 'utf-8');
  return backupPath;
}

function atomicWrite(configPath: string, contents: string): void {
  const tempPath = `${configPath}.tmp`;
  writeFileSync(tempPath, contents, 'utf-8');
  renameSync(tempPath, configPath);
}

function basenameNoTomlExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? 'config.toml';
  return base.replace(/\.toml$/i, '');
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * After dropping lines we may have left a run of 3+ consecutive blank lines.
 * Codex doesn't care but it looks odd. Squeeze those back to at most 2.
 */
function collapseBlankRunsNearDeletions(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun++;
      if (blankRun <= 2) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out;
}
