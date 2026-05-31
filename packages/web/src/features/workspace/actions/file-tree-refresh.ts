import type { FileNode } from "@coder-studio/core";

interface ApplyRootTreeRefreshArgs {
  previousTree: Map<string, FileNode[]> | null;
  previousLoadedDirs: Set<string>;
  previousExpandedDirs: Set<string> | null;
  rootChildren: FileNode[];
}

interface ApplyRootTreeRefreshResult {
  tree: Map<string, FileNode[]>;
  loadedDirs: Set<string>;
  prunedExpandedDirs: Set<string>;
}

interface ApplyDirectoryRefreshArgs {
  previousTree: Map<string, FileNode[]> | null;
  previousLoadedDirs: Set<string>;
  previousExpandedDirs: Set<string> | null;
  dirPath: string;
  children: FileNode[];
}

function collectDirectDirPaths(nodes: FileNode[]): Set<string> {
  const paths = new Set<string>();

  for (const node of nodes) {
    if (node.kind !== "dir") {
      continue;
    }

    paths.add(node.path);
  }

  return paths;
}

function isSameOrDescendantPath(path: string, ancestorPath: string): boolean {
  return ancestorPath === "." ? true : path === ancestorPath || path.startsWith(`${ancestorPath}/`);
}

function isSameOrDescendantOfAny(path: string, ancestorPaths: Set<string>): boolean {
  for (const ancestorPath of ancestorPaths) {
    if (path === ancestorPath || path.startsWith(`${ancestorPath}/`)) {
      return true;
    }
  }

  return false;
}

function reconcileTrackedPaths(
  paths: Set<string>,
  dirPath: string,
  survivingChildDirPaths: Set<string>
): Set<string> {
  const next = new Set<string>();

  for (const path of paths) {
    if (path === dirPath) {
      next.add(path);
      continue;
    }

    if (!isSameOrDescendantPath(path, dirPath)) {
      next.add(path);
      continue;
    }

    if (isSameOrDescendantOfAny(path, survivingChildDirPaths)) {
      next.add(path);
    }
  }

  return next;
}

export function collectRefreshTargets(paths: Set<string>): string[] {
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

export function pruneExpandedDirsToKnownTree(
  expandedDirs: Set<string>,
  rootChildren: FileNode[]
): Set<string> {
  return reconcileTrackedPaths(expandedDirs, ".", collectDirectDirPaths(rootChildren));
}

export function applyDirectoryRefresh({
  previousTree,
  previousLoadedDirs,
  previousExpandedDirs,
  dirPath,
  children,
}: ApplyDirectoryRefreshArgs): ApplyRootTreeRefreshResult {
  const survivingChildDirPaths = collectDirectDirPaths(children);
  const nextTree = new Map<string, FileNode[]>();

  for (const [path, nodes] of previousTree ?? []) {
    if (path === dirPath) {
      continue;
    }

    if (!isSameOrDescendantPath(path, dirPath)) {
      nextTree.set(path, nodes);
      continue;
    }

    if (path !== "." && isSameOrDescendantOfAny(path, survivingChildDirPaths)) {
      nextTree.set(path, nodes);
    }
  }

  nextTree.set(dirPath, children);

  return {
    tree: nextTree,
    loadedDirs: reconcileTrackedPaths(previousLoadedDirs, dirPath, survivingChildDirPaths),
    prunedExpandedDirs: reconcileTrackedPaths(
      previousExpandedDirs ?? new Set<string>(),
      dirPath,
      survivingChildDirPaths
    ),
  };
}

export function applyRootTreeRefresh({
  previousTree,
  previousLoadedDirs,
  previousExpandedDirs,
  rootChildren,
}: ApplyRootTreeRefreshArgs): ApplyRootTreeRefreshResult {
  return applyDirectoryRefresh({
    previousTree,
    previousLoadedDirs,
    previousExpandedDirs,
    dirPath: ".",
    children: rootChildren,
  });
}
