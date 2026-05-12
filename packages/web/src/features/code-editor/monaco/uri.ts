import * as monaco from "monaco-editor";

function normalizeRootPath(rootPath: string): string {
  const normalized = collapseSlashes(rootPath.replace(/\\/g, "/"));
  const driveMatch = normalized.match(/^([A-Za-z]):(\/.*)?$/);

  if (driveMatch) {
    const drive = driveMatch[1]!.toLowerCase();
    const suffix = driveMatch[2] ?? "";
    return suffix === "/" ? `${drive}:/` : `${drive}:${trimTrailingSlash(suffix)}`;
  }

  return normalized === "/" ? normalized : trimTrailingSlash(normalized);
}

function normalizeRelativePath(relativePath: string): string {
  const rawSegments = collapseSlashes(relativePath.replace(/\\/g, "/")).split("/").filter(Boolean);
  const normalizedSegments: string[] = [];

  for (const segment of rawSegments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(segment);
  }

  return normalizedSegments.join("/");
}

function collapseSlashes(value: string): string {
  return value.replace(/\/+/g, "/");
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

function joinWorkspacePath(workspaceRootPath: string, relativePath: string): string {
  const normalizedRoot = normalizeRootPath(workspaceRootPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);

  if (!normalizedRelativePath) {
    return normalizedRoot;
  }

  return normalizedRoot === "/"
    ? `/${normalizedRelativePath}`
    : `${normalizedRoot}/${normalizedRelativePath}`;
}

function getUriAbsolutePath(uri: monaco.Uri): string {
  return normalizeRootPath(uri.fsPath || uri.path);
}

export function toWorkspaceFileUri(workspaceRootPath: string, relativePath: string): monaco.Uri {
  return monaco.Uri.file(joinWorkspacePath(workspaceRootPath, relativePath));
}

export function fromWorkspaceFileUri(uri: monaco.Uri, workspaceRootPath: string): string | null {
  if (uri.scheme !== "file") {
    return null;
  }

  const absolutePath = getUriAbsolutePath(uri);
  const normalizedRoot = normalizeRootPath(workspaceRootPath);

  if (absolutePath === normalizedRoot) {
    return "";
  }

  const rootPrefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  if (!absolutePath.startsWith(rootPrefix)) {
    return null;
  }

  return absolutePath.slice(rootPrefix.length);
}
