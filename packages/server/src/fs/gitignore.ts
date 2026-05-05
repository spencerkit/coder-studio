/**
 * .gitignore parser and filter using the 'ignore' library.
 */

import { existsSync, readFileSync } from "fs";
import ignore from "ignore";
import { join, relative } from "path";

const DEFAULT_WATCHER_IGNORED_PATTERNS: RegExp[] = [
  /(^|\/)node_modules(\/|$)/,
  /\.DS_Store/,
  /Thumbs\.db/,
  /(^|\/)\.playwright-mcp(\/|$)/,
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function relativeToRoot(rootPath: string, path: string): string {
  return normalizePath(relative(rootPath, path));
}

function isDefaultTreeIgnored(name: string): boolean {
  return name.startsWith(".") || name === "node_modules" || name === ".git";
}

function isIgnoredByGitignore(ig: ReturnType<typeof ignore>, path: string): boolean {
  if (!path || path.startsWith("..")) {
    return false;
  }
  return ig.ignores(path) || ig.ignores(`${path}/`);
}

/**
 * Creates a filter function that respects .gitignore rules for a given directory.
 * Returns false if the entry should be skipped (ignored), true if it should be included.
 *
 * @param rootPath - Workspace root path (for .gitignore resolution)
 * @param dirPath - Current directory being read
 * @returns Filter function: (name: string) => boolean
 */
export function createGitignoreFilter(
  rootPath: string,
  dirPath: string
): (name: string) => boolean {
  const gitignorePath = join(rootPath, ".gitignore");

  if (!existsSync(gitignorePath)) {
    // No .gitignore: default to skipping dotfiles, node_modules, .git
    return (name: string) => !isDefaultTreeIgnored(name);
  }

  const gitignoreContent = readFileSync(gitignorePath, "utf-8");
  const ig = ignore().add(gitignoreContent);

  return (name: string) => {
    if (isDefaultTreeIgnored(name)) {
      return false;
    }

    const relativePath = relativeToRoot(rootPath, join(dirPath, name));
    return !isIgnoredByGitignore(ig, relativePath);
  };
}

/**
 * Creates a filter for the file watcher (chokidar).
 * Returns a function suitable for chokidar's `ignored` option.
 */
export function createWatcherIgnoreFilter(rootPath: string): (path: string) => boolean {
  const gitignorePath = join(rootPath, ".gitignore");

  if (!existsSync(gitignorePath)) {
    // Default: ignore obvious noise, but keep .git metadata watched so git
    // operations can trigger refreshes.
    return (path: string) =>
      DEFAULT_WATCHER_IGNORED_PATTERNS.some((p) => p.test(normalizePath(path)));
  }

  const gitignoreContent = readFileSync(gitignorePath, "utf-8");
  const ig = ignore().add(gitignoreContent);

  return (path: string) => {
    const normalizedPath = normalizePath(path);
    if (DEFAULT_WATCHER_IGNORED_PATTERNS.some((p) => p.test(normalizedPath))) {
      return true;
    }

    const relativePath = relativeToRoot(rootPath, path);
    return isIgnoredByGitignore(ig, relativePath);
  };
}
