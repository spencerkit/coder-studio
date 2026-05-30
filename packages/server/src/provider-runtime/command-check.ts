export type CommandAvailabilityCheck = (command: string) => Promise<boolean>;

import { existsSync as fsExistsSync } from "node:fs";
import path from "node:path";
import { type CommandRunner, runCommandAsString } from "./command-runner.js";

export interface CommandCheckDeps {
  platform?: NodeJS.Platform;
  runCommand?: CommandRunner;
  existsSync?: (file: string) => boolean;
  pathExt?: string;
}

export function getCommandLookupExecutable(platform: NodeJS.Platform): "where" | "which" {
  return platform === "win32" ? "where" : "which";
}

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

function isAbsoluteForPlatform(value: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

function parsePathExt(pathExt: string): string[] {
  return pathExt
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function checkCommandAvailable(
  command: string,
  deps: CommandCheckDeps = {}
): Promise<boolean> {
  const platform = deps.platform ?? process.platform;
  const existsSync = deps.existsSync ?? fsExistsSync;

  // Absolute paths can't be passed to `where`/`which`. On Windows in particular,
  // `where.exe` parses the first ':' as a `path:pattern` separator, so any
  // `C:\...` argument is rejected with "invalid pattern" — which made every
  // managed LSP install fail at the verify step. Resolve such inputs by direct
  // filesystem existence checks (mirroring `where`'s PATHEXT fallback on win32).
  if (isAbsoluteForPlatform(command, platform)) {
    if (existsSync(command)) {
      return true;
    }
    if (platform === "win32" && path.win32.extname(command).length === 0) {
      const pathExt = deps.pathExt ?? process.env.PATHEXT ?? DEFAULT_PATHEXT;
      for (const ext of parsePathExt(pathExt)) {
        if (existsSync(command + ext)) {
          return true;
        }
      }
    }
    return false;
  }

  const runCommand = deps.runCommand ?? runCommandAsString;
  const lookup = getCommandLookupExecutable(platform);

  try {
    const { stdout } = await runCommand(lookup, [command], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
