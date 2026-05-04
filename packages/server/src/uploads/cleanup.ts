import { readdir, rm, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_BUCKET_MAX_BYTES, UPLOAD_TTL_HOURS } from './constants.js';
import { validateWorkspaceId } from './paths.js';

interface UploadLogger {
  warn(ctx: Record<string, unknown>, message: string): void;
}

interface FileEntry {
  absPath: string;
  size: number;
  mtimeMs: number;
}

const WORKSPACE_ID_RE_FOR_GC = /^[a-zA-Z0-9_-]+$/;

async function listFilesRecursive(root: string): Promise<FileEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files: FileEntry[] = [];
  for (const entry of entries) {
    const childPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(childPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(childPath);
    files.push({
      absPath: childPath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    });
  }

  return files;
}

async function pruneEmptyDirectories(root: string): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    await pruneEmptyDirectories(path.join(root, entry.name));
  }

  const remainingEntries = await readdir(root).catch(() => [] as string[]);
  if (remainingEntries.length === 0) {
    await rmdir(root).catch(() => undefined);
  }
}

export async function deleteWorkspaceUploads(
  uploadsDir: string,
  workspaceId: string
): Promise<void> {
  validateWorkspaceId(workspaceId);
  const bucket = path.join(uploadsDir, workspaceId);
  await rm(bucket, { recursive: true, force: true });
}

export async function enforceBucketCap(
  uploadsDir: string,
  workspaceId: string,
  capBytes: number,
  logger?: UploadLogger
): Promise<void> {
  validateWorkspaceId(workspaceId);
  const bucket = path.join(uploadsDir, workspaceId);
  const files = await listFilesRecursive(bucket);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  if (totalBytes <= capBytes) {
    return;
  }

  files.sort((a, b) => a.mtimeMs - b.mtimeMs);
  let remainingBytes = totalBytes;

  for (const file of files) {
    if (remainingBytes <= capBytes) {
      break;
    }

    try {
      await unlink(file.absPath);
      remainingBytes -= file.size;
    } catch (error) {
      logger?.warn(
        { err: error, file: file.absPath },
        'failed to evict file during bucket cap enforcement'
      );
    }
  }

  await pruneEmptyDirectories(bucket);
}

export async function runStartupGc(
  uploadsDir: string,
  logger?: UploadLogger
): Promise<void> {
  const cutoffMs = Date.now() - UPLOAD_TTL_HOURS * 3_600_000;

  let workspaceEntries: import('node:fs').Dirent[];
  try {
    workspaceEntries = await readdir(uploadsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    logger?.warn({ err: error, uploadsDir }, 'startup gc: failed to list root');
    return;
  }

  for (const workspaceEntry of workspaceEntries) {
    if (!workspaceEntry.isDirectory()) {
      continue;
    }

    const workspaceDir = path.join(uploadsDir, workspaceEntry.name);
    const dateEntries = await readdir(workspaceDir, { withFileTypes: true }).catch(
      () => [] as import('node:fs').Dirent[]
    );

    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) {
        continue;
      }

      const dateDir = path.join(workspaceDir, dateEntry.name);
      const files = await listFilesRecursive(dateDir);

      for (const file of files) {
        if (file.mtimeMs >= cutoffMs) {
          continue;
        }

        try {
          await unlink(file.absPath);
        } catch (error) {
          logger?.warn({ err: error, filePath: file.absPath }, 'startup gc: failed on file');
        }
      }

      await pruneEmptyDirectories(dateDir);
    }

    if (WORKSPACE_ID_RE_FOR_GC.test(workspaceEntry.name)) {
      await enforceBucketCap(uploadsDir, workspaceEntry.name, UPLOAD_BUCKET_MAX_BYTES, logger);
    }

    await pruneEmptyDirectories(workspaceDir);
  }
}
