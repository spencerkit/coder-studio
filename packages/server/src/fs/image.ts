/**
 * Image file detection.
 *
 * Used by both the `file.read` command (to decide whether a file should be
 * streamed as an image instead of decoded as UTF-8 text) and the
 * `/api/file` HTTP endpoint (to guard which files are allowed through and
 * to pick the right Content-Type).
 *
 * Detection is intentionally extension-based, not content-sniffing:
 *   - It stays consistent between `file.read` and the static endpoint.
 *   - File trees in practice already use extensions faithfully.
 *   - Content-sniffing every open would require a second stat/read round
 *     trip and complicate the "is this text?" path.
 */

import { extname } from 'path';

export interface ImageTypeInfo {
  mime: string;
  /**
   * True when the file is really a text format (SVG) that we *display* as an
   * image by default. The editor UI uses this to offer an "edit as text"
   * toggle so users can still tweak SVG source.
   */
  isTextBacked: boolean;
}

const IMAGE_MIME_BY_EXT: Record<string, ImageTypeInfo> = {
  '.png': { mime: 'image/png', isTextBacked: false },
  '.jpg': { mime: 'image/jpeg', isTextBacked: false },
  '.jpeg': { mime: 'image/jpeg', isTextBacked: false },
  '.gif': { mime: 'image/gif', isTextBacked: false },
  '.webp': { mime: 'image/webp', isTextBacked: false },
  '.bmp': { mime: 'image/bmp', isTextBacked: false },
  '.ico': { mime: 'image/x-icon', isTextBacked: false },
  '.svg': { mime: 'image/svg+xml', isTextBacked: true },
};

export function getImageTypeInfo(filePath: string): ImageTypeInfo | null {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}

export function isImageFile(filePath: string): boolean {
  return getImageTypeInfo(filePath) !== null;
}
