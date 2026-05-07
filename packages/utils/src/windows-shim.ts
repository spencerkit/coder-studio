/**
 * Helpers for spawning child processes that may resolve to Windows .cmd / .bat
 * shims.
 *
 * Why: Node 18.20.2 / 20.12.2 / 21.7.2 (CVE-2024-27980) refuses to spawn
 * .cmd or .bat files unless `shell: true` is set. The shims below ship as
 * .cmd on Windows, so they need shell:true; native executables (git, etc.)
 * must keep shell:false to avoid breaking argument escaping.
 */

const WINDOWS_CMD_SHIMS = new Set(["pnpm", "npm", "npx"]);

export function shouldUseShellForCommand(
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === "win32" && WINDOWS_CMD_SHIMS.has(command.toLowerCase());
}
