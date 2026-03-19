export const resolvePath = (base: string | undefined, path: string) => {
  if (!base || path.startsWith(base) || path.startsWith("/") || path.includes(":")) {
    return path;
  }
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
};

export const normalizeComparablePath = (value: string) => value.replace(/\\/g, "/");
export const sanitizeGitRelativePath = (value: string) => normalizeComparablePath(value).replace(/^[:/\\]+/, "");

export const matchesGitPreviewPath = (previewPath: string, changePath: string) => {
  const normalizedPreview = normalizeComparablePath(previewPath);
  const normalizedChange = normalizeComparablePath(changePath);
  return normalizedPreview === normalizedChange || normalizedPreview.endsWith(`/${normalizedChange}`);
};

export const looksLikeWindowsPath = (value: string) => /^[a-zA-Z]:[\\/]/.test(value);

export const fileParentLabel = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
};

export const displayPathName = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return value;
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};
