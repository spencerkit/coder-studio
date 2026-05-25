/**
 * Helpers for spawning child processes that may resolve to Windows .cmd / .bat
 * shims.
 *
 * Why: Node 18.20.2 / 20.12.2 / 21.7.2 (CVE-2024-27980) refuses to spawn
 * .cmd or .bat files unless `shell: true` is set. The shims below ship as
 * .cmd on Windows, so they need shell:true; native executables (git, etc.)
 * must keep shell:false to avoid breaking argument escaping.
 */

import { basename, extname } from "node:path";

const WINDOWS_CMD_SHIMS = new Set(["pnpm", "npm", "npx"]);
const WINDOWS_SHELL_EXTENSIONS = new Set([".cmd", ".bat"]);

export function shouldUseShellForCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (platform !== "win32") {
    return false;
  }

  const normalizedCommand = command.toLowerCase();
  if (WINDOWS_CMD_SHIMS.has(normalizedCommand)) {
    return true;
  }

  return WINDOWS_SHELL_EXTENSIONS.has(extname(basename(normalizedCommand)));
}
