import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const LINUX_PS_ARGS = ["-eo", "pid=,ppid=,%cpu=,rss=,etimes=,comm=,args="];

export function parseLinuxPsRows(stdout: string): ProcessStatRow[] {
  const rows: ProcessStatRow[] = [];

  for (const line of stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)) {
    const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) {
      continue;
    }

    const [, pid, ppid, cpuPercent, rssKb, elapsedSec, executable, command] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      cpuPercent: Number(cpuPercent),
      rssBytes: Number(rssKb) * 1024,
      elapsedSec: Number(elapsedSec),
      executable,
      command,
    });
  }

  return rows;
}

export async function collectLinuxProcessRows(
  runCommand: CommandRunner
): Promise<ProcessStatRow[]> {
  const result = await runCommand("ps", LINUX_PS_ARGS);
  return parseLinuxPsRows(result.stdout);
}
