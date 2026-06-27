import { mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseDirectoryResult {
  currentPath: string;
  parentPath: string | null;
  directories: BrowseDirectoryEntry[];
  rootPaths: string[];
}

function invalidPath(message: string) {
  return { code: "invalid_path", message };
}

async function buildRootPaths(currentPath: string): Promise<string[]> {
  const roots = new Set<string>();
  const home = homedir();
  const currentRoot = parse(currentPath).root || "/";

  roots.add(currentRoot);

  roots.add(home);

  try {
    roots.add(await realpath(home));
  } catch {
    // Ignore realpath failures and keep the visible home path.
  }

  const relativeToRoot = currentPath.slice(currentRoot.length);
  const currentSegments = relativeToRoot.split(/[\\/]+/).filter(Boolean);
  const firstSegment = currentSegments[0];
  if (firstSegment) {
    roots.add(join(currentRoot, firstSegment));
  }

  return Array.from(roots);
}

function assertAbsolutePath(path: string): void {
  if (!isAbsolute(path)) {
    throw invalidPath("Absolute path is required");
  }
}

export async function browseDirectoryAbsolute(path: string): Promise<BrowseDirectoryResult> {
  assertAbsolutePath(path);
  const resolvedPath = resolve(path);
  const currentRoot = parse(resolvedPath).root || "/";

  const entries = await readdir(resolvedPath, { withFileTypes: true });
  const directories = (
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: join(resolvedPath, entry.name),
          };
        }

        if (!entry.isSymbolicLink()) {
          return null;
        }

        const entryPath = join(resolvedPath, entry.name);
        const entryStats = await stat(entryPath).catch(() => null);
        if (!entryStats?.isDirectory()) {
          return null;
        }

        return {
          name: entry.name,
          path: entryPath,
        };
      })
    )
  )
    .filter((entry): entry is BrowseDirectoryEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentPath: resolvedPath,
    parentPath: resolvedPath !== currentRoot ? dirname(resolvedPath) : null,
    directories,
    rootPaths: await buildRootPaths(resolvedPath),
  };
}

export async function createDirectoryAbsolute(path: string): Promise<void> {
  const requestedName = basename(path);

  if (!requestedName || requestedName === "." || requestedName === "..") {
    throw invalidPath("Folder name is required");
  }

  assertAbsolutePath(path);

  const resolvedPath = resolve(path);
  const dirName = basename(resolvedPath);

  if (!dirName || dirName === "." || dirName === "..") {
    throw invalidPath("Folder name is required");
  }

  const existing = await stat(resolvedPath).catch(() => null);
  if (existing) {
    throw { code: "already_exists", message: "Directory already exists" };
  }

  await mkdir(resolvedPath, { recursive: true });
}
