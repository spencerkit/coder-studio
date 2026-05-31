import { type CommandRunner, runCommandAsString } from "../../provider-runtime/command-runner.js";
import type { ProcessStatRow } from "../types.js";
import { collectDarwinProcessRows, parseDarwinPsRows } from "./darwin.js";
import { collectLinuxProcessRows, parseLinuxPsRows } from "./linux.js";
import { collectWindowsProcessRows, parseWindowsProcessRows } from "./win32.js";

export { parseDarwinPsRows, parseLinuxPsRows, parseWindowsProcessRows };

export interface ProcessTableCollector {
  collect(): Promise<ProcessStatRow[]>;
}

export function createProcessTableCollector(
  platform: NodeJS.Platform = process.platform,
  runCommand: CommandRunner = runCommandAsString
): ProcessTableCollector {
  if (platform === "darwin") {
    return { collect: () => collectDarwinProcessRows(runCommand) };
  }
  if (platform === "linux") {
    return { collect: () => collectLinuxProcessRows(runCommand) };
  }
  return { collect: () => collectWindowsProcessRows(runCommand) };
}
