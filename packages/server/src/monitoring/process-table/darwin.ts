import type { CommandRunner } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";

const DARWIN_PS_ARGS = ["-Ao", "pid=,ppid=,%cpu=,rss=,etimes=,comm=,args="];

export function parseDarwinPsRows(stdout: string): ProcessStatRow[] {
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

export async function collectDarwinProcessRows(
  runCommand: CommandRunner
): Promise<ProcessStatRow[]> {
  const result = await runCommand("ps", DARWIN_PS_ARGS);
  return parseDarwinPsRows(result.stdout);
}
