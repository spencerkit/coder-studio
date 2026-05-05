import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);

export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  execFile?: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const execFile = deps.execFile ?? ((file: string, args: string[]) => execFileAsync(file, args));
  const lookup = getCommandLookupExecutable(platform);

  try {
    await execFile(lookup, [command]);
    return true;
  } catch {
    return false;
  }
}
