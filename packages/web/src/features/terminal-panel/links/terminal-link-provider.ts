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
const TRAILING_PUNCTUATION_PATTERN = /[),.;\]}]+$/;
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

  let text = "";
  const segments = lines.map((segment, index) => {
    const segmentText = segment.line.translateToString(index === lines.length - 1);
    const startIndex = text.length;
    text += segmentText;

    return {
      row: segment.row,
      line: segment.line,
      startIndex,
      endIndex: text.length,
    };
  });

  return { text, segments };
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

function buildWorkspaceFileLinks(
  logicalLine: LogicalTerminalLine,
  bufferLineNumber: number,
  workspacePath: string | undefined,
  openWorkspaceFile: TerminalWorkspaceLinkProviderOptions["openWorkspaceFile"],
  workspaceId: string
): TerminalLink[] {
  const links: TerminalLink[] = [];

  for (const candidate of findLinkCandidates(logicalLine.text)) {
    const range = buildCandidateRange(logicalLine, candidate);
    if (!range || !rangeIntersectsBufferLine(range, bufferLineNumber)) {
      continue;
    }

    const text = candidate.text;

    if (HTTP_URL_PATTERN.test(text)) {
      links.push({
        text,
        range,
        activate: () => {
          window.open(text, "_blank", "noopener,noreferrer");
        },
      });
      continue;
    }

    if (workspacePath) {
      const target = resolveWorkspaceFileTarget(text, workspacePath);
      if (!target) {
        continue;
      }

      links.push({
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
      });
    }
  }

  return links;
}

export function createTerminalWorkspaceLinkProvider(options: TerminalWorkspaceLinkProviderOptions) {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: TerminalLink[] | undefined) => void) {
      const workspacePath = options.getWorkspacePath();
      const logicalLine = getLogicalTerminalLine(options.terminal, bufferLineNumber);
      if (!logicalLine) {
        callback(undefined);
        return;
      }

      const links = buildWorkspaceFileLinks(
        logicalLine,
        bufferLineNumber,
        workspacePath,
        options.openWorkspaceFile,
        options.workspaceId
      );
      callback(links.length > 0 ? links : undefined);
    },
  };
}
