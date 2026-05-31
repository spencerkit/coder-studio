import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathInsideRoot } from "../fs/path-safety.js";

const PREVIEW_RESOURCE_TAGS = new Set([
  "embed",
  "iframe",
  "image",
  "img",
  "input",
  "link",
  "source",
  "track",
  "audio",
  "video",
  "script",
]);

const PREVIEW_RESOURCE_ATTRS = new Set(["href", "poster", "src", "xlink:href"]);

const STYLE_BLOCK_PATTERN = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
const PREVIEW_TAG_PATTERN = /<\s*([A-Za-z][\w:-]*)([^<>]*?)>/g;
const PREVIEW_ATTR_PATTERN =
  /(\s+)(srcset|src|href|poster|xlink:href|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi;

interface PreviewRewriteInput {
  sessionId: string;
  workspaceRootPath: string;
  baseWorkspacePath?: string;
}

export function encodePathSegments(inputPath: string): string {
  return inputPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function rewritePreviewHtmlResourceUrls(
  html: string,
  input: { sessionId: string; workspaceRootPath: string; entryPath: string }
): string {
  const rewriteInput = {
    sessionId: input.sessionId,
    workspaceRootPath: input.workspaceRootPath,
    baseWorkspacePath: input.entryPath,
  };
  const htmlWithStyleBlocks = html.replace(
    STYLE_BLOCK_PATTERN,
    (match, rawAttributes: string, css: string) => {
      const rewrittenCss = rewritePreviewCssResourceUrls(css, rewriteInput);
      return rewrittenCss === css ? match : `<style${rawAttributes}>${rewrittenCss}</style>`;
    }
  );

  return htmlWithStyleBlocks.replace(
    PREVIEW_TAG_PATTERN,
    (match, rawTagName: string, rawAttributes: string) => {
      const canRewriteResourceAttrs = PREVIEW_RESOURCE_TAGS.has(rawTagName.toLowerCase());
      let changed = false;
      const nextAttributes = rawAttributes.replace(
        PREVIEW_ATTR_PATTERN,
        (
          attrMatch,
          leadingWhitespace: string,
          rawAttrName: string,
          doubleQuotedValue: string | undefined,
          singleQuotedValue: string | undefined,
          bareValue: string | undefined
        ) => {
          const attrName = rawAttrName.toLowerCase();
          const originalValue = doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? "";
          let rewrittenValue = originalValue;

          if (attrName === "style") {
            rewrittenValue = rewritePreviewCssResourceUrls(originalValue, rewriteInput);
          } else if (canRewriteResourceAttrs && attrName === "srcset") {
            rewrittenValue = rewritePreviewSrcset(originalValue, rewriteInput);
          } else if (canRewriteResourceAttrs && PREVIEW_RESOURCE_ATTRS.has(attrName)) {
            rewrittenValue = rewritePreviewResourceUrl(originalValue, rewriteInput);
          }

          if (rewrittenValue === originalValue) {
            return attrMatch;
          }

          changed = true;

          if (doubleQuotedValue !== undefined) {
            return `${leadingWhitespace}${rawAttrName}="${escapeHtmlAttribute(rewrittenValue, '"')}"`;
          }

          if (singleQuotedValue !== undefined) {
            return `${leadingWhitespace}${rawAttrName}='${escapeHtmlAttribute(rewrittenValue, "'")}'`;
          }

          return `${leadingWhitespace}${rawAttrName}=${rewrittenValue}`;
        }
      );

      return changed ? `<${rawTagName}${nextAttributes}>` : match;
    }
  );
}

export function rewritePreviewCssResourceUrls(css: string, input: PreviewRewriteInput): string {
  return css.replace(
    CSS_URL_PATTERN,
    (
      match,
      doubleQuotedValue: string | undefined,
      singleQuotedValue: string | undefined,
      bareValue: string | undefined
    ) => {
      const originalValue = doubleQuotedValue ?? singleQuotedValue ?? bareValue ?? "";
      const rewrittenValue = rewritePreviewResourceUrl(originalValue.trim(), input);

      if (rewrittenValue === originalValue.trim()) {
        return match;
      }

      if (doubleQuotedValue !== undefined) {
        return `url("${escapeCssQuotedUrl(rewrittenValue, '"')}")`;
      }

      if (singleQuotedValue !== undefined) {
        return `url('${escapeCssQuotedUrl(rewrittenValue, "'")}')`;
      }

      return `url(${rewrittenValue})`;
    }
  );
}

function rewritePreviewSrcset(srcset: string, input: PreviewRewriteInput): string {
  return splitSrcsetCandidates(srcset)
    .map((candidate) => rewritePreviewSrcsetCandidate(candidate, input))
    .join(",");
}

function rewritePreviewSrcsetCandidate(candidate: string, input: PreviewRewriteInput): string {
  const leadingWhitespace = candidate.match(/^\s*/)?.[0] ?? "";
  const trimmedCandidate = candidate.trim();

  if (!trimmedCandidate) {
    return candidate;
  }

  const urlMatch = /^(\S+)(.*)$/.exec(trimmedCandidate);
  if (!urlMatch) {
    return candidate;
  }

  const rawUrl = urlMatch[1];
  const descriptor = urlMatch[2] ?? "";
  if (!rawUrl) {
    return candidate;
  }

  return `${leadingWhitespace}${rewritePreviewResourceUrl(rawUrl, input)}${descriptor}`;
}

function splitSrcsetCandidates(srcset: string): string[] {
  const candidates: string[] = [];
  let startIndex = 0;
  let urlStarted = false;
  let seenWhitespaceAfterUrl = false;
  let isDataCandidate = false;

  for (let index = 0; index < srcset.length; index += 1) {
    const current = srcset[index] ?? "";

    if (!urlStarted) {
      if (/\s/.test(current)) {
        continue;
      }

      urlStarted = true;
      isDataCandidate = srcset.slice(index, index + 5).toLowerCase() === "data:";
    } else if (/\s/.test(current)) {
      seenWhitespaceAfterUrl = true;
    }

    if (current !== ",") {
      continue;
    }

    if (isDataCandidate && !seenWhitespaceAfterUrl) {
      continue;
    }

    candidates.push(srcset.slice(startIndex, index));
    startIndex = index + 1;
    urlStarted = false;
    seenWhitespaceAfterUrl = false;
    isDataCandidate = false;
  }

  candidates.push(srcset.slice(startIndex));
  return candidates;
}

function rewritePreviewResourceUrl(rawValue: string, input: PreviewRewriteInput): string {
  const { pathPart, suffix } = splitUrlSuffix(rawValue);
  const trimmedValue = pathPart.trim();

  if (!trimmedValue || trimmedValue.startsWith("//")) {
    return rawValue;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmedValue)) {
    if (!trimmedValue.toLowerCase().startsWith("file:")) {
      return rawValue;
    }

    try {
      const absolutePath = fileURLToPath(trimmedValue);
      const workspaceRelativePath = resolveWorkspaceRelativePath(
        input.workspaceRootPath,
        absolutePath
      );

      if (!workspaceRelativePath) {
        return rawValue;
      }

      return `${createPreviewAssetUrl(input.sessionId, workspaceRelativePath)}${suffix}`;
    } catch {
      return rawValue;
    }
  }

  const decodedPath = decodePathSegments(trimmedValue.replaceAll("\\", "/"));

  if (decodedPath.startsWith("/")) {
    const workspaceRelativePath =
      resolveWorkspaceRelativePath(input.workspaceRootPath, decodedPath) ??
      normalizeWorkspaceRelativePath(decodedPath.slice(1));

    if (!workspaceRelativePath) {
      return rawValue;
    }

    return `${createPreviewAssetUrl(input.sessionId, workspaceRelativePath)}${suffix}`;
  }

  if (path.win32.isAbsolute(decodedPath)) {
    const workspaceRelativePath = resolveWorkspaceRelativePath(
      input.workspaceRootPath,
      decodedPath
    );
    if (!workspaceRelativePath) {
      return rawValue;
    }

    return `${createPreviewAssetUrl(input.sessionId, workspaceRelativePath)}${suffix}`;
  }

  if (input.baseWorkspacePath) {
    const workspaceRelativePath = resolveRelativeWorkspacePath(
      input.baseWorkspacePath,
      decodedPath
    );

    if (workspaceRelativePath) {
      return `${createPreviewAssetUrl(input.sessionId, workspaceRelativePath)}${suffix}`;
    }
  }

  return rawValue;
}

function resolveRelativeWorkspacePath(
  baseWorkspacePath: string,
  relativePath: string
): string | null {
  return normalizeWorkspaceRelativePath(
    path.posix.join(path.posix.dirname(baseWorkspacePath.replaceAll("\\", "/")), relativePath)
  );
}

function createPreviewAssetUrl(sessionId: string, workspaceRelativePath: string): string {
  return `/api/preview/session/${sessionId}/${encodePathSegments(workspaceRelativePath)}`;
}

function normalizeWorkspaceRelativePath(rawPath: string): string | null {
  const normalized = path.posix.normalize(rawPath.replaceAll("\\", "/").replace(/^\/+/, ""));

  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function resolveWorkspaceRelativePath(
  workspaceRootPath: string,
  absolutePath: string
): string | null {
  const absoluteWorkspaceRoot = path.resolve(workspaceRootPath);
  const absoluteTargetPath = path.resolve(absolutePath);

  if (!isPathInsideRoot(absoluteWorkspaceRoot, absoluteTargetPath)) {
    return null;
  }

  const workspaceRelativePath = absoluteTargetPath
    .slice(absoluteWorkspaceRoot.length)
    .replace(/^[/\\]/, "")
    .replaceAll("\\", "/");

  return normalizeWorkspaceRelativePath(workspaceRelativePath);
}

function splitUrlSuffix(value: string): { pathPart: string; suffix: string } {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");

  let suffixIndex = value.length;
  if (queryIndex !== -1 && hashIndex !== -1) {
    suffixIndex = Math.min(queryIndex, hashIndex);
  } else if (queryIndex !== -1) {
    suffixIndex = queryIndex;
  } else if (hashIndex !== -1) {
    suffixIndex = hashIndex;
  }

  return {
    pathPart: value.slice(0, suffixIndex),
    suffix: value.slice(suffixIndex),
  };
}

function decodePathSegments(inputPath: string): string {
  return inputPath
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function escapeHtmlAttribute(value: string, quote: '"' | "'"): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(quote, quote === '"' ? "&quot;" : "&#39;");
}

function escapeCssQuotedUrl(value: string, quote: '"' | "'"): string {
  return value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
}
