import path from "node:path";

export function isPathInsideRoot(
  rootPath: string,
  targetPath: string,
  pathApi: Pick<typeof path, "isAbsolute" | "relative" | "sep"> = path
): boolean {
  const rel = pathApi.relative(rootPath, targetPath);
  return rel !== ".." && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel);
}
