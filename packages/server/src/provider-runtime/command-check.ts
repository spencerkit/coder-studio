export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;
import { execFileAsString, type ExecFileRunner } from "./exec-file.js";

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  execFile?: ExecFileRunner;
}

export interface ResolvedCommand {
  command: string;
  executable: string;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export async function resolveCommand(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<ResolvedCommand | null> {
  const platform = deps.platform ?? process.platform;
  const execFile = deps.execFile ?? execFileAsString;
  const lookup = getCommandLookupExecutable(platform);

  try {
    const { stdout } = await execFile(lookup, [command], { windowsHide: true });
    const executable = firstLookupMatch(stdout);
    if (!executable) {
      return null;
    }

    return { command, executable };
  } catch {
    return null;
  }
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  return (await resolveCommand(command, deps)) !== null;
}

function firstLookupMatch(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.trim();
    if (match.length > 0) {
      return match;
    }
  }

  return null;
}
