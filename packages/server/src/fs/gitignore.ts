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
  // Git internals that are transient or churn-heavy. We KEEP HEAD, refs/,
  // worktrees/, packed-refs, index, and config so branch/worktree state can
  // still be observed; this list only removes paths that either (a) cause
  // EPERM/ENOENT races on Windows (`.lock` files) or (b) have no UI value
  // and are write-heavy (`objects/`, `lfs/`, `logs/`, `hooks/`, `info/`).
  /(^|\/)\.git\/(objects|lfs|logs|hooks|info)(\/|$)/,
  /(^|\/)\.git\/(.*\/)?[^/]+\.lock$/,
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

function isTreeHidden(name: string): boolean {
  return name === ".git";
}

function isAlwaysTreeIgnored(name: string): boolean {
  return name === "node_modules" || name === ".git";
}

function isIgnoredByGitignore(ig: ReturnType<typeof ignore>, path: string): boolean {
  if (!path || path.startsWith("..")) {
    return false;
  }
  return ig.ignores(path) || ig.ignores(`${path}/`);
}

export interface GitignoreMatcher {
  hasRootGitignore: boolean;
  rootPath: string;
  rules: ReturnType<typeof ignore> | null;
}

export function createGitignoreMatcher(rootPath: string): GitignoreMatcher {
  const gitignorePath = join(rootPath, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return {
      hasRootGitignore: false,
      rootPath,
      rules: null,
    };
  }

  return {
    hasRootGitignore: true,
    rootPath,
    rules: ignore().add(readFileSync(gitignorePath, "utf-8")),
  };
}

export function isPathGitignored(matcher: GitignoreMatcher, relativePath: string): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (
    !matcher.rules ||
    !normalizedPath ||
    normalizedPath.startsWith("..") ||
    normalizedPath === ".git" ||
    normalizedPath.startsWith(".git/")
  ) {
    return false;
  }

  return isIgnoredByGitignore(matcher.rules, normalizedPath);
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
  const matcher = createGitignoreMatcher(rootPath);

  if (!matcher.hasRootGitignore) {
    // No .gitignore: default to skipping dotfiles, node_modules, .git
    return (name: string) => !isDefaultTreeIgnored(name);
  }

  return (name: string) => {
    if (isAlwaysTreeIgnored(name)) {
      return false;
    }

    const relativePath = relativeToRoot(rootPath, join(dirPath, name));
    return !isPathGitignored(matcher, relativePath);
  };
}

/**
 * Creates a filter for directory tree visibility.
 * Returns false if the entry should be hidden from the tree, true otherwise.
 */
export function createTreeVisibilityFilter(): (name: string) => boolean {
  return (name: string) => !isTreeHidden(name);
}

/**
 * Creates a filter for the file watcher (chokidar).
 * Returns a function suitable for chokidar's `ignored` option.
 */
export function createWatcherIgnoreFilter(rootPath: string): (path: string) => boolean {
  void rootPath;

  // Watcher coverage intentionally ignores .gitignore so frontend refreshes
  // can react to generated files and other ignored paths. Keep only the
  // hard-coded noise filters here.
  return (path: string) =>
    DEFAULT_WATCHER_IGNORED_PATTERNS.some((p) => p.test(normalizePath(path)));
}
