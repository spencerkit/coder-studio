import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const WINDOWS_SCRIPT = [
  "$payload = Get-CimInstance Win32_Process | ForEach-Object {",
  "  [pscustomobject]@{",
  "    Id = $_.ProcessId;",
  "    ParentProcessId = $_.ParentProcessId;",
  "    CpuPercent = $null;",
  "    WorkingSet64 = $null;",
  "    ElapsedSec = $null;",
  "    Path = $_.ExecutablePath;",
  "    CommandLine = $_.CommandLine;",
  "  }",
  "};",
  "$payload | ConvertTo-Json -Compress",
].join(" ");

export function parseWindowsProcessRows(rows: unknown[]): ProcessStatRow[] {
  const normalizedRows: ProcessStatRow[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const candidate = row as Record<string, unknown>;
    if (typeof candidate.Id !== "number" || typeof candidate.ParentProcessId !== "number") {
      continue;
    }

    normalizedRows.push({
      pid: candidate.Id,
      ppid: candidate.ParentProcessId,
      cpuPercent: typeof candidate.CpuPercent === "number" ? candidate.CpuPercent : null,
      rssBytes: typeof candidate.WorkingSet64 === "number" ? candidate.WorkingSet64 : null,
      elapsedSec: typeof candidate.ElapsedSec === "number" ? candidate.ElapsedSec : undefined,
      executable: typeof candidate.Path === "string" ? candidate.Path : undefined,
      command: typeof candidate.CommandLine === "string" ? candidate.CommandLine : undefined,
    });
  }

  return normalizedRows;
}

export async function collectWindowsProcessRows(
  runCommand: CommandRunner
): Promise<ProcessStatRow[]> {
  const result = await runCommand("powershell", ["-NoProfile", "-Command", WINDOWS_SCRIPT]);
  const parsed = JSON.parse(result.stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return parseWindowsProcessRows(rows);
}
