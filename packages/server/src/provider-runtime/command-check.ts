import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);

export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;
type ExecFileOptions = { windowsHide?: boolean };

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  execFile?: (
    file: string,
    args: string[],
    options?: ExecFileOptions
  ) => Promise<{ stdout: string; stderr: string }>;
}

function runExecFile(
  execFile: NonNullable<CommandCheckDeps["execFile"]>,
  file: string,
  args: string[],
  options?: ExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
  if (options && execFile.length >= 3) {
    return execFile(file, args, options);
  }

  return execFile(file, args);
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const execFile =
    deps.execFile ??
    ((file: string, args: string[], options?: ExecFileOptions) =>
      execFileAsync(file, args, options));
  const lookup = getCommandLookupExecutable(platform);

  try {
    await runExecFile(
      execFile,
      lookup,
      [command],
      platform === "win32" ? { windowsHide: true } : undefined
    );
    return true;
  } catch {
    return false;
  }
}
