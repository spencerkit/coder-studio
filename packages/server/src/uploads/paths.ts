import { randomUUID } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_FILENAME_LENGTH = 64;
const KEEP_FILENAME_CHAR = /[a-zA-Z0-9._一-鿿 \-]/;
const WORKSPACE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function sanitizeOriginalName(input: string): string {
  let sanitized = "";

  for (const char of input.trim()) {
    sanitized += KEEP_FILENAME_CHAR.test(char) ? char : "_";
  }

  sanitized = sanitized.replace(/^\.+/, "");

  if (sanitized.length === 0 || /^[_\s]*$/.test(sanitized)) {
    return "file";
  }

  if (sanitized.length <= MAX_FILENAME_LENGTH) {
    return sanitized;
  }

  const lastDot = sanitized.lastIndexOf(".");
  if (lastDot > 0 && sanitized.length - lastDot <= 16) {
    const ext = sanitized.slice(lastDot);
    const stem = sanitized.slice(0, MAX_FILENAME_LENGTH - ext.length);
    return stem + ext;
  }

  return sanitized.slice(0, MAX_FILENAME_LENGTH);
}

export function validateWorkspaceId(id: string): void {
  if (!WORKSPACE_ID_RE.test(id)) {
    throw new Error(`invalid workspace id: ${JSON.stringify(id)}`);
  }
}

export interface GenerateBucketPathInput {
  uploadsDir: string;
  workspaceId: string;
  originalName: string;
  now?: Date;
}

export interface GenerateBucketPathResult {
  dir: string;
  absolutePath: string;
  uuid8: string;
  sanitizedName: string;
}

export async function assertNoSymlinkInPath(rootDir: string, targetDir: string): Promise<void> {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetDir);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`target dir escaped uploads root: ${resolvedTarget}`);
  }

  let current = resolvedRoot;
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative) {
    return;
  }

  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`symlinked upload path segment is not allowed: ${current}`);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
}

async function assertDirectorySegmentSafe(segmentPath: string): Promise<void> {
  const info = await lstat(segmentPath);
  if (info.isSymbolicLink()) {
    throw new Error(`symlinked upload path segment is not allowed: ${segmentPath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`upload path segment is not a directory: ${segmentPath}`);
  }
}

export async function ensureSafeUploadDir(rootDir: string, targetDir: string): Promise<void> {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetDir);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`target dir escaped uploads root: ${resolvedTarget}`);
  }

  try {
    await assertDirectorySegmentSafe(resolvedRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    await mkdir(resolvedRoot, { recursive: true });
    await assertDirectorySegmentSafe(resolvedRoot);
  }

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative) {
    return;
  }

  let current = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);

    try {
      await assertDirectorySegmentSafe(current);
      continue;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    try {
      await mkdir(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw error;
      }
    }

    await assertDirectorySegmentSafe(current);
  }
}

export function generateBucketPath(input: GenerateBucketPathInput): GenerateBucketPathResult {
  validateWorkspaceId(input.workspaceId);

  const now = input.now ?? new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dir = path.join(input.uploadsDir, input.workspaceId, dateStr);
  const sanitizedName = sanitizeOriginalName(input.originalName);
  const uuid8 = randomUUID().replace(/-/g, "").slice(0, 8);
  const absolutePath = path.resolve(dir, `${uuid8}-${sanitizedName}`);
  const uploadsRoot = `${path.resolve(input.uploadsDir)}${path.sep}`;

  if (!absolutePath.startsWith(uploadsRoot)) {
    throw new Error(`generated upload path escaped uploads root: ${absolutePath}`);
  }

  return {
    dir,
    absolutePath,
    uuid8,
    sanitizedName,
  };
}
