export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;
import { execFileAsString, type ExecFileRunner } from "./exec-file.js";

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  execFile?: ExecFileRunner;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const execFile = deps.execFile ?? execFileAsString;
  const lookup = getCommandLookupExecutable(platform);

  try {
    await execFile(lookup, [command], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
