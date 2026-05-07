/**
 * Resolve a spawn argv on Windows by walking PATH+PATHEXT and unwrapping
 * npm-style cmd-shims into their underlying `node <entry.js>` invocation.
 *
 * Why: node-pty on Windows calls Win32 CreateProcess directly, which only
 * auto-appends `.exe` and cannot run `.cmd`/`.bat` shims. Tools installed by
 * npm (codex, claude, pnpm, …) ship as `.cmd` shims that wrap a node entry
 * script. On POSIX the kernel handles the equivalent via shebang; we replicate
 * that step on Windows so node-pty receives an argv it can actually spawn.
 *
 * On non-win32 platforms this is a no-op (returns argv unchanged).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";

export interface ResolveSpawnArgvDeps {
  platform?: NodeJS.Platform;
  pathEnv?: string;
  pathExt?: string;
  readFileSync?: (file: string) => string;
  existsSync?: (file: string) => boolean;
}

export interface ParsedCmdShim {
  node: string;
  entry: string;
}

export function resolveSpawnArgv(
  argv: readonly string[],
  deps: ResolveSpawnArgvDeps = {}
): string[] {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return [...argv];
  }
  const command = argv[0];
  if (command === undefined) {
    return [];
  }
  const restArgs = argv.slice(1);

  const readFileSync = deps.readFileSync ?? ((file: string) => fs.readFileSync(file, "utf8"));
  const existsSync = deps.existsSync ?? fs.existsSync;
  const pathEnv = deps.pathEnv ?? process.env.Path ?? process.env.PATH ?? "";
  const pathExt = deps.pathExt ?? process.env.PATHEXT ?? DEFAULT_PATHEXT;

  const resolved = resolveExecutablePath(command, pathEnv, pathExt, existsSync);
  if (!resolved) {
    // Let node-pty surface its own ENOENT — keeps existing error semantics.
    return [...argv];
  }

  const ext = path.win32.extname(resolved).toLowerCase();
  if (ext === ".exe" || ext === ".com") {
    return [resolved, ...restArgs];
  }
  if (ext === ".cmd" || ext === ".bat") {
    let content: string;
    try {
      content = readFileSync(resolved);
    } catch {
      return ["cmd.exe", "/d", "/s", "/c", resolved, ...restArgs];
    }
    const parsed = parseCmdShim(resolved, content);
    if (parsed) {
      return [parsed.node, parsed.entry, ...restArgs];
    }
    return ["cmd.exe", "/d", "/s", "/c", resolved, ...restArgs];
  }
  // Unknown extension (e.g. .ps1, .vbs): leave argv untouched and let the
  // caller/OS decide. Wrapping with cmd.exe wouldn't help these anyway.
  return [...argv];
}

export function parseCmdShim(shimPath: string, content: string): ParsedCmdShim | null {
  const dp0Dir = path.win32.dirname(shimPath);

  // Match the dispatch line: a quoted .js entry followed by %*
  const entryMatch = content.match(/"([^"\r\n]+\.js)"\s+%\*/i);
  const entryRaw = entryMatch?.[1];
  if (!entryRaw) {
    return null;
  }
  const entry = expandShimVars(entryRaw, dp0Dir);

  // Try to find a quoted node executable reference; prefer one that points at
  // an absolute/dp0-relative location, falling back to bare `node` otherwise.
  const nodeMatch = content.match(/"([^"\r\n]*node\.exe)"/i) ?? content.match(/"([^"\r\n]*node)"/i);
  const nodeRaw = nodeMatch?.[1];
  const node = nodeRaw ? expandShimVars(nodeRaw, dp0Dir) : "node";

  return { node, entry };
}

function expandShimVars(value: string, dp0Dir: string): string {
  // %~dp0 and %dp0% both expand to the directory containing the shim,
  // canonically with a trailing backslash.
  const dp0WithSlash = dp0Dir.endsWith("\\") ? dp0Dir : `${dp0Dir}\\`;
  let expanded = value;
  expanded = expanded.replace(/%~dp0/gi, dp0WithSlash);
  expanded = expanded.replace(/%dp0%/gi, dp0WithSlash);

  if (path.win32.isAbsolute(expanded)) {
    return path.win32.normalize(expanded);
  }
  return path.win32.resolve(dp0Dir, expanded);
}

function parsePathExt(pathExt: string): string[] {
  return pathExt
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function resolveExecutablePath(
  command: string,
  pathEnv: string,
  pathExt: string,
  existsSync: (file: string) => boolean
): string | null {
  const hasExt = path.win32.extname(command).length > 0;
  const extensions = parsePathExt(pathExt);

  if (path.win32.isAbsolute(command)) {
    if (existsSync(command)) {
      return command;
    }
    if (!hasExt) {
      for (const ext of extensions) {
        const candidate = command + ext;
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  }

  const dirs = pathEnv
    .split(";")
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0);

  for (const dir of dirs) {
    if (hasExt) {
      const candidate = path.win32.join(dir, command);
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const ext of extensions) {
      const candidate = path.win32.join(dir, command + ext);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
