import type { PendingEditorNavigation } from "../../code-editor/atoms";

interface TerminalBufferLineLike {
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

interface TerminalWorkspaceLinkProviderOptions {
  terminal: TerminalLike;
  workspaceId: string;
  getWorkspacePath(): string | undefined;
  openWorkspaceFile(input: PendingEditorNavigation): void | Promise<void>;
}

const TOKEN_PATTERN = /(?:^|[\s([{"'`])([^\s<>"'`]+)/g;
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

function buildWorkspaceFileLinks(
  lineText: string,
  bufferLineNumber: number,
  workspacePath: string | undefined,
  openWorkspaceFile: TerminalWorkspaceLinkProviderOptions["openWorkspaceFile"],
  workspaceId: string
): TerminalLink[] {
  const links: TerminalLink[] = [];

  for (const match of lineText.matchAll(TOKEN_PATTERN)) {
    const rawToken = match[1];
    if (!rawToken) {
      continue;
    }

    const tokenStartIndex = (match.index ?? 0) + match[0].length - rawToken.length;
    const text = trimCandidateToken(rawToken);

    if (HTTP_URL_PATTERN.test(text)) {
      links.push({
        text,
        range: {
          start: {
            x: tokenStartIndex + 1,
            y: bufferLineNumber,
          },
          end: {
            x: tokenStartIndex + text.length,
            y: bufferLineNumber,
          },
        },
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
        range: {
          start: {
            x: tokenStartIndex + 1,
            y: bufferLineNumber,
          },
          end: {
            x: tokenStartIndex + text.length,
            y: bufferLineNumber,
          },
        },
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
      const line = options.terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const links = buildWorkspaceFileLinks(
        line.translateToString(true),
        bufferLineNumber,
        workspacePath,
        options.openWorkspaceFile,
        options.workspaceId
      );
      callback(links.length > 0 ? links : undefined);
    },
  };
}
