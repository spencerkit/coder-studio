import { closeSync, existsSync, openSync, readSync, statSync } from "fs";

const DEFAULT_MAX_LINES = 40;
const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MAX_BYTES = 16 * 1024;

export interface LogExcerptOptions {
  startOffset?: number;
  maxBytes?: number;
  maxLines?: number;
  maxChars?: number | null;
}

export const getFileSize = (path: string): number => {
  if (!existsSync(path)) {
    return 0;
  }

  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export const readLogExcerpt = (
  path: string,
  {
    startOffset = 0,
    maxBytes = DEFAULT_MAX_BYTES,
    maxLines = DEFAULT_MAX_LINES,
    maxChars = DEFAULT_MAX_CHARS,
  }: LogExcerptOptions = {}
): string | null => {
  if (!existsSync(path)) {
    return null;
  }

  const fileSize = getFileSize(path);
  const safeOffset = startOffset > fileSize ? 0 : Math.max(0, startOffset);
  if (fileSize === safeOffset) {
    return null;
  }

  const bytesToRead = Math.min(fileSize - safeOffset, maxBytes);
  const readStart = fileSize - bytesToRead;
  const buffer = Buffer.allocUnsafe(bytesToRead);
  const fd = openSync(path, "r");
  let content = "";
  let startsMidLine = false;

  try {
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, readStart);
    if (bytesRead === 0) {
      return null;
    }

    if (readStart > safeOffset && readStart > 0) {
      const previousByte = Buffer.alloc(1);
      const previousBytesRead = readSync(fd, previousByte, 0, 1, readStart - 1);
      startsMidLine = previousBytesRead === 1 && previousByte[0] !== 0x0a;
    }

    content = buffer.toString("utf-8", 0, bytesRead).trimEnd();
  } finally {
    closeSync(fd);
  }

  if (startsMidLine) {
    const firstNewlineIndex = content.indexOf("\n");
    if (firstNewlineIndex !== -1) {
      content = content.slice(firstNewlineIndex + 1);
    }
  }

  if (content.length === 0) {
    return null;
  }

  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  const excerpt = lines.slice(-maxLines).join("\n");
  if (maxChars === null || excerpt.length <= maxChars) {
    return excerpt;
  }

  return `…${excerpt.slice(-maxChars + 1)}`;
};
