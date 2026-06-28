import { existsSync } from "node:fs";
import { posix as pathPosix } from "node:path";

function splitPathEntries(pathValue: string): string[] {
  return pathValue
    .split(/[:;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isWindowsMountedPath(entry: string): boolean {
  return entry.startsWith("/mnt/");
}

function collectPreferredLinuxPathPrefixes(home: string): string[] {
  return [
    pathPosix.join(home, ".local", "bin"),
    pathPosix.join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
    pathPosix.join(home, ".fnm", "aliases", "default", "bin"),
    pathPosix.join(home, ".volta", "bin"),
    pathPosix.join(home, ".asdf", "shims"),
    pathPosix.join(home, ".nvm", "versions", "node", "current", "bin"),
  ];
}

/** Prefer Linux-native provider CLIs over Windows PATH entries injected by WSL interop. */
export function normalizeWslRuntimeProcessPath(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  return mergeWslRuntimeProcessPath(env, { includeWindowsPaths: true });
}

/** Agent/task PTY spawns must not resolve provider CLIs from Windows-mounted PATH entries. */
export function createWslLinuxNativeProcessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env = {
    ...Object.fromEntries(
      Object.entries(baseEnv).filter((entry): entry is [string, string] => entry[1] != null)
    ),
  };
  mergeWslRuntimeProcessPath(env, { includeWindowsPaths: false });
  return env;
}

function mergeWslRuntimeProcessPath(
  env: NodeJS.ProcessEnv,
  options: { includeWindowsPaths: boolean }
): string | undefined {
  const home = env.HOME?.trim();
  if (!home) {
    return env.PATH;
  }

  const preferredPrefixes = collectPreferredLinuxPathPrefixes(home);
  const currentEntries = splitPathEntries(env.PATH ?? "");
  const linuxEntries = currentEntries.filter((entry) => !isWindowsMountedPath(entry));
  const windowsEntries = currentEntries.filter((entry) => isWindowsMountedPath(entry));

  const seen = new Set<string>();
  const merged: string[] = [];
  const orderedEntries = options.includeWindowsPaths
    ? [...preferredPrefixes, ...linuxEntries, ...windowsEntries]
    : [...preferredPrefixes, ...linuxEntries];

  for (const entry of orderedEntries) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    merged.push(entry);
  }

  const nextPath = merged.join(":");
  env.PATH = nextPath;
  return nextPath;
}

export function resolveWslLinuxNativeCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const home = env.HOME?.trim();
  if (!home || !command.trim()) {
    return undefined;
  }

  for (const directory of collectPreferredLinuxPathPrefixes(home)) {
    const candidate = pathPosix.join(directory, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function isWslLinuxNativeCommandAvailable(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return resolveWslLinuxNativeCommand(command, env) !== undefined;
}
