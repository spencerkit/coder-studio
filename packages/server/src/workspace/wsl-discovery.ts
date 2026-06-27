import {
  type CommandAvailabilityCheck,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";

export interface WslDiscoveryDeps {
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
}

async function hasWslCommand(
  commandExists?: CommandAvailabilityCheck,
  runCommand?: CommandRunner
): Promise<boolean> {
  const checker =
    commandExists ??
    ((command: string) =>
      checkCommandAvailable(command, {
        runCommand,
      }));

  return (await checker("wsl")) || (await checker("wsl.exe"));
}

export function parseWslDistroLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export async function listWslDistros(input: WslDiscoveryDeps = {}): Promise<string[]> {
  if (!(await hasWslCommand(input.commandExists, input.runCommand))) {
    return [];
  }

  const runner = input.runCommand ?? runCommandAsString;
  const { stdout } = await runner("wsl.exe", ["-l", "-q"], { windowsHide: true });
  return parseWslDistroLines(stdout);
}
