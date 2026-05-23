import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, posix, relative } from "node:path";
import mime from "mime-types";
import { resolveSafe } from "../fs/file-io.js";

export interface PreviewResource {
  bytes: Buffer;
  mime: string;
  size: number;
  workspaceRelativePath: string;
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel !== ".." && !rel.startsWith(`..${"/"}`) && !isAbsolute(rel);
}

export function resolvePreviewResourcePath(entryPath: string, requestedPath: string): string {
  const baseDir = posix.dirname(entryPath);
  const normalizedRequest = requestedPath.replaceAll("\\", "/");
  const normalized = posix.normalize(posix.join(baseDir, normalizedRequest));

  if (normalized === ".." || normalized.startsWith("../") || posix.isAbsolute(normalized)) {
    throw new Error("path_escape");
  }

  return normalized;
}

export async function loadPreviewResource(
  workspaceRootPath: string,
  workspaceRelativePath: string
): Promise<PreviewResource> {
  const absolutePath = resolveSafe(workspaceRootPath, workspaceRelativePath);

  const [realWorkspacePath, realAssetPath] = await Promise.all([
    realpath(workspaceRootPath),
    realpath(absolutePath),
  ]);

  if (!isPathInsideRoot(realWorkspacePath, realAssetPath)) {
    throw new Error("path_escape");
  }

  const [bytes, stats] = await Promise.all([readFile(realAssetPath), stat(realAssetPath)]);

  if (!stats.isFile()) {
    throw new Error("not_a_file");
  }

  return {
    bytes,
    mime: mime.lookup(workspaceRelativePath) || "application/octet-stream",
    size: stats.size,
    workspaceRelativePath,
  };
}
