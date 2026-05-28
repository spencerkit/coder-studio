import type {
  SearchSessionApplyResult,
  SearchSessionFilePreview,
  SearchSessionFileResult,
  SearchSessionMatchPreview,
  SearchSessionStartResult,
} from "@coder-studio/core";
import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import ignore from "ignore";
import { basename, join, relative } from "path";
import { resolveSafe, writeFile } from "./file-io.js";

const MAX_FILE_BYTES = 1_000_000;
const SESSION_TTL_MS = 5 * 60 * 1000;
const STANDARD_IGNORE_SOURCE_PATHS = [
  ".gitignore",
  ".ignore",
  ".rgignore",
  ".git/info/exclude",
] as const;

export interface CreateSearchSessionOptions {
  query: string;
  replace: string;
  isRegex: boolean;
  matchCase: boolean;
  matchWholeWord: boolean;
  preserveCase: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  useIgnoreFiles: boolean;
  useExcludeSettings: boolean;
  onlyOpenEditors: boolean;
  openEditorPaths: string[];
  maxFiles: number;
  maxMatchesPerFile: number;
}

interface SearchSessionDescriptor extends CreateSearchSessionOptions {
  rootPath: string;
}

interface SearchSessionRecord {
  id: string;
  descriptor: SearchSessionDescriptor;
  createdAt: number;
  files: Map<string, SearchSessionFileState>;
  result: SearchSessionStartResult;
}

interface SearchSessionFileState {
  path: string;
  name: string;
  baseHash: string;
  originalContent: string;
  modifiedContent: string;
  matches: MatchCandidate[];
}

interface MatchCandidate {
  id: string;
  startOffset: number;
  endOffset: number;
  line: number;
  column: number;
  endColumn: number;
  preview: string;
  previewColumnStart: number;
  previewColumnEnd: number;
  replacementPreview: string;
  replacementPreviewColumnStart: number;
  replacementPreviewColumnEnd: number;
  isReplacementPreviewTruncated: boolean;
  replacementText: string;
}

interface SearchIgnoreMatcher {
  rules: ReturnType<typeof ignore> | null;
}

const searchSessions = new Map<string, SearchSessionRecord>();

export async function createSearchSession(
  rootPath: string,
  options: CreateSearchSessionOptions
): Promise<{ sessionId: string; result: SearchSessionStartResult }> {
  const query = options.query.trim();
  if (!query) {
    const sessionId = randomUUID();
    const result: SearchSessionStartResult = {
      sessionId,
      files: [],
      totalMatchCount: 0,
      totalFileCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
      skippedBinaryFileCount: 0,
      skippedLargeFileCount: 0,
    };
    return { sessionId, result };
  }

  const descriptor: SearchSessionDescriptor = {
    ...options,
    rootPath,
  };
  const matcher = buildMatcher(descriptor);
  const files = new Map<string, SearchSessionFileState>();
  const openEditorPathSet = new Set(options.openEditorPaths.map(normalizeRelativePath));
  const counters = {
    totalMatchCount: 0,
    totalFileCount: 0,
    skippedBinaryFileCount: 0,
    skippedLargeFileCount: 0,
  };

  // The current UI exposes one compact toggle for standard ignore/exclude sources,
  // so the backend treats these two flags as a single gate until settings-backed
  // exclude sources are added separately.
  const useStandardIgnoreRules = descriptor.useIgnoreFiles || descriptor.useExcludeSettings;

  await walkWorkspace(
    rootPath,
    async (relativePath, absolutePath) => {
      if (descriptor.onlyOpenEditors && !openEditorPathSet.has(relativePath)) {
        return;
      }

      if (!matchesPathFilters(relativePath, descriptor.includeGlobs, descriptor.excludeGlobs)) {
        return;
      }

      const fileStat = await stat(absolutePath);
      if (fileStat.size > MAX_FILE_BYTES) {
        counters.skippedLargeFileCount += 1;
        return;
      }

      const buffer = await readFile(absolutePath);
      if (isBinaryFile(buffer)) {
        counters.skippedBinaryFileCount += 1;
        return;
      }

      const content = buffer.toString("utf8");
      const baseHash = hashContent(content);
      const matches = collectMatches(content, matcher, descriptor.replace, descriptor.preserveCase);
      if (matches.length === 0) {
        return;
      }

      const modifiedContent = applyMatchesToContent(content, matches);
      counters.totalMatchCount += matches.length;
      counters.totalFileCount += 1;
      files.set(relativePath, {
        path: relativePath,
        name: basename(relativePath),
        baseHash,
        originalContent: content,
        modifiedContent,
        matches,
      });
    },
    useStandardIgnoreRules
  );

  const visibleFiles = Array.from(files.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, descriptor.maxFiles)
    .map<SearchSessionFileResult>((file) => ({
      path: file.path,
      name: file.name,
      matchCount: file.matches.length,
      hasMoreMatches: file.matches.length > descriptor.maxMatchesPerFile,
      baseHash: file.baseHash,
      matches: file.matches
        .slice(0, descriptor.maxMatchesPerFile)
        .map<SearchSessionMatchPreview>(toMatchPreview),
    }));

  const sessionId = randomUUID();
  const result: SearchSessionStartResult = {
    sessionId,
    files: visibleFiles,
    totalMatchCount: counters.totalMatchCount,
    totalFileCount: counters.totalFileCount,
    hasMoreFiles: files.size > descriptor.maxFiles,
    truncatedMatchFileCount: visibleFiles.filter((file) => file.hasMoreMatches).length,
    skippedBinaryFileCount: counters.skippedBinaryFileCount,
    skippedLargeFileCount: counters.skippedLargeFileCount,
  };

  searchSessions.set(sessionId, {
    id: sessionId,
    descriptor,
    createdAt: Date.now(),
    files,
    result,
  });

  return { sessionId, result };
}

export async function previewSearchSessionFile(
  rootPath: string,
  sessionId: string,
  path: string
): Promise<SearchSessionFilePreview | null> {
  const session = getSearchSession(sessionId);
  if (!session || session.descriptor.rootPath !== rootPath) {
    return null;
  }

  const file = session.files.get(normalizeRelativePath(path));
  if (!file) {
    return null;
  }

  return {
    kind: "search-replace-file-diff",
    path: file.path,
    title: file.path,
    sessionId,
    baseHash: file.baseHash,
    originalContent: file.originalContent,
    modifiedContent: file.modifiedContent,
  };
}

export async function applySearchSession(
  rootPath: string,
  sessionId: string,
  scope:
    | { kind: "all" }
    | { kind: "file"; path: string }
    | { kind: "match"; path: string; matchId: string }
): Promise<SearchSessionApplyResult> {
  const session = getSearchSession(sessionId);
  if (!session || session.descriptor.rootPath !== rootPath) {
    return staleApplyResult(sessionId);
  }

  const selectedFiles =
    scope.kind === "all"
      ? Array.from(session.files.values())
      : scope.kind === "file"
        ? [session.files.get(normalizeRelativePath(scope.path))].filter(isDefined)
        : [session.files.get(normalizeRelativePath(scope.path))].filter(isDefined);

  const results: SearchSessionApplyResult["results"] = [];

  for (const file of selectedFiles) {
    const targetMatches =
      scope.kind === "match"
        ? file.matches.filter((match) => match.id === scope.matchId)
        : file.matches;

    if (targetMatches.length === 0) {
      results.push({
        path: file.path,
        status: "not_found",
        replacedMatchCount: 0,
      });
      continue;
    }

    const currentContent = await readFile(resolveSafe(rootPath, file.path), "utf8").catch(
      () => null
    );
    if (currentContent === null) {
      results.push({
        path: file.path,
        status: "not_found",
        replacedMatchCount: 0,
      });
      continue;
    }

    if (hashContent(currentContent) !== file.baseHash) {
      results.push({
        path: file.path,
        status: "conflict",
        replacedMatchCount: 0,
      });
      continue;
    }

    const nextContent =
      scope.kind === "all" || scope.kind === "file"
        ? file.modifiedContent
        : applyMatchesToContent(file.originalContent, targetMatches);

    await writeFile(rootPath, file.path, nextContent, file.baseHash);
    results.push({
      path: file.path,
      status: "applied",
      replacedMatchCount: targetMatches.length,
    });
  }

  const appliedFileCount = results.filter((item) => item.status === "applied").length;
  const conflictFileCount = results.filter((item) => item.status === "conflict").length;
  const skippedFileCount = results.filter(
    (item) => item.status === "skipped" || item.status === "not_found"
  ).length;

  return {
    sessionId,
    status: conflictFileCount > 0 || skippedFileCount > 0 ? "partial" : "ok",
    appliedFileCount,
    conflictFileCount,
    skippedFileCount,
    results,
  };
}

function getSearchSession(sessionId: string): SearchSessionRecord | null {
  const session = searchSessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    searchSessions.delete(sessionId);
    return null;
  }

  return session;
}

function staleApplyResult(sessionId: string): SearchSessionApplyResult {
  return {
    sessionId,
    status: "stale_session",
    appliedFileCount: 0,
    conflictFileCount: 0,
    skippedFileCount: 0,
    results: [],
  };
}

function buildMatcher(descriptor: SearchSessionDescriptor) {
  const flags = descriptor.matchCase ? "gd" : "gdi";
  try {
    if (descriptor.isRegex) {
      const source = descriptor.matchWholeWord ? `\\b(?:${descriptor.query})\\b` : descriptor.query;
      return new RegExp(source, flags);
    }

    const escaped = escapeRegExp(descriptor.query);
    const source = descriptor.matchWholeWord ? `\\b${escaped}\\b` : escaped;
    return new RegExp(source, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid search pattern";
    throw { code: "invalid_regex", message };
  }
}

function collectMatches(
  content: string,
  matcher: RegExp,
  replace: string,
  preserveCase: boolean
): MatchCandidate[] {
  const matches: MatchCandidate[] = [];
  const globalMatcher = new RegExp(
    matcher.source,
    matcher.flags.includes("g") ? matcher.flags : `${matcher.flags}g`
  );
  for (const match of content.matchAll(globalMatcher)) {
    const matchedText = match[0] ?? "";
    const index = match.index ?? 0;
    const replacementText = applyPreserveCase(
      expandReplacement(replace, match),
      matchedText,
      preserveCase
    );
    const lineInfo = offsetToLineInfo(content, index, index + matchedText.length);
    const previewInfo = buildPreview(content, index, index + matchedText.length, replacementText);
    matches.push({
      id: `${lineInfo.line}:${lineInfo.column}:${lineInfo.endColumn}:${matches.length}`,
      startOffset: index,
      endOffset: index + matchedText.length,
      line: lineInfo.line,
      column: lineInfo.column,
      endColumn: lineInfo.endColumn,
      preview: previewInfo.preview,
      previewColumnStart: previewInfo.previewColumnStart,
      previewColumnEnd: previewInfo.previewColumnEnd,
      replacementPreview: previewInfo.replacementPreview,
      replacementPreviewColumnStart: previewInfo.replacementPreviewColumnStart,
      replacementPreviewColumnEnd: previewInfo.replacementPreviewColumnEnd,
      isReplacementPreviewTruncated: false,
      replacementText,
    });
    if (matchedText.length === 0) {
      globalMatcher.lastIndex += 1;
    }
  }
  return matches;
}

function buildPreview(
  content: string,
  startOffset: number,
  endOffset: number,
  replacementText: string
) {
  const lineStart = content.lastIndexOf("\n", startOffset - 1) + 1;
  const lineEndIndex = content.indexOf("\n", endOffset);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const preview = content.slice(lineStart, lineEnd);
  const previewColumnStart = startOffset - lineStart + 1;
  const previewColumnEnd = endOffset - lineStart + 1;
  const replacementPreview =
    preview.slice(0, previewColumnStart - 1) +
    replacementText +
    preview.slice(previewColumnEnd - 1);
  return {
    preview,
    previewColumnStart,
    previewColumnEnd,
    replacementPreview,
    replacementPreviewColumnStart: previewColumnStart,
    replacementPreviewColumnEnd: previewColumnStart + replacementText.length,
  };
}

function offsetToLineInfo(content: string, startOffset: number, endOffset: number) {
  const prefix = content.slice(0, startOffset);
  const lines = prefix.split("\n");
  const line = lines.length;
  const column = (lines.at(-1)?.length ?? 0) + 1;
  const endColumn = column + (endOffset - startOffset);
  return { line, column, endColumn };
}

function applyMatchesToContent(content: string, matches: MatchCandidate[]) {
  let cursor = 0;
  let next = "";
  const ordered = [...matches].sort((a, b) => a.startOffset - b.startOffset);
  for (const match of ordered) {
    next += content.slice(cursor, match.startOffset);
    next += match.replacementText;
    cursor = match.endOffset;
  }
  next += content.slice(cursor);
  return next;
}

function expandReplacement(replace: string, match: RegExpMatchArray) {
  return replace.replace(/\$(\$|&|`|'|\d{1,2})/g, (token, group) => {
    if (group === "$") {
      return "$";
    }
    if (group === "&") {
      return match[0] ?? "";
    }
    if (group === "`") {
      return "";
    }
    if (group === "'") {
      return "";
    }
    const index = Number(group);
    return Number.isNaN(index) ? token : (match[index] ?? "");
  });
}

function applyPreserveCase(replacement: string, matchedText: string, preserveCase: boolean) {
  if (!preserveCase || !replacement) {
    return replacement;
  }

  if (matchedText === matchedText.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (matchedText === matchedText.toLowerCase()) {
    return replacement.toLowerCase();
  }

  if (
    matchedText[0] === matchedText[0]?.toUpperCase() &&
    matchedText.slice(1) === matchedText.slice(1).toLowerCase()
  ) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
  }

  return replacement;
}

function toMatchPreview(match: MatchCandidate): SearchSessionMatchPreview {
  return {
    id: match.id,
    line: match.line,
    column: match.column,
    endColumn: match.endColumn,
    preview: match.preview,
    previewColumnStart: match.previewColumnStart,
    previewColumnEnd: match.previewColumnEnd,
    replacementPreview: match.replacementPreview,
    replacementPreviewColumnStart: match.replacementPreviewColumnStart,
    replacementPreviewColumnEnd: match.replacementPreviewColumnEnd,
    isReplacementPreviewTruncated: match.isReplacementPreviewTruncated,
  };
}

async function walkWorkspace(
  rootPath: string,
  onFile: (relativePath: string, absolutePath: string) => Promise<void>,
  useIgnoreFiles: boolean
) {
  const matcher = createSearchIgnoreMatcher(rootPath);

  async function visit(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const absolutePath = join(dirPath, entry.name);
      const relativePath = normalizeRelativePath(relative(rootPath, absolutePath));

      if (useIgnoreFiles && isSearchPathIgnored(matcher, relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      await onFile(relativePath, absolutePath);
    }
  }

  await visit(rootPath);
}

function createSearchIgnoreMatcher(rootPath: string): SearchIgnoreMatcher {
  const rules = ignore();
  let hasRules = false;

  for (const relativePath of STANDARD_IGNORE_SOURCE_PATHS) {
    const absolutePath = join(rootPath, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const content = readFileSync(absolutePath, "utf8");
    if (!content.trim()) {
      continue;
    }

    rules.add(content);
    hasRules = true;
  }

  return {
    rules: hasRules ? rules : null,
  };
}

function isSearchPathIgnored(matcher: SearchIgnoreMatcher, relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (
    !matcher.rules ||
    !normalizedPath ||
    normalizedPath.startsWith("..") ||
    normalizedPath === ".git" ||
    normalizedPath.startsWith(".git/")
  ) {
    return false;
  }

  return matcher.rules.ignores(normalizedPath) || matcher.rules.ignores(`${normalizedPath}/`);
}

function matchesPathFilters(path: string, includeGlobs: string[], excludeGlobs: string[]) {
  const included =
    includeGlobs.length === 0 || includeGlobs.some((pattern) => globMatches(path, pattern));
  if (!included) {
    return false;
  }
  return !excludeGlobs.some((pattern) => globMatches(path, pattern));
}

function globMatches(path: string, pattern: string) {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  const regexp = globToRegExp(normalizedPattern);
  return regexp.test(path);
}

function globToRegExp(pattern: string) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const nextNext = pattern[index + 2];

    if (char === "*" && next === "*" && nextNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += ".";
      continue;
    }

    source += escapeRegExp(char);
  }

  source += "$";
  return new RegExp(source);
}

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, "/");
}

function isBinaryFile(buffer: Buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
