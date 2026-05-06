/**
 * File IO operations with conflict detection.
 */

import { createHash } from "crypto";
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, rm, stat } from "fs/promises";
import { dirname, resolve } from "path";
import { getImageTypeInfo } from "./image.js";

export interface FileReadTextResult {
  kind: "text";
  content: string;
  baseHash: string;
  encoding: "utf-8";
}

export interface FileReadImageResult {
  kind: "image";
  mime: string;
  /** URL the web client can drop into an <img src>. Relative so auth cookie applies. */
  url: string;
  /** File size in bytes. Useful for the editor chrome ("PNG · 34.2 KB"). */
  size: number;
  /**
   * True for SVG: even though we return an image URL, the file is really
   * text and the UI should offer an "edit as text" toggle.
   */
  isTextBacked: boolean;
}

export type FileReadResult = FileReadTextResult | FileReadImageResult;

export interface FileWriteResult {
  newHash: string;
}

async function statSafe(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

export async function createFile(rootPath: string, relPath: string): Promise<void> {
  const abs = resolveSafe(rootPath, relPath);
  const existing = await statSafe(abs);

  if (existing) {
    throw { code: "already_exists", message: "File already exists" };
  }

  await mkdir(dirname(abs), { recursive: true });
  await fsWriteFile(abs, "", "utf-8");
}

export async function createDirectory(rootPath: string, relPath: string): Promise<void> {
  const abs = resolveSafe(rootPath, relPath);
  const existing = await statSafe(abs);

  if (existing) {
    throw { code: "already_exists", message: "Directory already exists" };
  }

  await mkdir(abs, { recursive: true });
}

export async function deleteEntry(rootPath: string, relPath: string): Promise<void> {
  const abs = resolveSafe(rootPath, relPath);
  const existing = await statSafe(abs);

  if (!existing) {
    throw { code: "not_found", message: "Target not found" };
  }

  await rm(abs, { recursive: true });
}

/**
 * Resolves a relative path safely to prevent path escape attacks.
 * Throws an error if the resolved path escapes the workspace root.
 *
 * @param root - Workspace root directory
 * @param relPath - Relative path within workspace
 * @returns Absolute path safely resolved within workspace
 */
export function resolveSafe(root: string, relPath: string): string {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, relPath);

  // Prevent path escape: resolved path must be under root
  if (!abs.startsWith(absRoot + "/") && abs !== absRoot) {
    throw { code: "path_escape", message: "Path escapes workspace root" };
  }

  return abs;
}

/**
 * Reads a file from the workspace.
 *
 * For images (extension allowlist), returns a URL the client can use with
 * a native <img> tag so we don't bloat the WebSocket channel with base64
 * payloads. For everything else, reads as UTF-8 text and includes a
 * baseHash for write-time conflict detection.
 *
 * @param workspaceId - Workspace id (used to construct the asset URL for images)
 * @param rootPath - Workspace root path
 * @param relPath - Relative file path
 */
export async function readFile(
  workspaceId: string,
  rootPath: string,
  relPath: string
): Promise<FileReadResult> {
  const abs = resolveSafe(rootPath, relPath);

  const imageType = getImageTypeInfo(relPath);
  if (imageType) {
    const stats = await stat(abs);
    const params = new URLSearchParams({
      workspaceId,
      path: relPath,
    });
    return {
      kind: "image",
      mime: imageType.mime,
      url: `/api/file?${params.toString()}`,
      size: stats.size,
      isTextBacked: imageType.isTextBacked,
    };
  }

  const content = await fsReadFile(abs, "utf-8");
  const baseHash = createHash("sha256").update(content).digest("hex");

  return {
    kind: "text",
    content,
    baseHash,
    encoding: "utf-8",
  };
}

/**
 * Writes a file to the workspace with conflict detection.
 * If the file changed externally since reading (baseHash mismatch),
 * throws conflict error.
 *
 * @param rootPath - Workspace root path
 * @param relPath - Relative file path
 * @param content - New content to write
 * @param baseHash - Hash of original content (optional)
 * @returns New hash after write
 */
export async function writeFile(
  rootPath: string,
  relPath: string,
  content: string,
  baseHash?: string
): Promise<FileWriteResult> {
  const abs = resolveSafe(rootPath, relPath);

  // Conflict check if baseHash provided
  if (baseHash) {
    const current = await fsReadFile(abs, "utf-8").catch(() => "");
    const currentHash = createHash("sha256").update(current).digest("hex");

    if (currentHash !== baseHash) {
      throw {
        code: "conflict",
        message: "File has been modified externally",
        details: {
          expectedHash: baseHash,
          actualHash: currentHash,
        },
      };
    }
  }

  // Ensure parent directory exists
  await mkdir(dirname(abs), { recursive: true });

  // Write new content
  await fsWriteFile(abs, content, "utf-8");
  const newHash = createHash("sha256").update(content).digest("hex");

  return { newHash };
}
