import type { PendingEditorNavigation } from "../../code-editor/atoms";

interface TerminalBufferLineLike {
  isWrapped?: boolean;
  length?: number;
  getCell?(column: number): { getChars(): string; getWidth(): number } | undefined;
  translateToString(trimRight?: boolean): string;
}

interface TerminalLike {
  buffer: {
    active: {
      getLine(row: number): TerminalBufferLineLike | undefined;
    };
  };
}

interface TerminalLinkRange {
  start: {
    x: number;
    y: number;
  };
  end: {
    x: number;
    y: number;
  };
}

interface TerminalLink {
  text: string;
  range: TerminalLinkRange;
  activate(event: MouseEvent, text: string): void;
}

interface WorkspaceFileTarget {
  path: string;
  line?: number;
  column?: number;
}

interface TerminalLinkCandidate {
  text: string;
  startIndex: number;
}

interface LogicalLineTextSegment {
  row: number;
  line: TerminalBufferLineLike;
  text: string;
}

interface LogicalLineSegment {
  row: number;
  line: TerminalBufferLineLike;
  startIndex: number;
  endIndex: number;
}

interface LogicalTerminalLine {
  text: string;
  segments: LogicalLineSegment[];
}

interface TerminalWorkspaceLinkProviderOptions {
  terminal: TerminalLike;
  workspaceId: string;
  getWorkspacePath(): string | undefined;
  openWorkspaceFile(input: PendingEditorNavigation): void | Promise<void>;
}

const LINK_CANDIDATE_PATTERN =
  /https?:\/\/[^\s<>"'`]+|[a-z]:[\\/][^\s<>"'`]+|\/[^\s<>"'`]+|(?:[a-z0-9_.@+-]+\/)+[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION_PATTERN = /[),.;\]}，]+$/;
const PATH_CONTINUATION_CHARACTER_PATTERN = /[a-z0-9_./@+-]/iu;
const TRUNCATED_PATH_TRAILING_PATTERN = /[-./]$/u;
const HTTP_URL_PATTERN = /^https?:\/\//iu;

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/gu, "/");
}

function normalizeWorkspaceRoot(path: string): string {
  const normalized = normalizePathSeparators(path).replace(/\/+$/u, "");
  return normalized || "/";
}

function trimCandidateToken(token: string): string {
  return token.replace(TRAILING_PUNCTUATION_PATTERN, "");
}

function findLinkCandidates(lineText: string): TerminalLinkCandidate[] {
  const candidates: TerminalLinkCandidate[] = [];

  for (const match of lineText.matchAll(LINK_CANDIDATE_PATTERN)) {
    const rawText = match[0];
    const text = trimCandidateToken(rawText);
    if (!text) {
      continue;
    }

    candidates.push({
      text,
      startIndex: match.index ?? 0,
    });
  }

  return candidates;
}

function parsePathLocation(rawPath: string): WorkspaceFileTarget {
  const locationMatch = rawPath.match(/:(\d+)(?::(\d+))?$/u);
  if (!locationMatch) {
    return { path: rawPath };
  }

  return {
    path: rawPath.slice(0, -locationMatch[0].length),
    line: Number.parseInt(locationMatch[1]!, 10),
    column: locationMatch[2] ? Number.parseInt(locationMatch[2], 10) : undefined,
  };
}

function resolveWorkspaceFileTarget(
  token: string,
  workspacePath: string
): WorkspaceFileTarget | null {
  const trimmedToken = trimCandidateToken(token);
  if (!trimmedToken || /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmedToken)) {
    return null;
  }

  const parsed = parsePathLocation(normalizePathSeparators(trimmedToken));
  if (!parsed.path || parsed.path === "." || parsed.path === "..") {
    return null;
  }

  const workspaceRoot = normalizeWorkspaceRoot(workspacePath);
  if (parsed.path === workspaceRoot || parsed.path.startsWith(`${workspaceRoot}/`)) {
    const relativePath = parsed.path.slice(workspaceRoot.length).replace(/^\/+/u, "");
    if (!relativePath || relativePath.startsWith("../")) {
      return null;
    }

    return {
      ...parsed,
      path: relativePath,
    };
  }

  if (parsed.path.startsWith("/") || /^[a-z]:\//iu.test(parsed.path)) {
    return null;
  }

  const relativePath = parsed.path.replace(/^\.\//u, "");
  if (!relativePath || relativePath.startsWith("../") || !relativePath.includes("/")) {
    return null;
  }

  return {
    ...parsed,
    path: relativePath,
  };
}

function shouldCollapsePathBoundary(leftText: string, rightText: string): boolean {
  const leftVisibleText = leftText.replace(/\s+$/u, "");
  const rightVisibleText = rightText.replace(/^\s+/u, "");
  if (!leftVisibleText || !rightVisibleText) {
    return false;
  }

  const leftLastChar = leftVisibleText[leftVisibleText.length - 1];
  const rightFirstChar = rightVisibleText[0];
  if (!leftLastChar || !rightFirstChar) {
    return false;
  }

  return (
    PATH_CONTINUATION_CHARACTER_PATTERN.test(leftLastChar) &&
    PATH_CONTINUATION_CHARACTER_PATTERN.test(rightFirstChar) &&
    (/[-./]$/u.test(leftVisibleText) ||
      rightVisibleText.includes("/") ||
      rightVisibleText.startsWith("."))
  );
}

function buildLogicalTerminalLine(segments: LogicalLineTextSegment[]): LogicalTerminalLine {
  const normalizedSegments: LogicalLineTextSegment[] = [];

  for (const segment of segments) {
    let text = segment.text;
    const previousSegment = normalizedSegments[normalizedSegments.length - 1];
    if (previousSegment && shouldCollapsePathBoundary(previousSegment.text, text)) {
      previousSegment.text = previousSegment.text.replace(/\s+$/u, "");
      text = text.replace(/^\s+/u, "");
    }

    normalizedSegments.push({
      row: segment.row,
      line: segment.line,
      text,
    });
  }

  let text = "";
  const logicalSegments = normalizedSegments.map((segment) => {
    const startIndex = text.length;
    text += segment.text;

    return {
      row: segment.row,
      line: segment.line,
      startIndex,
      endIndex: text.length,
    };
  });

  return {
    text,
    segments: logicalSegments,
  };
}

function logicalLineToTextSegments(logicalLine: LogicalTerminalLine): LogicalLineTextSegment[] {
  return logicalLine.segments.map((segment) => ({
    row: segment.row,
    line: segment.line,
    text: logicalLine.text.slice(segment.startIndex, segment.endIndex),
  }));
}

function getLogicalTerminalLine(
  terminal: TerminalLike,
  bufferLineNumber: number
): LogicalTerminalLine | null {
  const activeBuffer = terminal.buffer.active;
  let startRow = bufferLineNumber - 1;
  let currentLine = activeBuffer.getLine(startRow);
  if (!currentLine) {
    return null;
  }

  while (currentLine.isWrapped === true) {
    startRow -= 1;
    if (startRow < 0) {
      return null;
    }

    currentLine = activeBuffer.getLine(startRow);
    if (!currentLine) {
      return null;
    }
  }

  const lines: Array<{ row: number; line: TerminalBufferLineLike }> = [
    { row: startRow, line: currentLine },
  ];
  let scanRow = startRow;

  while (true) {
    const nextLine = activeBuffer.getLine(scanRow + 1);
    if (!nextLine || nextLine.isWrapped !== true) {
      break;
    }

    scanRow += 1;
    lines.push({ row: scanRow, line: nextLine });
  }

  return buildLogicalTerminalLine(
    lines.map((segment, index) => ({
      row: segment.row,
      line: segment.line,
      text: segment.line.translateToString(index === lines.length - 1),
    }))
  );
}

function getAdjacentLogicalTerminalLine(
  terminal: TerminalLike,
  logicalLine: LogicalTerminalLine,
  direction: "previous" | "next"
): LogicalTerminalLine | null {
  const edgeSegment =
    direction === "previous"
      ? logicalLine.segments[0]
      : logicalLine.segments[logicalLine.segments.length - 1];
  if (!edgeSegment) {
    return null;
  }

  const adjacentRow = direction === "previous" ? edgeSegment.row - 1 : edgeSegment.row + 1;
  if (adjacentRow < 0) {
    return null;
  }

  return getLogicalTerminalLine(terminal, adjacentRow + 1);
}

function canJoinAdjacentLogicalLines(
  left: LogicalTerminalLine,
  right: LogicalTerminalLine
): boolean {
  return shouldCollapsePathBoundary(left.text, right.text);
}

function mergeLogicalTerminalLines(lines: LogicalTerminalLine[]): LogicalTerminalLine {
  return buildLogicalTerminalLine(lines.flatMap(logicalLineToTextSegments));
}

function getLinkCandidateContexts(
  terminal: TerminalLike,
  bufferLineNumber: number
): LogicalTerminalLine[] {
  const current = getLogicalTerminalLine(terminal, bufferLineNumber);
  if (!current) {
    return [];
  }

  const contexts = new Map<string, LogicalTerminalLine>();
  const addContext = (logicalLine: LogicalTerminalLine) => {
    const firstRow = logicalLine.segments[0]?.row ?? -1;
    const lastRow = logicalLine.segments[logicalLine.segments.length - 1]?.row ?? -1;
    contexts.set(`${firstRow}:${lastRow}:${logicalLine.text}`, logicalLine);
  };

  addContext(current);

  const previous = getAdjacentLogicalTerminalLine(terminal, current, "previous");
  const next = getAdjacentLogicalTerminalLine(terminal, current, "next");
  const canJoinPrevious = previous ? canJoinAdjacentLogicalLines(previous, current) : false;
  const canJoinNext = next ? canJoinAdjacentLogicalLines(current, next) : false;

  if (previous && canJoinPrevious) {
    addContext(mergeLogicalTerminalLines([previous, current]));
  }

  if (next && canJoinNext) {
    addContext(mergeLogicalTerminalLines([current, next]));
  }

  if (previous && next && canJoinPrevious && canJoinNext) {
    addContext(mergeLogicalTerminalLines([previous, current, next]));
  }

  return [...contexts.values()];
}

function findSegmentForStringIndex(
  segments: LogicalLineSegment[],
  index: number
): LogicalLineSegment | null {
  for (const segment of segments) {
    if (index >= segment.startIndex && index < segment.endIndex) {
      return segment;
    }
  }

  return null;
}

function getCellXForStringIndex(line: TerminalBufferLineLike, stringIndex: number): number {
  if (typeof line.getCell !== "function") {
    return stringIndex + 1;
  }

  const scanLimit =
    typeof line.length === "number" && Number.isFinite(line.length)
      ? Math.max(0, line.length)
      : Number.POSITIVE_INFINITY;
  let currentStringIndex = 0;

  for (let column = 0; column < scanLimit; column += 1) {
    const cell = line.getCell(column);
    if (!cell) {
      break;
    }

    const chars = cell.getChars();
    if (!chars) {
      continue;
    }

    const nextStringIndex = currentStringIndex + chars.length;
    if (stringIndex < nextStringIndex) {
      return column + 1;
    }

    currentStringIndex = nextStringIndex;
  }

  return stringIndex + 1;
}

function buildCandidateRange(
  logicalLine: LogicalTerminalLine,
  candidate: TerminalLinkCandidate
): TerminalLinkRange | null {
  const endIndex = candidate.startIndex + candidate.text.length - 1;
  const startSegment = findSegmentForStringIndex(logicalLine.segments, candidate.startIndex);
  const endSegment = findSegmentForStringIndex(logicalLine.segments, endIndex);
  if (!startSegment || !endSegment) {
    return null;
  }

  return {
    start: {
      x: getCellXForStringIndex(startSegment.line, candidate.startIndex - startSegment.startIndex),
      y: startSegment.row + 1,
    },
    end: {
      x: getCellXForStringIndex(endSegment.line, endIndex - endSegment.startIndex),
      y: endSegment.row + 1,
    },
  };
}

function rangeIntersectsBufferLine(range: TerminalLinkRange, bufferLineNumber: number): boolean {
  return range.start.y <= bufferLineNumber && range.end.y >= bufferLineNumber;
}

function compareBufferPosition(
  left: { x: number; y: number },
  right: { x: number; y: number }
): number {
  if (left.y !== right.y) {
    return left.y - right.y;
  }

  return left.x - right.x;
}

function rangeContainsRange(outer: TerminalLinkRange, inner: TerminalLinkRange): boolean {
  return (
    compareBufferPosition(outer.start, inner.start) <= 0 &&
    compareBufferPosition(inner.end, outer.end) <= 0
  );
}

function isProbablyTruncatedWorkspacePathCandidate(
  logicalLine: LogicalTerminalLine,
  candidate: TerminalLinkCandidate
): boolean {
  if (!TRUNCATED_PATH_TRAILING_PATTERN.test(candidate.text)) {
    return false;
  }

  const visibleLogicalTextLength = logicalLine.text.replace(/\s+$/u, "").length;
  return candidate.startIndex + candidate.text.length === visibleLogicalTextLength;
}

function buildWorkspaceFileLinks(
  logicalLines: LogicalTerminalLine[],
  bufferLineNumber: number,
  workspacePath: string | undefined,
  openWorkspaceFile: TerminalWorkspaceLinkProviderOptions["openWorkspaceFile"],
  workspaceId: string
): TerminalLink[] {
  const links = logicalLines.flatMap((logicalLine) =>
    findLinkCandidates(logicalLine.text).map((candidate) => {
      const range = buildCandidateRange(logicalLine, candidate);
      if (!range || !rangeIntersectsBufferLine(range, bufferLineNumber)) {
        return null;
      }

      const text = candidate.text;

      if (HTTP_URL_PATTERN.test(text)) {
        return {
          text,
          range,
          activate: () => {
            window.open(text, "_blank", "noopener,noreferrer");
          },
        } satisfies TerminalLink;
      }

      if (!workspacePath) {
        return null;
      }

      const target = resolveWorkspaceFileTarget(text, workspacePath);
      if (!target || isProbablyTruncatedWorkspacePathCandidate(logicalLine, candidate)) {
        return null;
      }

      return {
        text,
        range,
        activate: () => {
          void openWorkspaceFile({
            workspaceId,
            path: target.path,
            line: target.line,
            column: target.column,
            source: "manual",
          });
        },
      } satisfies TerminalLink;
    })
  );

  const resolvedLinks = links.filter((link): link is TerminalLink => link !== null);

  const accepted: TerminalLink[] = [];
  for (const link of [...resolvedLinks].sort(
    (left, right) => right.text.length - left.text.length
  )) {
    const duplicate = accepted.some(
      (existing) =>
        existing.text === link.text &&
        compareBufferPosition(existing.range.start, link.range.start) === 0 &&
        compareBufferPosition(existing.range.end, link.range.end) === 0
    );
    if (duplicate) {
      continue;
    }

    if (accepted.some((existing) => rangeContainsRange(existing.range, link.range))) {
      continue;
    }

    accepted.push(link);
  }

  return accepted.sort(
    (left, right) =>
      compareBufferPosition(left.range.start, right.range.start) ||
      compareBufferPosition(left.range.end, right.range.end)
  );
}

export function createTerminalWorkspaceLinkProvider(options: TerminalWorkspaceLinkProviderOptions) {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: TerminalLink[] | undefined) => void) {
      const workspacePath = options.getWorkspacePath();
      const logicalLines = getLinkCandidateContexts(options.terminal, bufferLineNumber);
      if (logicalLines.length === 0) {
        callback(undefined);
        return;
      }

      const links = buildWorkspaceFileLinks(
        logicalLines,
        bufferLineNumber,
        workspacePath,
        options.openWorkspaceFile,
        options.workspaceId
      );
      callback(links.length > 0 ? links : undefined);
    },
  };
}
