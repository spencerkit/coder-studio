/**
 * Codex config.toml auditor
 *
 * Scans `~/.codex/config.toml` for settings that interfere with Coder Studio's
 * PTY-driven session tracking. We no longer inject hooks into Codex, but the
 * user's config.toml can still shadow our launch-time notify wiring or enable
 * experimental behavior that changes CLI semantics.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CodexAuditFindingType = "toml_notify" | "toml_codex_hooks";
export type CodexAuditSeverity = "warn" | "info";

export interface CodexAuditFinding {
  id: CodexAuditFindingType;
  type: CodexAuditFindingType;
  severity: CodexAuditSeverity;
  startLine: number;
  endLine: number;
  snippet: string;
  message: string;
}

export interface CodexConfigAudit {
  configPath: string;
  exists: boolean;
  findings: CodexAuditFinding[];
}

export interface CodexCleanupOptions {
  removeIds: CodexAuditFindingType[];
  backupDir?: string;
}

export interface CodexCleanupResult {
  removed: CodexAuditFindingType[];
  backupPath: string | null;
  noop: boolean;
}

export function resolveCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome && codexHome.trim()) {
    return join(codexHome, "config.toml");
  }
  return join(homedir(), ".codex", "config.toml");
}

export function auditCodexConfigToml(configPath?: string): CodexConfigAudit {
  const path = configPath ?? resolveCodexConfigPath();

  if (!existsSync(path)) {
    return { configPath: path, exists: false, findings: [] };
  }

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
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

  const audit = auditCodexConfigToml(configPath);
  const selected = audit.findings.filter((f) => opts.removeIds.includes(f.id));
  if (selected.length === 0) {
    return { removed: [], backupPath: null, noop: true };
  }

  const original = readFileSync(configPath, "utf-8");
  const backupPath = writeBackup(configPath, original, opts.backupDir);

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

  const cleaned = collapseBlankRunsNearDeletions(kept);
  const output = cleaned.join("\n");

  atomicWrite(configPath, output);

  return {
    removed: selected.map((f) => f.id),
    backupPath,
    noop: false,
  };
}

function detectTopLevelNotify(lines: string[]): CodexAuditFinding | null {
  const headerRegex = /^\s*\[/;
  const notifyRegex = /^\s*notify\s*=\s*(.*)$/;

  let inTopLevel = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (headerRegex.test(trimmed)) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;

    const m = trimmed.match(notifyRegex);
    if (!m) continue;

    const rhs = (m[1] ?? "").trim();
    if (rhs.startsWith("[") && rhs.endsWith("]") && countBrackets(rhs) === 0) {
      return makeNotifyFinding(lines, i, i);
    }
    if (rhs.startsWith("[")) {
      let depth = countBrackets(rhs);
      for (let j = i + 1; j < lines.length; j++) {
        depth += countBrackets(lines[j]!);
        if (depth === 0) {
          return makeNotifyFinding(lines, i, j);
        }
      }
      return null;
    }
    return makeNotifyFinding(lines, i, i);
  }
  return null;
}

function makeNotifyFinding(lines: string[], startIdx: number, endIdx: number): CodexAuditFinding {
  return {
    id: "toml_notify",
    type: "toml_notify",
    severity: "warn",
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    snippet: lines.slice(startIdx, endIdx + 1).join("\n"),
    message:
      "config.toml 顶层设置了 notify，会与 Coder Studio 的启动参数注入冲突，可能导致 session 状态不同步。",
  };
}

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
    if (currentSection !== "features") continue;
    if (!codexHooksRegex.test(line)) continue;

    return {
      id: "toml_codex_hooks",
      type: "toml_codex_hooks",
      severity: "info",
      startLine: i + 1,
      endLine: i + 1,
      snippet: line,
      message:
        "[features] codex_hooks = true 启用了 Codex CLI 的实验性 hook 引擎，可能影响 notify 的行为。若不主动使用该特性，建议关闭。",
    };
  }
  return null;
}

function countBrackets(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === "[") n++;
    else if (ch === "]") n--;
  }
  return n;
}

function writeBackup(configPath: string, original: string, backupDir: string | undefined): string {
  const dir = backupDir ?? dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const ts = formatTimestamp(new Date());
  const backupPath = join(dir, `${basenameNoTomlExt(configPath)}.bak.${ts}.toml`);
  writeFileSync(backupPath, original, "utf-8");
  return backupPath;
}

function atomicWrite(configPath: string, contents: string): void {
  const tempPath = `${configPath}.tmp`;
  writeFileSync(tempPath, contents, "utf-8");
  renameSync(tempPath, configPath);
}

function basenameNoTomlExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? "config.toml";
  return base.replace(/\.toml$/i, "");
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function collapseBlankRunsNearDeletions(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 2) out.push(line);
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out;
}
