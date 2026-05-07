export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;

import { type CommandRunner, runCommandAsString } from "./command-runner.js";

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const runCommand = deps.runCommand ?? runCommandAsString;
  const lookup = getCommandLookupExecutable(platform);

  try {
    const { stdout } = await runCommand(lookup, [command], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
