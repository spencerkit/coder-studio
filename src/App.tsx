import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRelaxState } from "@relax-state/react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ArchiveEntry,
  ExecTarget,
  FilePreview,
  GitChange,
  Session,
  SessionPaneNode,
  SessionMode,
  SessionStatus,
  Tab,
  TreeNode,
  WorkbenchState,
  WorktreeInfo,
  createEmptyPreview,
  createId,
  createPaneLeaf,
  createSession,
  createTab,
  persistWorkbenchState,
  workbenchState
} from "./state/workbench";
import {
  applyLocale,
  Locale,
  Translator,
  createTranslator,
  formatSessionReadyMessage,
  formatSessionTitle,
  formatTerminalTitle,
  getPreferredLocale,
  localizeSessionTitle,
  localizeTerminalTitle,
  localizeWorkspaceTitle,
  persistLocale
} from "./i18n";
import {
  AgentSplitHorizontalIcon,
  AgentSplitVerticalIcon,
  AgentPlusIcon,
  AgentSendIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  GitDiscardIcon,
  GitStageIcon,
  GitUnstageIcon,
  HeaderAddIcon,
  HeaderBackIcon,
  HeaderCloseIcon,
  HeaderSettingsIcon,
  RefreshIcon,
  SettingsAppearanceIcon,
  SettingsGeneralIcon,
  SearchIcon,
  MaximizeIcon,
  MinimizeIcon,
  WorkspaceBranchIcon,
  WorkspaceChangesIcon,
  WorkspaceCodeIcon,
  WorkspaceFolderIcon,
  WorkspaceTerminalIcon,
  getFileIcon
} from "./components/icons";
import { invoke, listen } from "./lib/transport";

type Toast = { id: string; text: string; sessionId: string };

type WorkspaceInfo = {
  tab_id: string;
  project_path: string;
  target: ExecTarget;
};

type GitStatus = {
  branch: string;
  changes: number;
  last_commit: string;
};

type WorkspaceTree = {
  root: TreeNode;
  changes: TreeNode[];
};

type GitChangeEntry = GitChange;
type GitChangeAction = "stage" | "unstage" | "discard";
type GitFileDiffPayload = {
  original_content: string;
  modified_content: string;
  diff: string;
};

type BackendQueueTask = {
  id: number;
  text: string;
  status: "queued" | "running" | "done";
};

type BackendSession = {
  id: number;
  status: SessionStatus;
  mode: SessionMode;
  auto_feed: boolean;
  queue: BackendQueueTask[];
  last_active_at: number;
  claude_session_id?: string | null;
};

type BackendArchiveEntry = {
  id: number;
  session_id: number;
  mode: SessionMode;
  time: string;
};

type TabSnapshot = {
  tab_id: string;
  project_path: string;
  target: ExecTarget;
  idle_policy: {
    enabled: boolean;
    idle_minutes: number;
    max_active: number;
    pressure: boolean;
  };
  sessions: BackendSession[];
  active_session_id: number;
  archive: BackendArchiveEntry[];
  terminals: { id: number; output: string }[];
};

type SessionPatch = {
  status?: SessionStatus;
  mode?: SessionMode;
  auto_feed?: boolean;
  last_active_at?: number;
  claude_session_id?: string;
};

type AgentEvent = {
  tab_id: string;
  session_id: string;
  kind: "stdout" | "stderr" | "exit" | "system";
  data: string;
};

type AgentLifecycleEvent = {
  tab_id: string;
  session_id: string;
  kind: "session_started" | "turn_waiting" | "tool_started" | "tool_finished" | "approval_required" | "turn_completed" | "session_ended";
  source_event: string;
  data: string;
};

type TerminalEvent = {
  tab_id: string;
  terminal_id: number;
  data: string;
};

type WorktreeDetail = {
  name: string;
  path: string;
  branch: string;
  status: string;
  diff: string;
  root: TreeNode;
  changes: TreeNode[];
};

type FilesystemRoot = {
  id: string;
  label: string;
  path: string;
  description: string;
};

type FilesystemEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
};

type FilesystemListResponse = {
  current_path: string;
  home_path: string;
  parent_path?: string | null;
  roots: FilesystemRoot[];
  entries: FilesystemEntry[];
  requested_path?: string | null;
  fallback_reason?: string | null;
};

type CommandAvailability = {
  command: string;
  available: boolean;
  resolved_path?: string | null;
  error?: string | null;
};

type AgentStartResult = {
  started: boolean;
};

type WorktreeModalState = {
  name: string;
  path: string;
  branch: string;
  status: string;
  diff?: string;
  tree?: TreeNode[];
  changes?: TreeNode[];
  loading?: boolean;
};

type ClaudeSlashSkillEntry = {
  id: string;
  command: string;
  description: string;
  scope: "project" | "personal";
  source_kind: "skill" | "command";
  source_path: string;
};

type ClaudeSlashMenuItem = {
  id: string;
  command: string;
  description: string;
  section: "builtin" | "bundled" | "project" | "personal";
  sourcePath?: string;
  sourceKind?: "skill" | "command";
};

type CommandPaletteAction = {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  keywords: string;
  run: () => void;
};

type AppSettings = {
  agentProvider: Tab["agent"]["provider"];
  agentCommand: string;
  idlePolicy: Tab["idlePolicy"];
};

type AppTheme = "dark";
type AppRoute = "workspace" | "settings";
type SettingsPanel = "general" | "appearance";

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";
const SETTINGS_ROUTE_HASH = "#/settings";

const defaultAppSettings = (): AppSettings => ({
  agentProvider: "claude",
  agentCommand: "claude",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true
  }
});

const cloneAppSettings = (settings: AppSettings): AppSettings => ({
  agentProvider: settings.agentProvider,
  agentCommand: settings.agentCommand,
  idlePolicy: { ...settings.idlePolicy }
});

const readStoredAppSettings = (): AppSettings => {
  const fallback = defaultAppSettings();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      agentProvider: "claude",
      agentCommand: typeof parsed.agentCommand === "string" && parsed.agentCommand.trim() ? parsed.agentCommand : fallback.agentCommand,
      idlePolicy: {
        enabled: parsed.idlePolicy?.enabled ?? fallback.idlePolicy.enabled,
        idleMinutes: Number.isFinite(parsed.idlePolicy?.idleMinutes) ? Math.max(1, Number(parsed.idlePolicy?.idleMinutes)) : fallback.idlePolicy.idleMinutes,
        maxActive: Number.isFinite(parsed.idlePolicy?.maxActive) ? Math.max(1, Number(parsed.idlePolicy?.maxActive)) : fallback.idlePolicy.maxActive,
        pressure: parsed.idlePolicy?.pressure ?? fallback.idlePolicy.pressure
      }
    };
  } catch {
    return fallback;
  }
};

const readCurrentRoute = (): AppRoute => {
  if (typeof window === "undefined") return "workspace";
  return window.location.hash === SETTINGS_ROUTE_HASH ? "settings" : "workspace";
};

const sanitizeAnsiStream = (value: string) => {
  if (!value) return value;
  return value
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
    .replace(/\x1b\[(?![0-9;:]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?!\[)/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "");
};

const stripAnsi = (value: string) => {
  if (!value) return value;
  return sanitizeAnsiStream(value).replace(/\x1b\[[0-9;:]*m/g, "");
};

const AGENT_STREAM_BUFFER_LIMIT = 1_000_000;
const TERMINAL_STREAM_BUFFER_LIMIT = 1_000_000;
const AGENT_TITLE_TRACK_LIMIT = 240;

type XtermBaseMode = "interactive" | "readonly";

type XtermBaseHandle = {
  fit: () => void;
  focus: () => void;
  size: () => { cols: number; rows: number } | null;
};

type XtermBaseProps = {
  output: string;
  outputIdentity?: string;
  themeIdentity?: string;
  theme: AppTheme;
  fontSize: number;
  mode?: XtermBaseMode;
  className?: string;
  sanitizeOutput?: (value: string) => string;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
  autoFocus?: boolean;
};

type AgentStreamTerminalProps = {
  streamId: string;
  stream: string;
  toneKey: string;
  theme: AppTheme;
  fontSize: number;
  mode?: XtermBaseMode;
  autoFocus?: boolean;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
};

type ShellTerminalProps = {
  terminalId: string;
  output: string;
  theme: AppTheme;
  fontSize: number;
  autoFocus?: boolean;
  onData?: (value: string) => void;
  onSize?: (size: { cols: number; rows: number }) => void;
};

const readTerminalTheme = (source?: Element | null) => {
  if (typeof window === "undefined") {
    return {
      background: "#0b151a",
      foreground: "#d8edf4",
      cursor: "#8fffae",
      cursorAccent: "#0d1418"
    };
  }
  const styles = window.getComputedStyle((source as Element | null) ?? document.documentElement);
  const rootStyles = window.getComputedStyle(document.documentElement);
  const readVar = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || rootStyles.getPropertyValue(name).trim() || fallback;

  return {
    background: readVar("--terminal-bg", "#0b151a"),
    foreground: readVar("--terminal-fg", "#d8edf4"),
    cursor: readVar("--terminal-cursor", "#8fffae"),
    cursorAccent: readVar("--terminal-cursor-accent", "#0d1418"),
    selectionBackground: readVar("--terminal-selection", "rgba(90, 200, 250, 0.3)"),
    selectionInactiveBackground: readVar("--terminal-selection-inactive", "rgba(90, 200, 250, 0.2)"),
    black: readVar("--ansi-black", "#5f7680"),
    red: readVar("--ansi-red", "#ff9eb0"),
    green: readVar("--ansi-green", "#8fffae"),
    yellow: readVar("--ansi-yellow", "#ffd37a"),
    blue: readVar("--ansi-blue", "#5ac8fa"),
    magenta: readVar("--ansi-magenta", "#b9a4ff"),
    cyan: readVar("--ansi-cyan", "#79f6de"),
    white: readVar("--ansi-white", "#e7f3f7"),
    brightBlack: readVar("--ansi-bright-black", "#8da6b0"),
    brightRed: readVar("--ansi-bright-red", "#ffbac6"),
    brightGreen: readVar("--ansi-bright-green", "#b8ffca"),
    brightYellow: readVar("--ansi-bright-yellow", "#ffe7a6"),
    brightBlue: readVar("--ansi-bright-blue", "#9edfff"),
    brightMagenta: readVar("--ansi-bright-magenta", "#d8caff"),
    brightCyan: readVar("--ansi-bright-cyan", "#a7fff0"),
    brightWhite: readVar("--ansi-bright-white", "#f4fbfd")
  };
};

// PTY/TUI streams are append-only, but we may trim old bytes from the head to
// bound memory. When that happens we should keep appending live delta instead
// of resetting and replaying a truncated snapshot, which corrupts TUI layout.
const resolveXtermAppendDelta = (previous: string, next: string) => {
  if (next === previous) return "";
  if (next.startsWith(previous)) {
    return next.slice(previous.length);
  }

  const probeLength = Math.min(256, next.length);
  if (probeLength === 0) return null;
  const probe = next.slice(0, probeLength);
  const overlapStart = previous.lastIndexOf(probe);
  if (overlapStart === -1) return null;

  const overlap = previous.slice(overlapStart);
  if (!next.startsWith(overlap)) return null;
  return next.slice(overlap.length);
};

const writeXtermSnapshot = (term: XTerminal, previous: string, next: string) => {
  if (next === previous) return;
  const delta = resolveXtermAppendDelta(previous, next);
  if (delta !== null) {
    if (delta) term.write(delta);
    return;
  }
  term.reset();
  if (next) term.write(next);
};

const XTERM_SCROLLBAR_WIDTH = 3;

const resolveTerminalThemeSource = (mount: HTMLElement | null) => {
  if (!mount) return null;
  return mount.closest(".agent-pane-card")
    ?? mount.closest(".terminal-card")
    ?? mount.closest(".app");
};

const XtermBase = forwardRef<XtermBaseHandle, XtermBaseProps>(({
  output,
  outputIdentity,
  themeIdentity,
  theme,
  fontSize,
  mode = "interactive",
  className = "agent-pane-xterm",
  sanitizeOutput,
  onData,
  onSize,
  autoFocus = false
}, ref) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const outputSnapshotRef = useRef("");
  const identityRef = useRef<string | undefined>(undefined);
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const emitSize = useCallback(() => {
    const term = termRef.current;
    if (!term || !onSize) return;
    const next = { cols: term.cols, rows: term.rows };
    if (sizeRef.current?.cols === next.cols && sizeRef.current?.rows === next.rows) return;
    sizeRef.current = next;
    onSize(next);
  }, [onSize]);

  const fitAndReport = useCallback(() => {
    fitRef.current?.fit();
    emitSize();
  }, [emitSize]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!termRef.current) {
      const term = new XTerminal({
        convertEol: true,
        disableStdin: mode === "readonly",
        cursorBlink: mode === "interactive",
        fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, SFMono-Regular, monospace",
        fontSize,
        overviewRuler: { width: XTERM_SCROLLBAR_WIDTH },
        theme: readTerminalTheme(resolveTerminalThemeSource(mount))
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(mount);
      termRef.current = term;
      fitRef.current = fitAddon;
      outputSnapshotRef.current = "";
      identityRef.current = undefined;
      sizeRef.current = null;
      fitAndReport();
      return;
    }
    fitAndReport();
  }, [fitAndReport, fontSize, mode]);

  useEffect(() => {
    const mount = mountRef.current;
    const term = termRef.current;
    if (!mount || !term) return;
    term.options = {
      disableStdin: mode === "readonly",
      cursorBlink: mode === "interactive",
      fontSize,
      overviewRuler: { width: XTERM_SCROLLBAR_WIDTH },
      theme: readTerminalTheme(resolveTerminalThemeSource(mount))
    };
    requestAnimationFrame(() => fitAndReport());
  }, [fitAndReport, fontSize, mode, theme, themeIdentity]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const observer = new ResizeObserver(() => {
      fitAndReport();
    });
    observer.observe(mount);
    return () => observer.disconnect();
  }, [fitAndReport]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (identityRef.current !== outputIdentity) {
      term.reset();
      outputSnapshotRef.current = "";
      identityRef.current = outputIdentity;
    }
    const normalized = sanitizeOutput ? sanitizeOutput(output) : output;
    writeXtermSnapshot(term, outputSnapshotRef.current, normalized);
    outputSnapshotRef.current = normalized;
  }, [output, outputIdentity, sanitizeOutput]);

  useEffect(() => {
    if (outputIdentity === undefined) return;
    sizeRef.current = null;
    emitSize();
  }, [emitSize, outputIdentity]);

  useEffect(() => {
    const term = termRef.current;
    if (!term || mode !== "interactive" || !onData) return;
    const disposable = term.onData(onData);
    return () => disposable.dispose();
  }, [mode, onData]);

  useEffect(() => {
    if (!autoFocus) return;
    termRef.current?.focus();
  }, [autoFocus, outputIdentity]);

  useImperativeHandle(ref, () => ({
    fit: fitAndReport,
    focus: () => {
      termRef.current?.focus();
    },
    size: () => {
      const term = termRef.current;
      if (!term) return null;
      return { cols: term.cols, rows: term.rows };
    }
  }), [fitAndReport]);

  useEffect(() => {
    return () => {
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      outputSnapshotRef.current = "";
      identityRef.current = undefined;
      sizeRef.current = null;
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={className}
      onClick={() => {
        if (mode === "interactive") {
          termRef.current?.focus();
        }
      }}
    />
  );
});

XtermBase.displayName = "XtermBase";

const AgentStreamTerminal = forwardRef<XtermBaseHandle, AgentStreamTerminalProps>(({
  streamId,
  stream,
  toneKey,
  theme,
  fontSize,
  mode = "readonly",
  autoFocus = false,
  onData,
  onSize
}, ref) => (
  <XtermBase
    ref={ref}
    outputIdentity={streamId}
    themeIdentity={toneKey}
    output={stream}
    theme={theme}
    fontSize={fontSize}
    mode={mode}
    onData={onData}
    onSize={onSize}
    autoFocus={autoFocus}
    className="agent-pane-xterm"
  />
));

AgentStreamTerminal.displayName = "AgentStreamTerminal";

const ShellTerminal = forwardRef<XtermBaseHandle, ShellTerminalProps>(({
  terminalId,
  output,
  theme,
  fontSize,
  autoFocus = false,
  onData,
  onSize
}, ref) => (
  <XtermBase
    ref={ref}
    outputIdentity={terminalId}
    output={output}
    theme={theme}
    fontSize={fontSize}
    mode="interactive"
    onData={onData}
    onSize={onSize}
    autoFocus={autoFocus}
    className="agent-pane-xterm"
  />
));

ShellTerminal.displayName = "ShellTerminal";

const safeInvoke = async <T,>(command: string, payload: Record<string, unknown>, fallback: T): Promise<T> => {
  try {
    return await invoke<T>(command, payload);
  } catch {
    return fallback;
  }
};

const resolvePath = (base: string | undefined, path: string) => {
  if (!base || path.startsWith(base) || path.startsWith("/") || path.includes(":")) {
    return path;
  }
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}`;
};

const computeDiffStats = (diff: string) => {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  const diffFiles: string[] = [];
  diff.split("\n").forEach((line) => {
    if (line.startsWith("diff --git")) {
      files += 1;
      const parts = line.split(" ");
      const file = parts[2]?.replace("a/", "") ?? "file";
      diffFiles.push(file);
      return;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      return;
    }
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  });
  return { files, additions, deletions, diffFiles };
};

const normalizeComparablePath = (value: string) => value.replace(/\\/g, "/");
const sanitizeGitRelativePath = (value: string) => normalizeComparablePath(value).replace(/^[:/\\]+/, "");

const matchesGitPreviewPath = (previewPath: string, changePath: string) => {
  const normalizedPreview = normalizeComparablePath(previewPath);
  const normalizedChange = normalizeComparablePath(changePath);
  return normalizedPreview === normalizedChange || normalizedPreview.endsWith(`/${normalizedChange}`);
};

const looksLikeWindowsPath = (value: string) => /^[a-zA-Z]:[\\/]/.test(value);

const formatExecTargetLabel = (target: ExecTarget, t: Translator) =>
  target.type === "wsl"
    ? target.distro?.trim()
      ? `WSL (${target.distro.trim()})`
      : "WSL"
    : t("nativeTarget");

const fuzzyFileScore = (query: string, target: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedTarget = target.toLowerCase();
  if (!normalizedQuery) return 0;
  if (normalizedTarget === normalizedQuery) return 1000;
  if (normalizedTarget.includes(normalizedQuery)) {
    return 700 - Math.max(0, normalizedTarget.indexOf(normalizedQuery));
  }

  let score = 0;
  let cursor = 0;
  for (const char of normalizedQuery) {
    const index = normalizedTarget.indexOf(char, cursor);
    if (index === -1) return -1;
    score += index === cursor ? 10 : Math.max(2, 8 - (index - cursor));
    cursor = index + 1;
  }
  return score;
};

const fileParentLabel = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
};

const inferEditorLanguage = (path: string) => {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
    case "scss":
      return "css";
    case "html":
    case "htm":
      return "html";
    default:
      return "plaintext";
  }
};

const flattenTree = (nodes: TreeNode[] = []): TreeNode[] => {
  const items: TreeNode[] = [];
  nodes.forEach((node) => {
    if (node.kind === "file") {
      items.push(node);
    }
    if (node.children?.length) {
      items.push(...flattenTree(node.children));
    }
  });
  return items;
};

const nowLabel = () => new Date().toLocaleTimeString().slice(0, 5);

const parseNumericId = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const createSessionFromBackend = (source: BackendSession, locale: Locale, existing?: Session): Session => ({
  id: String(source.id),
  title: existing?.title ?? formatSessionTitle(source.id, locale),
  status: source.status,
  mode: source.mode,
  autoFeed: source.auto_feed,
  isDraft: false,
  queue: source.queue.map((task) => ({
    id: String(task.id),
    text: task.text,
    status: task.status
  })),
  messages: existing?.messages ?? [
    {
      id: createId("msg"),
      role: "system",
      content: formatSessionReadyMessage(source.id, locale),
      time: nowLabel()
    }
  ],
  stream: existing?.stream ?? "",
  unread: existing?.unread ?? 0,
  lastActiveAt: source.last_active_at,
  claudeSessionId: source.claude_session_id ?? existing?.claudeSessionId
});

const isDraftSession = (session: Session | undefined | null) => Boolean(session?.isDraft);
const isHiddenDraftPlaceholder = (session: Session | undefined | null) => Boolean(
  session
  && session.isDraft
  && !session.stream.trim()
  && session.queue.length === 0
  && session.messages.every((message) => message.role === "system")
);

const sessionTitleFromInput = (value: string) => {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? value.trim();
  if (!firstLine) return "";
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 45)}...`;
};

const stripTerminalInputEscapes = (value: string) => value
  .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
  .replace(/\x1b./g, "");

const displayPathName = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return value;
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
};

const sortTreeNodes = (nodes: TreeNode[], locale: Locale): TreeNode[] => {
  const collator = new Intl.Collator(locale === "zh" ? "zh-CN" : "en", {
    numeric: true,
    sensitivity: "base"
  });

  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      return collator.compare(left.name, right.name);
    })
    .map((node) => ({
      ...node,
      children: node.children?.length ? sortTreeNodes(node.children, locale) : node.children
    }));
};

const collectPaneLeaves = (node: SessionPaneNode): Array<{ id: string; sessionId: string }> => {
  if (node.type === "leaf") {
    return [{ id: node.id, sessionId: node.sessionId }];
  }
  return [...collectPaneLeaves(node.first), ...collectPaneLeaves(node.second)];
};

const findPaneSessionId = (node: SessionPaneNode, paneId: string): string | null => {
  if (node.type === "leaf") {
    return node.id === paneId ? node.sessionId : null;
  }
  return findPaneSessionId(node.first, paneId) ?? findPaneSessionId(node.second, paneId);
};

const findPaneIdBySessionId = (node: SessionPaneNode, sessionId: string): string | null => {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? node.id : null;
  }
  return findPaneIdBySessionId(node.first, sessionId) ?? findPaneIdBySessionId(node.second, sessionId);
};

const replacePaneNode = (
  node: SessionPaneNode,
  paneId: string,
  updater: (leaf: Extract<SessionPaneNode, { type: "leaf" }>) => SessionPaneNode
): SessionPaneNode => {
  if (node.type === "leaf") {
    return node.id === paneId ? updater(node) : node;
  }
  return {
    ...node,
    first: replacePaneNode(node.first, paneId, updater),
    second: replacePaneNode(node.second, paneId, updater)
  };
};

const removePaneNode = (node: SessionPaneNode, paneId: string): SessionPaneNode | null => {
  if (node.type === "leaf") {
    return node.id === paneId ? null : node;
  }

  const nextFirst = removePaneNode(node.first, paneId);
  const nextSecond = removePaneNode(node.second, paneId);

  if (!nextFirst && !nextSecond) return null;
  if (!nextFirst) return nextSecond;
  if (!nextSecond) return nextFirst;

  return {
    ...node,
    first: nextFirst,
    second: nextSecond
  };
};

const remapPaneSession = (node: SessionPaneNode, fromSessionId: string, toSessionId: string): SessionPaneNode => {
  if (node.type === "leaf") {
    return node.sessionId === fromSessionId
      ? { ...node, sessionId: toSessionId }
      : node;
  }
  return {
    ...node,
    first: remapPaneSession(node.first, fromSessionId, toSessionId),
    second: remapPaneSession(node.second, fromSessionId, toSessionId)
  };
};

const updateSplitRatio = (node: SessionPaneNode, splitId: string, ratio: number): SessionPaneNode => {
  if (node.type === "leaf") return node;
  if (node.id === splitId) {
    return {
      ...node,
      ratio
    };
  }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio)
  };
};

const isForegroundActiveStatus = (status: SessionStatus) => status === "running" || status === "waiting";

const toBackgroundStatus = (status: SessionStatus): SessionStatus => (isForegroundActiveStatus(status) ? "background" : status);

const restoreVisibleStatus = (session: Session): SessionStatus => {
  if (session.status !== "background") return session.status;
  return "waiting";
};

const resolveVisibleStatus = (tab: Tab, session: Session, nextStatus: SessionStatus): SessionStatus => {
  if (nextStatus === "running" || nextStatus === "waiting") {
    return tab.activeSessionId === session.id ? nextStatus : "background";
  }
  return nextStatus;
};

const sessionTone = (status: SessionStatus) => {
  if (status === "running" || status === "waiting" || status === "background") return "active";
  if (status === "idle") return "idle";
  if (status === "queued") return "queued";
  return "suspended";
};

const formatRelativeSessionTime = (value: number, locale: Locale) => {
  const diffMs = value - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const rtf = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", { numeric: "auto" });

  if (absMs < hour) {
    return rtf.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return rtf.format(Math.round(diffMs / hour), "hour");
  }
  if (absMs < week) {
    return rtf.format(Math.round(diffMs / day), "day");
  }
  return rtf.format(Math.round(diffMs / week), "week");
};

const sessionCompletionRatio = (session: Session) => {
  if (!session.queue.length) return 0;
  const complete = session.queue.filter((task) => task.status === "done").length;
  return Math.round((complete / session.queue.length) * 100);
};

const AGENT_SPECIAL_KEYS = [
  { labelKey: "escKey", sequence: "\u001b", key: "Escape" },
  { labelKey: "tabKey", sequence: "\t", key: "Tab" },
  { labelKey: "enterKey", sequence: "\r", key: "Enter" },
  { labelKey: "arrowUp", sequence: "\u001b[A", key: "ArrowUp" },
  { labelKey: "arrowDown", sequence: "\u001b[B", key: "ArrowDown" },
  { labelKey: "arrowLeft", sequence: "\u001b[D", key: "ArrowLeft" },
  { labelKey: "arrowRight", sequence: "\u001b[C", key: "ArrowRight" }
] as const;

const AGENT_SPECIAL_KEY_MAP = Object.fromEntries(
  AGENT_SPECIAL_KEYS.map((item) => [item.key, item.sequence])
) as Record<string, string>;
const AGENT_START_SYSTEM_MESSAGE = "Agent started / 智能体已启动";
const AGENT_STARTUP_DISCOVERY_MS = 1200;
const AGENT_STARTUP_QUIET_MS = 240;
const AGENT_STARTUP_MAX_WAIT_MS = 5000;

const BUILTIN_SLASH_COMMANDS: Array<{ command: string; description: { en: string; zh: string } }> = [
  { command: "/help", description: { en: "Show help and available commands.", zh: "显示帮助和当前可用命令。" } },
  { command: "/compact", description: { en: "Compact the current conversation with optional focus instructions.", zh: "压缩当前会话上下文，并可附带聚焦说明。" } },
  { command: "/clear", description: { en: "Clear conversation history and free up context.", zh: "清空当前会话历史并释放上下文。" } },
  { command: "/config", description: { en: "Open Claude Code settings and preferences.", zh: "打开 Claude Code 设置与偏好。" } },
  { command: "/diff", description: { en: "Open the interactive diff viewer for current changes.", zh: "打开当前改动的交互式差异视图。" } },
  { command: "/init", description: { en: "Initialize the project with a CLAUDE.md guide.", zh: "为当前项目初始化 CLAUDE.md 指南。" } },
  { command: "/mcp", description: { en: "Manage MCP server connections and authentication.", zh: "管理 MCP 服务连接与认证。" } },
  { command: "/memory", description: { en: "Edit and manage CLAUDE.md memory files.", zh: "编辑和管理 CLAUDE.md 记忆文件。" } },
  { command: "/permissions", description: { en: "View or update Claude tool permissions.", zh: "查看或更新 Claude 的工具权限。" } },
  { command: "/plan", description: { en: "Enter plan mode directly from the prompt.", zh: "直接进入计划模式。" } },
  { command: "/resume", description: { en: "Resume a conversation by ID or name.", zh: "按 ID 或名称恢复历史会话。" } },
  { command: "/status", description: { en: "Open the status view for model, account, and connectivity.", zh: "打开状态视图，查看模型、账号和连接信息。" } }
];

const BUNDLED_CLAUDE_SKILLS: Array<{ command: string; description: { en: string; zh: string } }> = [
  { command: "/batch", description: { en: "Plan and execute large codebase changes in parallel worktrees.", zh: "并行规划并执行大规模代码库改造。" } },
  { command: "/claude-api", description: { en: "Load Claude API and SDK reference material for the current project.", zh: "加载当前项目相关的 Claude API 与 SDK 参考资料。" } },
  { command: "/debug", description: { en: "Inspect the current Claude Code session and debug issues.", zh: "检查当前 Claude Code 会话并诊断问题。" } },
  { command: "/loop", description: { en: "Repeat a prompt on an interval while the session stays open.", zh: "在会话保持打开时按固定间隔重复执行提示词。" } },
  { command: "/simplify", description: { en: "Review recent changes for quality and simplification opportunities.", zh: "检查最近改动并寻找质量与简化机会。" } }
];

const replaceLeadingSlashToken = (input: string, command: string) => {
  const trimmed = input.replace(/^\s+/, "");
  const remainder = trimmed.replace(/^\/\S+\s*/, "");
  return remainder ? `${command} ${remainder}` : `${command} `;
};

const isTextInputTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export default function App() {
  const [state, setState] = useRelaxState(workbenchState);
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const theme: AppTheme = "dark";
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readStoredAppSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() => readStoredAppSettings());
  const [route, setRoute] = useState<AppRoute>(() => readCurrentRoute());
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("general");
  const [commitMessage, setCommitMessage] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [worktreeModal, setWorktreeModal] = useState<WorktreeModalState | null>(null);
  const [worktreeView, setWorktreeView] = useState<"status" | "diff" | "tree">("status");
  const [previewMode, setPreviewMode] = useState<"preview" | "diff">("preview");
  const [codeSidebarView, setCodeSidebarView] = useState<"files" | "git">("files");
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [fileSearchActiveIndex, setFileSearchActiveIndex] = useState(0);
  const [fileSearchDropdownStyle, setFileSearchDropdownStyle] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    placement: "above" | "below";
    top?: number;
    bottom?: number;
  } | null>(null);
  const [isCodeExpanded, setIsCodeExpanded] = useState(false);
  const [overlayCanUseWsl, setOverlayCanUseWsl] = useState(false);
  const [folderBrowser, setFolderBrowser] = useState<{
    loading: boolean;
    currentPath: string;
    homePath: string;
    parentPath?: string;
    roots: FilesystemRoot[];
    entries: FilesystemEntry[];
    error?: string;
    notice?: string;
  }>({
    loading: false,
    currentPath: "",
    homePath: "",
    roots: [],
    entries: []
  });
  const [agentCommandStatus, setAgentCommandStatus] = useState<{
    loading: boolean;
    available: boolean | null;
    runtimeLabel: string;
    resolvedPath?: string;
    error?: string;
  }>({
    loading: false,
    available: null,
    runtimeLabel: ""
  });
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState(0);
  const [draftPromptInputs, setDraftPromptInputs] = useState<Record<string, string>>({});
  const [sessionSort, setSessionSort] = useState<"time" | "name">("time");
  const [repoCollapsedPaths, setRepoCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [worktreeCollapsedPaths, setWorktreeCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [selectedGitChangeKey, setSelectedGitChangeKey] = useState<string>("");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashMenuPaneId, setSlashMenuPaneId] = useState<string | null>(null);
  const [slashMenuLoading, setSlashMenuLoading] = useState(false);
  const [slashSkillItems, setSlashSkillItems] = useState<ClaudeSlashSkillEntry[]>([]);
  const stateRef = useRef(state);
  const appRef = useRef<HTMLDivElement | null>(null);
  const fileSearchShellRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const fileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);
  const draftPromptInputRefs = useRef(new Map<string, HTMLInputElement | null>());
  const shellTerminalRef = useRef<XtermBaseHandle | null>(null);
  const agentTerminalRefs = useRef(new Map<string, XtermBaseHandle | null>());
  const agentTerminalQueueRef = useRef(new Map<string, Promise<void>>());
  const agentPaneSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentRuntimeSizeRef = useRef(new Map<string, { cols: number; rows: number }>());
  const agentResizeStateRef = useRef(new Map<string, {
    inflight: boolean;
    pending?: { cols: number; rows: number };
  }>());
  const agentTitleTrackerRef = useRef(new Map<string, {
    draftSessionId?: string;
    buffer: string;
    locked: boolean;
  }>());
  const terminalSizeRef = useRef<{ id?: string; cols: number; rows: number }>({ cols: 0, rows: 0 });
  const runningAgentKeysRef = useRef(new Set<string>());
  const agentStartupStateRef = useRef(new Map<string, {
    token: number;
    startedAt: number;
    lastEventAt: number;
    sawOutput: boolean;
    sawReady: boolean;
    exited: boolean;
  }>());
  const agentStartupTokenRef = useRef(0);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const editorMetrics = useMemo(() => {
    if (typeof window === "undefined") {
      return { fontSize: 13, paddingY: 12, terminalFontSize: 12 };
    }
    const source = appRef.current ?? document.documentElement;
    const styles = window.getComputedStyle(source);
    return {
      fontSize: Number.parseInt(styles.getPropertyValue("--editor-font-size"), 10) || 13,
      paddingY: Number.parseInt(styles.getPropertyValue("--editor-padding-y"), 10) || 12,
      terminalFontSize: Number.parseInt(styles.getPropertyValue("--terminal-font-size"), 10) || 12
    };
  }, [theme]);

  const syncTerminalSize = (cols: number, rows: number, terminalId?: string) => {
    const resolvedTerminalId = terminalId ?? activeTerminal?.id;
    if (!activeTab.id || !resolvedTerminalId) return;
    const numericId = Number(resolvedTerminalId.replace("term-", ""));
    if (!Number.isFinite(numericId)) return;
    const last = terminalSizeRef.current;
    if (last.id === resolvedTerminalId && last.cols === cols && last.rows === rows) return;
    terminalSizeRef.current = { id: resolvedTerminalId, cols, rows };
    void invoke("terminal_resize", {
      tabId: activeTab.id,
      terminalId: numericId,
      cols,
      rows
    });
  };

  const updateState = (updater: (current: WorkbenchState) => WorkbenchState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  };

  const agentRuntimeKey = (tabId: string, sessionId: string) => `${tabId}:${sessionId}`;

  const fitAgentTerminals = () => {
    requestAnimationFrame(() => {
      agentTerminalRefs.current.forEach((handle) => handle?.fit());
    });
  };

  const flushAgentRuntimeSize = (tabId: string, sessionId: string) => {
    const key = agentRuntimeKey(tabId, sessionId);
    const current = agentResizeStateRef.current.get(key);
    if (!current || current.inflight || !current.pending) return;
    const nextSize = current.pending;
    current.pending = undefined;
    const last = agentRuntimeSizeRef.current.get(key);
    if (last?.cols === nextSize.cols && last?.rows === nextSize.rows) {
      if (!current.pending) return;
    }
    current.inflight = true;
    void invoke("agent_resize", {
      tabId,
      sessionId,
      cols: nextSize.cols,
      rows: nextSize.rows
    }).then(() => {
      agentRuntimeSizeRef.current.set(key, nextSize);
    }).catch(() => {
      agentRuntimeSizeRef.current.delete(key);
    }).finally(() => {
      const latest = agentResizeStateRef.current.get(key);
      if (!latest) return;
      latest.inflight = false;
      if (latest.pending) {
        flushAgentRuntimeSize(tabId, sessionId);
        return;
      }
      if (!runningAgentKeysRef.current.has(key)) {
        agentResizeStateRef.current.delete(key);
      }
    });
  };

  const syncAgentRuntimeSize = (tabId: string, sessionId: string, size: { cols: number; rows: number }) => {
    const key = agentRuntimeKey(tabId, sessionId);
    const last = agentRuntimeSizeRef.current.get(key);
    const current = agentResizeStateRef.current.get(key) ?? { inflight: false };
    if (last?.cols === size.cols && last?.rows === size.rows && !current.pending) return;
    if (current.pending?.cols === size.cols && current.pending?.rows === size.rows) return;
    current.pending = size;
    agentResizeStateRef.current.set(key, current);
    flushAgentRuntimeSize(tabId, sessionId);
  };

  const syncAgentPaneSize = (paneId: string, tabId: string, sessionId: string) => {
    const size = agentPaneSizeRef.current.get(paneId)
      ?? agentTerminalRefs.current.get(paneId)?.size();
    if (!size) return;
    syncAgentRuntimeSize(tabId, sessionId, size);
  };

  const armAgentStartupGate = (tabId: string, sessionId: string) => {
    const token = ++agentStartupTokenRef.current;
    const now = Date.now();
    agentStartupStateRef.current.set(agentRuntimeKey(tabId, sessionId), {
      token,
      startedAt: now,
      lastEventAt: now,
      sawOutput: false,
      sawReady: false,
      exited: false
    });
    return token;
  };

  const clearAgentStartupGate = (tabId: string, sessionId: string, token?: number) => {
    const key = agentRuntimeKey(tabId, sessionId);
    const current = agentStartupStateRef.current.get(key);
    if (!current) return;
    if (token !== undefined && current.token !== token) return;
    agentStartupStateRef.current.delete(key);
  };

  const setAgentTerminalRef = (paneId: string, handle: XtermBaseHandle | null) => {
    if (handle) {
      agentTerminalRefs.current.set(paneId, handle);
    } else {
      agentTerminalRefs.current.delete(paneId);
      agentTerminalQueueRef.current.delete(paneId);
      agentPaneSizeRef.current.delete(paneId);
      agentTitleTrackerRef.current.delete(paneId);
    }
  };

  const setDraftPromptInputRef = (paneId: string, element: HTMLInputElement | null) => {
    if (element) {
      draftPromptInputRefs.current.set(paneId, element);
      return;
    }
    draftPromptInputRefs.current.delete(paneId);
  };

  const focusAgentTerminal = (paneId = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId)?.activePaneId) => {
    if (!paneId) return;
    requestAnimationFrame(() => {
      const draftInput = draftPromptInputRefs.current.get(paneId);
      if (draftInput) {
        draftInput.focus();
        const length = draftInput.value.length;
        draftInput.setSelectionRange(length, length);
        return;
      }
      agentTerminalRefs.current.get(paneId)?.focus();
    });
  };

  const trackAgentInitialTitleInput = (paneId: string, session: Session, data: string) => {
    const existing = agentTitleTrackerRef.current.get(paneId);
    const tracker = existing ?? {
      draftSessionId: session.isDraft ? session.id : undefined,
      buffer: "",
      locked: false
    };
    if (session.isDraft && existing?.draftSessionId !== session.id) {
      tracker.draftSessionId = session.id;
      tracker.buffer = "";
      tracker.locked = false;
    }
    if (tracker.locked) {
      agentTitleTrackerRef.current.set(paneId, tracker);
      return null;
    }

    const normalized = stripTerminalInputEscapes(data);
    let buffer = tracker.buffer;
    let committed: string | null = null;
    for (const char of normalized) {
      if (char === "\r" || char === "\n") {
        if (!committed && buffer.trim()) {
          committed = buffer;
        }
        buffer = "";
        continue;
      }
      if (char === "\u007f" || char === "\b") {
        buffer = buffer.slice(0, -1);
        continue;
      }
      if (char === "\t") {
        buffer += " ";
        continue;
      }
      if (char < " ") continue;
      buffer += char;
      if (buffer.length > AGENT_TITLE_TRACK_LIMIT) {
        buffer = buffer.slice(-AGENT_TITLE_TRACK_LIMIT);
      }
    }

    tracker.buffer = buffer;
    agentTitleTrackerRef.current.set(paneId, tracker);
    return committed;
  };

  const commitAgentSessionTitle = (paneId: string, tabId: string, sessionId: string, rawInput: string) => {
    const title = sessionTitleFromInput(rawInput);
    if (!title) return;
    let applied = false;
    updateTab(tabId, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        const numericId = parseNumericId(session.id);
        const genericTitle = numericId === null ? null : formatSessionTitle(numericId, locale);
        const canReplace = session.isDraft
          || session.title === t("draftSessionTitle")
          || (genericTitle !== null && session.title === genericTitle);
        if (!canReplace) return session;
        applied = true;
        return { ...session, title };
      })
    }));
    if (!applied) return;
    const tracker = agentTitleTrackerRef.current.get(paneId);
    if (tracker) {
      tracker.locked = true;
      tracker.buffer = "";
      agentTitleTrackerRef.current.set(paneId, tracker);
    }
  };

  const noteAgentStartupEvent = (tabId: string, sessionId: string, kind: AgentEvent["kind"], data: string) => {
    const key = agentRuntimeKey(tabId, sessionId);
    const current = agentStartupStateRef.current.get(key);
    if (!current) return;
    if (kind === "exit") {
      current.exited = true;
      current.lastEventAt = Date.now();
      return;
    }
    const cleaned = stripAnsi(data).trim();
    const countsAsOutput = kind === "stdout"
      || kind === "stderr"
      || (kind === "system" && cleaned !== "" && cleaned !== AGENT_START_SYSTEM_MESSAGE);
    if (!countsAsOutput) return;
    current.sawOutput = true;
    current.lastEventAt = Date.now();
  };

  const noteAgentStartupLifecycle = (tabId: string, sessionId: string, kind: AgentLifecycleEvent["kind"]) => {
    const key = agentRuntimeKey(tabId, sessionId);
    const current = agentStartupStateRef.current.get(key);
    if (!current) return;
    if (kind === "session_started") {
      current.sawReady = true;
      current.lastEventAt = Date.now();
      return;
    }
    if (kind === "session_ended") {
      current.exited = true;
      current.lastEventAt = Date.now();
    }
  };

  const waitForAgentStartupDrain = async (tabId: string, sessionId: string, token: number) => {
    const key = agentRuntimeKey(tabId, sessionId);
    while (true) {
      const current = agentStartupStateRef.current.get(key);
      if (!current || current.token !== token) return;
      const now = Date.now();
      if (current.exited) {
        clearAgentStartupGate(tabId, sessionId, token);
        return;
      }
      if (current.sawReady && now - current.lastEventAt >= 120) {
        clearAgentStartupGate(tabId, sessionId, token);
        return;
      }
      if (current.sawOutput && now - current.lastEventAt >= AGENT_STARTUP_QUIET_MS) {
        clearAgentStartupGate(tabId, sessionId, token);
        return;
      }
      if (!current.sawOutput && now - current.startedAt >= AGENT_STARTUP_DISCOVERY_MS) {
        clearAgentStartupGate(tabId, sessionId, token);
        return;
      }
      if (now - current.startedAt >= AGENT_STARTUP_MAX_WAIT_MS) {
        clearAgentStartupGate(tabId, sessionId, token);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
  };

  const persistAppSettings = (next: AppSettings) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures and keep settings in memory.
    }
  };

  const navigateToRoute = (nextRoute: AppRoute) => {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      return;
    }
    const nextHash = nextRoute === "settings" ? SETTINGS_ROUTE_HASH : "";
    if (window.location.hash !== nextHash) {
      if (nextHash) {
        window.location.hash = nextHash;
      } else {
        const nextUrl = `${window.location.pathname}${window.location.search}`;
        window.history.pushState(null, "", nextUrl);
        setRoute("workspace");
      }
      return;
    }
    setRoute(nextRoute);
  };

  const openCommandPalette = () => {
    setCommandPaletteOpen(true);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  };

  const closeCommandPalette = () => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteActiveIndex(0);
  };

  const onSelectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale);
    persistLocale(nextLocale);
  };

  const syncGlobalSettings = (next: AppSettings) => {
    const normalized = cloneAppSettings(next);
    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => ({
        ...tab,
        agent: {
          ...tab.agent,
          provider: normalized.agentProvider,
          command: normalized.agentCommand
        },
        idlePolicy: { ...normalized.idlePolicy }
      }))
    }));
    stateRef.current.tabs.forEach((tab) => {
      void safeInvoke("update_idle_policy", { tabId: tab.id, policy: normalized.idlePolicy }, null);
    });
  };

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      setRoute(readCurrentRoute());
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (route === "settings") {
      setActiveSettingsPanel("general");
    }
  }, [route]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!slashMenuRef.current?.contains(event.target as Node)) {
        setSlashMenuOpen(false);
        setSlashMenuPaneId(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSlashMenuOpen(false);
        setSlashMenuPaneId(null);
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    requestAnimationFrame(() => {
      commandPaletteInputRef.current?.focus();
      commandPaletteInputRef.current?.select();
    });
  }, [commandPaletteOpen]);

  useEffect(() => {
    persistWorkbenchState(state);
  }, [state]);

  useEffect(() => {
    if (state.overlay.visible) {
      closeCommandPalette();
    }
  }, [state.overlay.visible]);

  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  useEffect(() => {
    persistAppSettings(appSettings);
  }, [appSettings]);

  useEffect(() => {
    syncGlobalSettings(appSettings);
  }, []);

  useEffect(() => {
    if (!overlayCanUseWsl && stateRef.current.overlay.target.type === "wsl") {
      updateState((current) => ({
        ...current,
        overlay: { ...current.overlay, target: { type: "native" } }
      }));
    }
  }, [overlayCanUseWsl]);

  useEffect(() => {
    const unlisten = listen<AgentEvent>("agent://event", (event) => {
      const { tab_id, session_id, kind, data } = event.payload;
      noteAgentStartupEvent(tab_id, session_id, kind, data);
      const cleaned = stripAnsi(data);
      const isStream = kind === "stdout" || kind === "stderr";
      const isSystem = kind === "system";
      const isExit = kind === "exit";
      updateState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== tab_id) return tab;
          return {
            ...tab,
            sessions: tab.sessions.map((session) => {
              if (session.id !== session_id) return session;
              const nextStatus = isStream
                ? session.status
                : isExit
                  ? "idle"
                  : session.status;
              const streamChunk = isExit
                ? "\n[agent exited]\n"
                : isSystem
                  ? (cleaned && cleaned !== AGENT_START_SYSTEM_MESSAGE ? `\n[${cleaned}]\n` : "")
                  : data;
              const nextStream = `${session.stream}${streamChunk}`.slice(-AGENT_STREAM_BUFFER_LIMIT);
              const message = isExit
                ? { id: createId("msg"), role: "system" as const, content: t("agentExited"), time: nowLabel() }
                : isSystem
                  ? { id: createId("msg"), role: "system" as const, content: cleaned, time: nowLabel() }
                  : null;
              const unread = tab.activeSessionId === session.id ? 0 : session.unread + (isSystem || isExit || isStream ? 1 : 0);
              return {
                ...session,
                status: nextStatus,
                unread,
                stream: nextStream,
                messages: message ? [...session.messages, message] : session.messages
              };
            })
          };
        })
      }));
      if (kind === "exit") {
        const runtimeKey = agentRuntimeKey(tab_id, session_id);
        runningAgentKeysRef.current.delete(runtimeKey);
        agentRuntimeSizeRef.current.delete(runtimeKey);
        agentResizeStateRef.current.delete(runtimeKey);
        clearAgentStartupGate(tab_id, session_id);
        void settleSessionAfterExit(tab_id, session_id);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<AgentLifecycleEvent>("agent://lifecycle", (event) => {
      const { tab_id, session_id, kind, data } = event.payload;
      noteAgentStartupLifecycle(tab_id, session_id, kind);
      let nextStatus: SessionStatus | null = null;
      if (kind === "turn_waiting" || kind === "approval_required") {
        nextStatus = "waiting";
      } else if (kind === "tool_started" || kind === "tool_finished") {
        nextStatus = "running";
      } else if (kind === "turn_completed" || kind === "session_ended") {
        nextStatus = "idle";
      }

      if (kind === "session_ended") {
        const runtimeKey = agentRuntimeKey(tab_id, session_id);
        runningAgentKeysRef.current.delete(runtimeKey);
        agentRuntimeSizeRef.current.delete(runtimeKey);
        agentResizeStateRef.current.delete(runtimeKey);
      }

      if (nextStatus) {
        updateState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== tab_id) return tab;
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === session_id
                  ? {
                      ...session,
                      status: resolveVisibleStatus(tab, session, nextStatus)
                    }
                  : session
              )
            };
          })
        }));
      }

      const claudeSessionId = (() => {
        try {
          const payload = JSON.parse(data) as { session_id?: string };
          return typeof payload.session_id === "string" && payload.session_id.trim()
            ? payload.session_id.trim()
            : null;
        } catch {
          return null;
        }
      })();

      if (claudeSessionId) {
        let changed = false;
        updateState((current) => ({
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== tab_id) return tab;
            return {
              ...tab,
              sessions: tab.sessions.map((session) => {
                if (session.id !== session_id || session.claudeSessionId === claudeSessionId) {
                  return session;
                }
                changed = true;
                return {
                  ...session,
                  claudeSessionId
                };
              })
            };
          })
        }));
        if (changed) {
          void syncSessionPatch(tab_id, session_id, { claude_session_id: claudeSessionId });
        }
      }

      if (kind === "turn_completed") {
        void markSessionIdle(tab_id, session_id);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    const unlisten = listen<TerminalEvent>("terminal://event", (event) => {
      const { tab_id, terminal_id, data } = event.payload;
      if (!data) return;
      const termId = `term-${terminal_id}`;
      updateState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== tab_id) return tab;
          return {
            ...tab,
            terminals: tab.terminals.map((term) => {
              if (term.id !== termId) return term;
              const nextOutput = `${term.output}${data}`.slice(-TERMINAL_STREAM_BUFFER_LIMIT);
              return { ...term, output: nextOutput };
            })
          };
        })
      }));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0],
    [state]
  );

  const activeSession = useMemo(
    () => activeTab.sessions.find((s) => s.id === activeTab.activeSessionId) ?? activeTab.sessions[0],
    [activeTab]
  );
  const commandCheckTarget = useMemo<ExecTarget>(
    () => activeTab.project?.target ?? { type: "native" },
    [
      activeTab.project?.target?.type,
      activeTab.project?.target?.type === "wsl" ? activeTab.project?.target.distro : ""
    ]
  );
  const commandCheckRuntimeLabel = useMemo(
    () => formatExecTargetLabel(commandCheckTarget, t),
    [
      commandCheckTarget.type,
      commandCheckTarget.type === "wsl" ? commandCheckTarget.distro : "",
      t
    ]
  );
  const activePaneSessionId = useMemo(
    () => findPaneSessionId(activeTab.paneLayout, activeTab.activePaneId) ?? activeTab.activeSessionId,
    [activeTab]
  );
  const activePaneSession = useMemo(
    () => activeTab.sessions.find((session) => session.id === activePaneSessionId) ?? activeSession,
    [activePaneSessionId, activeSession, activeTab.sessions]
  );
  const activeTabSessionIdsKey = useMemo(
    () => activeTab.sessions.map((session) => session.id).join("|"),
    [activeTab.sessions]
  );

  useEffect(() => {
    const command = settingsDraft.agentCommand.trim();
    if (!command) {
      setAgentCommandStatus({
        loading: false,
        available: null,
        runtimeLabel: commandCheckRuntimeLabel
      });
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setAgentCommandStatus((current) => ({
        ...current,
        loading: true,
        runtimeLabel: commandCheckRuntimeLabel,
        error: undefined
      }));
      try {
        const result = await invoke<CommandAvailability>("command_exists", {
          command,
          target: commandCheckTarget,
          cwd: activeTab.project?.path
        });
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: result.available,
          runtimeLabel: commandCheckRuntimeLabel,
          resolvedPath: result.resolved_path ?? undefined,
          error: result.error ?? undefined
        });
      } catch (error) {
        if (cancelled) return;
        setAgentCommandStatus({
          loading: false,
          available: false,
          runtimeLabel: commandCheckRuntimeLabel,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    settingsDraft.agentCommand,
    commandCheckRuntimeLabel,
    commandCheckTarget.type,
    commandCheckTarget.type === "wsl" ? commandCheckTarget.distro : "",
    activeTab.project?.path
  ]);

  const displayWorkspaceTitle = (value: string) => localizeWorkspaceTitle(value, locale);
  const displaySessionTitle = (value: string) => localizeSessionTitle(value, locale);
  const displayTerminalTitle = (value: string) => localizeTerminalTitle(value, locale);
  const hasPreviewFile = Boolean(activeTab.filePreview.path);

  const archivedEntry = activeTab.viewingArchiveId
    ? activeTab.archive.find((entry) => entry.id === activeTab.viewingArchiveId)
    : undefined;
  const sessionForView = archivedEntry ? archivedEntry.snapshot : activeSession;
  const isArchiveView = Boolean(archivedEntry);
  const viewedSession = isArchiveView ? sessionForView : activeSession;
  const viewedSessionPlainStream = stripAnsi(viewedSession.stream);

  useEffect(() => {
    updateTab(activeTab.id, (tab) => {
      const leaves = collectPaneLeaves(tab.paneLayout);
      const covered = new Set(leaves.map((leaf) => leaf.sessionId));
      const missingSessions = tab.sessions.filter((session) => !covered.has(session.id));
      if (missingSessions.length === 0) return tab;

      let nextLayout = tab.paneLayout;
      missingSessions.forEach((session) => {
        const nextLeaf = createPaneLeaf(session.id);
        nextLayout = {
          type: "split",
          id: createId("split"),
          axis: "vertical",
          ratio: 0.5,
          first: nextLayout,
          second: nextLeaf
        };
      });

      const nextActivePaneId = findPaneIdBySessionId(nextLayout, tab.activeSessionId)
        ?? collectPaneLeaves(nextLayout)[0]?.id
        ?? tab.activePaneId;

      return {
        ...tab,
        paneLayout: nextLayout,
        activePaneId: nextActivePaneId
      };
    });
  }, [activeTab.id, activeTabSessionIdsKey]);

  const addToast = (toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 4000);
  };

  const invokeAgent = async <T = void>(command: string, payload: Record<string, unknown>, sessionId: string, label: string) => {
    try {
      return await invoke<T>(command, payload);
    } catch (error) {
      addToast({
        id: createId("toast"),
        text: `${label}: ${String(error)}`,
        sessionId
      });
      return null;
    }
  };

  const loadSlashSkills = async (cwd?: string) => {
    setSlashMenuLoading(true);
    const items = await safeInvoke<ClaudeSlashSkillEntry[]>(
      "claude_slash_skills",
      { cwd: cwd ?? activeTab.project?.path ?? "" },
      []
    );
    setSlashSkillItems(items);
    setSlashMenuLoading(false);
  };

  const updateTab = (tabId: string, updater: (tab: Tab) => Tab) => {
    updateState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
    }));
  };

  const buildDraftSessionMessages = (tab: Tab) => {
    const workspacePath = tab.project?.path ?? t("noWorkspace");
    const branch = tab.git.branch && tab.git.branch !== "—" ? ` · ${tab.git.branch}` : "";
    const workspaceLabel = `${workspacePath}${branch}`;
    return [
      { id: createId("msg"), role: "system" as const, content: t("draftSessionPrompt"), time: nowLabel() },
      { id: createId("msg"), role: "system" as const, content: t("draftSessionWorkspace", { path: workspaceLabel }), time: nowLabel() }
    ];
  };

  const createDraftSessionForTab = (tab: Tab, mode: SessionMode = "branch"): Session => ({
    ...createSession(tab.sessions.length + 1, mode, locale),
    title: t("draftSessionTitle"),
    status: "idle",
    isDraft: true,
    messages: buildDraftSessionMessages(tab),
    queue: [],
    stream: "",
    unread: 0,
    lastActiveAt: Date.now()
  });

  const materializeSession = async (tabId: string, sessionId: string, firstInput: string) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === tabId);
    const currentSession = currentTab?.sessions.find((session) => session.id === sessionId);
    if (!currentTab || !currentSession) return null;
    if (!isDraftSession(currentSession)) {
      return { tab: currentTab, session: currentSession };
    }

    let nextSession: Session | null = null;
    const created = await safeInvoke<BackendSession | null>("create_session", { tabId, mode: currentSession.mode }, null);
    if (created) {
      nextSession = createSessionFromBackend(created, locale);
    }

    let tabSnapshot: Tab | null = null;
    let sessionSnapshot: Session | null = null;
    updateTab(tabId, (tab) => {
      const draftSession = tab.sessions.find((session) => session.id === sessionId);
      if (!draftSession) return tab;
      const baseSession = nextSession ?? createSession(tab.sessions.length + 1, draftSession.mode, locale);
      const title = sessionTitleFromInput(firstInput) || draftSession.title || formatSessionTitle(baseSession.id, locale);
      const preparedSession: Session = {
        ...baseSession,
        title,
        status: baseSession.status === "queued" ? "queued" : "idle",
        mode: draftSession.mode,
        autoFeed: draftSession.autoFeed,
        isDraft: false,
        queue: draftSession.queue,
        messages: draftSession.messages,
        stream: draftSession.stream,
        unread: 0,
        lastActiveAt: Date.now(),
        claudeSessionId: baseSession.claudeSessionId
      };
      const remainingSessions = tab.sessions.filter((session) => session.id !== sessionId);
      tabSnapshot = {
        ...tab,
        sessions: [preparedSession, ...remainingSessions],
        activeSessionId: preparedSession.id,
        paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
          ...leaf,
          sessionId: preparedSession.id
        })),
        viewingArchiveId: undefined
      };
      sessionSnapshot = preparedSession;
      return tabSnapshot;
    });

    if (!tabSnapshot || !sessionSnapshot) return null;
    return { tab: tabSnapshot, session: sessionSnapshot };
  };

  const refreshTabFromBackend = async (tabId: string) => {
    const snapshot = await safeInvoke<TabSnapshot | null>("tab_snapshot", { tabId }, null);
    if (!snapshot) return;
    updateTab(tabId, (tab) => {
      const nextSessions = snapshot.sessions.map((session) => {
        const existing = tab.sessions.find((item) => parseNumericId(item.id) === session.id);
        return createSessionFromBackend(session, locale, existing);
      });
      const nextActiveSessionId = String(snapshot.active_session_id);
      const validSessionIds = new Set(nextSessions.map((session) => session.id));
      const currentLeafIds = collectPaneLeaves(tab.paneLayout).map((leaf) => leaf.sessionId);
      const hasValidPaneSession = currentLeafIds.some((sessionId) => validSessionIds.has(sessionId));
      const remapPaneLayout = (node: SessionPaneNode): SessionPaneNode => {
        if (node.type === "leaf") {
          return {
            ...node,
            sessionId: validSessionIds.has(node.sessionId) ? node.sessionId : nextActiveSessionId
          };
        }
        return {
          ...node,
          first: remapPaneLayout(node.first),
          second: remapPaneLayout(node.second)
        };
      };
      const nextPaneLayout = hasValidPaneSession
        ? remapPaneLayout(tab.paneLayout)
        : createPaneLeaf(nextActiveSessionId);
      const nextLeafIds = collectPaneLeaves(nextPaneLayout);
      const nextTerminals = snapshot.terminals.map((terminal, index) => {
        const termId = `term-${terminal.id}`;
        const existing = tab.terminals.find((item) => item.id === termId);
        return {
          id: termId,
          title: existing?.title ?? formatTerminalTitle(index + 1, locale),
          output: existing?.output ?? terminal.output ?? ""
        };
      });

      return {
        ...tab,
        idlePolicy: {
          enabled: snapshot.idle_policy.enabled,
          idleMinutes: snapshot.idle_policy.idle_minutes,
          maxActive: snapshot.idle_policy.max_active,
          pressure: snapshot.idle_policy.pressure
        },
        sessions: nextSessions,
        activeSessionId: nextActiveSessionId,
        paneLayout: nextPaneLayout,
        activePaneId: nextLeafIds.some((leaf) => leaf.id === tab.activePaneId) ? tab.activePaneId : (nextLeafIds[0]?.id ?? tab.activePaneId),
        terminals: nextTerminals.length ? nextTerminals : tab.terminals,
        activeTerminalId: nextTerminals.find((terminal) => terminal.id === tab.activeTerminalId)?.id
          ?? nextTerminals[0]?.id
          ?? tab.activeTerminalId
      };
    });
  };

  const refreshWorkspaceArtifacts = async (tabId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const path = tab?.project?.path;
    const target = tab?.project?.target;
    if (!tab || !path || !target) return null;

    const [git, gitChanges, worktrees, tree] = await Promise.all([
      safeInvoke<GitStatus>("git_status", { path, target }, { branch: tab.git.branch || "main", changes: tab.git.changes ?? 0, last_commit: tab.git.lastCommit || "—" }),
      safeInvoke<GitChangeEntry[]>("git_changes", { path, target }, tab.gitChanges ?? []),
      safeInvoke<WorktreeInfo[]>("worktree_list", { path, target }, tab.worktrees),
      safeInvoke<WorkspaceTree>("workspace_tree", { path, target, depth: 4 }, {
        root: { name: ".", path, kind: "dir", children: [] },
        changes: []
      })
    ]);

    updateTab(tabId, (currentTab) => ({
      ...currentTab,
      git: {
        branch: git.branch || currentTab.git.branch || "main",
        changes: git.changes ?? currentTab.git.changes ?? 0,
        lastCommit: git.last_commit || currentTab.git.lastCommit || "—"
      },
      gitChanges,
      worktrees,
      fileTree: tree.root.children ?? [],
      changesTree: tree.changes ?? []
    }));
    return tree;
  };

  const syncSessionPatch = async (tabId: string, sessionId: string, patch: SessionPatch) => {
    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId === null) return;
    await safeInvoke("session_update", { tabId, sessionId: backendSessionId, patch }, null);
  };

  const touchSession = (tabId: string, sessionId: string) => {
    const lastActiveAt = Date.now();
    updateTab(tabId, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((session) =>
        session.id === sessionId ? { ...session, lastActiveAt } : session
      )
    }));
    void syncSessionPatch(tabId, sessionId, { last_active_at: lastActiveAt });
  };

  const onAddTab = () => {
    updateState((current) => {
      const nextIndex = current.tabs.length + 1;
      const createdTab = createTab(nextIndex, locale);
      const newTab: Tab = {
        ...createdTab,
        agent: {
          ...createdTab.agent,
          provider: appSettings.agentProvider,
          command: appSettings.agentCommand
        },
        idlePolicy: { ...appSettings.idlePolicy }
      };
      return {
        ...current,
        tabs: [...current.tabs, newTab],
        activeTabId: newTab.id,
        overlay: {
          visible: true,
          tabId: newTab.id,
          mode: "remote",
          input: "",
          target: { type: "native" }
        }
      };
    });
  };

  const onRemoveTab = (tabId: string) => {
    updateState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === tabId);
      if (index === -1) return current;

      if (current.tabs.length === 1) {
        const createdTab = createTab(1, locale);
        const replacementTab: Tab = {
          ...createdTab,
          agent: {
            ...createdTab.agent,
            provider: appSettings.agentProvider,
            command: appSettings.agentCommand
          },
          idlePolicy: { ...appSettings.idlePolicy }
        };
        return {
          ...current,
          tabs: [replacementTab],
          activeTabId: replacementTab.id,
          overlay: {
            visible: true,
            tabId: replacementTab.id,
            mode: "remote",
            input: "",
            target: { type: "native" }
          }
        };
      }

      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
      const fallbackTab = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
      const nextActiveTabId = current.activeTabId === tabId ? fallbackTab.id : current.activeTabId;
      const nextActiveTab = nextTabs.find((tab) => tab.id === nextActiveTabId) ?? fallbackTab;

      return {
        ...current,
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
        overlay: {
          ...current.overlay,
          visible: nextActiveTab.status === "init",
          tabId: nextActiveTab.id
        }
      };
    });
  };

  const onSwitchWorkspace = (tabId: string) => {
    updateState((current) => {
      const targetTab = current.tabs.find((tab) => tab.id === tabId);
      if (!targetTab) return current;
      const previousActiveTabId = current.activeTabId;
      return {
        ...current,
        activeTabId: tabId,
        overlay: {
          ...current.overlay,
          visible: targetTab.status === "init",
          tabId
        },
        tabs: current.tabs.map((tab) => {
          if (tab.id === tabId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === tab.activeSessionId
                  ? { ...session, unread: 0, status: restoreVisibleStatus(session), lastActiveAt: Date.now() }
                  : session
              )
            };
          }
          if (tab.id === previousActiveTabId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === tab.activeSessionId ? { ...session, status: toBackgroundStatus(session.status) } : session
              )
            };
          }
          return tab;
        })
      };
    });
  };

  const onCycleWorkspace = (delta: 1 | -1) => {
    const tabs = stateRef.current.tabs;
    if (tabs.length < 2) return;
    const activeIndex = tabs.findIndex((tab) => tab.id === stateRef.current.activeTabId);
    if (activeIndex < 0) return;
    const nextIndex = (activeIndex + delta + tabs.length) % tabs.length;
    onSwitchWorkspace(tabs[nextIndex].id);
  };

  const onSwitchWorkspaceSession = (tabId: string, sessionId: string) => {
    const currentState = stateRef.current;
    const targetTabSnapshot = currentState.tabs.find((tab) => tab.id === tabId);
    const previousTabSnapshot = currentState.tabs.find((tab) => tab.id === currentState.activeTabId);
    const previousSession = previousTabSnapshot?.sessions.find((session) => session.id === previousTabSnapshot.activeSessionId);
    const nextSession = targetTabSnapshot?.sessions.find((session) => session.id === sessionId);
    const nextActiveAt = Date.now();
    updateState((current) => {
      const targetTab = current.tabs.find((tab) => tab.id === tabId);
      if (!targetTab) return current;
      const previousActiveTabId = current.activeTabId;

      return {
        ...current,
        activeTabId: tabId,
        overlay: {
          ...current.overlay,
          visible: targetTab.status === "init",
          tabId
        },
        tabs: current.tabs.map((tab) => {
          if (tab.id === tabId) {
            return {
              ...tab,
              activeSessionId: sessionId,
              paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
                ...leaf,
                sessionId
              })),
              viewingArchiveId: undefined,
              sessions: tab.sessions.map((session) => {
                if (session.id === sessionId) {
                  return {
                    ...session,
                    unread: 0,
                    status: restoreVisibleStatus(session),
                    lastActiveAt: nextActiveAt
                  };
                }
                if (session.id === tab.activeSessionId) {
                  return { ...session, status: toBackgroundStatus(session.status) };
                }
                return session;
              })
            };
          }

          if (tab.id === previousActiveTabId) {
            return {
              ...tab,
              sessions: tab.sessions.map((session) =>
                session.id === tab.activeSessionId
                  ? { ...session, status: toBackgroundStatus(session.status) }
                  : session
              )
            };
          }

          return tab;
        })
      };
    });

    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId !== null) {
      void safeInvoke("switch_session", { tabId, sessionId: backendSessionId }, null);
    }

    if (previousTabSnapshot && previousSession && isForegroundActiveStatus(previousSession.status)) {
      void syncSessionPatch(previousTabSnapshot.id, previousSession.id, { status: "background" });
    }

    if (nextSession) {
      const nextStatus = restoreVisibleStatus(nextSession);
      void syncSessionPatch(tabId, sessionId, {
        status: nextStatus,
        last_active_at: nextActiveAt
      });
    }
  };

  const onOverlaySelectMode = (mode: "remote" | "local") => {
    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, mode, input: "" }
    }));
  };

  const onOverlayUpdateInput = (value: string) => {
    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, input: value }
    }));
  };

  const onOverlayUpdateTarget = (target: ExecTarget) => {
    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, target }
    }));
  };

  const browseOverlayDirectory = useCallback(async (target: ExecTarget, path?: string, selectCurrent = false) => {
    setFolderBrowser((current) => ({
      ...current,
      loading: true,
      error: undefined,
      notice: undefined
    }));

    try {
      const listing = await invoke<FilesystemListResponse>("filesystem_list", { target, path });
      const recoveredPath = Boolean(path && listing.fallback_reason);
      if (target.type === "native") {
        setOverlayCanUseWsl(listing.roots.some((root) => looksLikeWindowsPath(root.path)));
      }

      setFolderBrowser({
        loading: false,
        currentPath: listing.current_path,
        homePath: listing.home_path,
        parentPath: listing.parent_path ?? undefined,
        roots: listing.roots,
        entries: listing.entries,
        notice: recoveredPath ? t("folderBrowserRecovered") : undefined
      });

      if (selectCurrent || recoveredPath) {
        updateState((current) => ({
          ...current,
          overlay: {
            ...current.overlay,
            input: listing.current_path
          }
        }));
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setFolderBrowser((current) => ({
        ...current,
        loading: false,
        currentPath: "",
        parentPath: undefined,
        entries: [],
        error: locale === "zh"
          ? `无法读取服务器目录${reason ? `：${reason}` : ""}`
          : `Unable to read server directories${reason ? `: ${reason}` : ""}`
      }));
    }
  }, [locale, t]);

  const onBrowseOverlayDirectory = (path?: string, selectCurrent = false) => {
    void browseOverlayDirectory(stateRef.current.overlay.target, path, selectCurrent);
  };

  const onSelectOverlayDirectory = (path: string) => {
    updateState((current) => ({
      ...current,
      overlay: {
        ...current.overlay,
        input: path
      }
    }));
  };

  useEffect(() => {
    if (!state.overlay.visible || state.overlay.mode !== "local") return;
    void browseOverlayDirectory(
      state.overlay.target,
      state.overlay.input || undefined,
      !state.overlay.input
    );
  }, [
    state.overlay.visible,
    state.overlay.mode,
    state.overlay.target.type,
    state.overlay.target.type === "wsl" ? state.overlay.target.distro : "",
    browseOverlayDirectory
  ]);

  const onOverlayCancel = () => {
    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, visible: false }
    }));
  };

  const onStartWorkspace = async () => {
    const overlay = stateRef.current.overlay;
    if (!overlay.tabId) return;
    if (!overlay.input.trim()) return;
    const source = {
      tabId: overlay.tabId,
      kind: overlay.mode,
      pathOrUrl: overlay.input.trim(),
      target: overlay.target
    };
    const info = await safeInvoke<WorkspaceInfo>("init_workspace", { source }, {
      tab_id: overlay.tabId,
      project_path: overlay.input.trim(),
      target: overlay.target
    });

    const terminalInfo = await safeInvoke<{ id: number; output: string }>(
      "terminal_create",
      { tabId: overlay.tabId, cwd: info.project_path, target: overlay.target },
      { id: Date.now(), output: "" }
    );

    updateTab(overlay.tabId, (tab) => ({
      ...tab,
      title: displayPathName(info.project_path) || tab.title,
      status: "ready",
      project: {
        kind: overlay.mode,
        path: info.project_path,
        gitUrl: overlay.mode === "remote" ? overlay.input.trim() : undefined,
        target: overlay.target
      },
      terminals: [{
        id: `term-${terminalInfo.id}`,
        title: formatTerminalTitle(1, locale),
        output: terminalInfo.output ?? ""
      }],
      activeTerminalId: `term-${terminalInfo.id}`,
      gitChanges: [],
      fileTree: [],
      changesTree: [],
      filePreview: createEmptyPreview()
    }));

    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, visible: false }
    }));

    await refreshTabFromBackend(overlay.tabId);
    const workspaceTree = await refreshWorkspaceArtifacts(overlay.tabId);
    const firstFile = flattenTree(workspaceTree?.root.children ?? []).find((node) => node.kind === "file");
    if (firstFile) {
      await onFileSelect(firstFile);
    }
  };

  const buildAgentCommand = (tab: Tab) => {
    const path = tab.project?.path ?? "";
    return tab.agent.command.replace("{path}", path);
  };

  const agentStartMaybe = async (tab: Tab, session: Session) => {
    if (!tab.project?.path) return false;
    const command = buildAgentCommand(tab);
    const cwd = tab.project.path;
    const target = tab.project.target;
    const availability = await safeInvoke<CommandAvailability | null>(
      "command_exists",
      { command, target, cwd },
      null
    );
    if (availability && !availability.available) {
      addToast({
        id: createId("toast"),
        text: `${t("agentStartFailed")}: ${availability.error ?? t("launchCommandMissing", { runtime: formatExecTargetLabel(target, t) })}`,
        sessionId: session.id
      });
      return false;
    }
    const startupToken = armAgentStartupGate(tab.id, session.id);
    const result = await invokeAgent<AgentStartResult>("agent_start", {
      tabId: tab.id,
      sessionId: session.id,
      provider: tab.agent.provider,
      command,
      claudeSessionId: session.claudeSessionId,
      cwd,
      target
    }, session.id, t("agentStartFailed"));
    if (!result) {
      clearAgentStartupGate(tab.id, session.id, startupToken);
      return false;
    }
    const runtimeKey = agentRuntimeKey(tab.id, session.id);
    agentRuntimeSizeRef.current.delete(runtimeKey);
    agentResizeStateRef.current.delete(runtimeKey);
    runningAgentKeysRef.current.add(runtimeKey);
    if (!result.started) {
      clearAgentStartupGate(tab.id, session.id, startupToken);
    }
    return {
      ok: true,
      started: result.started,
      startupToken: result.started ? startupToken : null
    };
  };

  const agentSend = async (tab: Tab, session: Session, input: string) => {
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((s) =>
        s.id === session.id ? { ...s, status: resolveVisibleStatus(current, s, "waiting"), lastActiveAt } : s
      )
    }));
    void syncSessionPatch(tab.id, session.id, { status: "waiting", last_active_at: lastActiveAt });
    const sent = await invokeAgent("agent_send", {
      tabId: tab.id,
      sessionId: session.id,
      input,
      appendNewline: true
    }, session.id, t("agentSendFailed"));
    return sent !== null;
  };

  const sendAgentRawChunk = async (tab: Tab, session: Session, input: string) => {
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, lastActiveAt } : item
      )
    }));
    void syncSessionPatch(tab.id, session.id, { last_active_at: lastActiveAt });
    const sent = await invokeAgent("agent_send", {
      tabId: tab.id,
      sessionId: session.id,
      input,
      appendNewline: false
    }, session.id, t("agentKeySendFailed"));
    return sent !== null;
  };

  const sendRawAgentInput = async (tab: Tab, session: Session, input: string) => {
    const lastActiveAt = Date.now();
    updateTab(tab.id, (current) => ({
      ...current,
      sessions: current.sessions.map((item) =>
        item.id === session.id ? { ...item, lastActiveAt } : item
      )
    }));
    void syncSessionPatch(tab.id, session.id, { last_active_at: lastActiveAt });
    const started = await agentStartMaybe(tab, session);
    if (!started) return;
    if (started.started && started.startupToken !== null) {
      await waitForAgentStartupDrain(tab.id, session.id, started.startupToken);
    }
    await sendAgentRawChunk(tab, session, input);
  };

  const onNewSession = async () => {
    const currentTab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeTabId);
    if (!currentTab) return;
    const mode: SessionMode = "branch";
    updateTab(currentTab.id, (tab) => {
      const newSession = createDraftSessionForTab(tab, mode);
      const nextLeaf = createPaneLeaf(newSession.id);
      const updatedSessions: Session[] = tab.sessions.map((s) =>
        s.id === tab.activeSessionId ? { ...s, status: toBackgroundStatus(s.status) } : s
      );
      return {
        ...tab,
        sessions: [newSession, ...updatedSessions],
        activeSessionId: newSession.id,
        activePaneId: nextLeaf.id,
        paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
          type: "split",
          id: createId("split"),
          axis: "vertical",
          ratio: 0.5,
          first: leaf,
          second: nextLeaf
        })),
        viewingArchiveId: undefined
      };
    });

    const previousSession = currentTab.sessions.find((session) => session.id === currentTab.activeSessionId);
    if (previousSession && isForegroundActiveStatus(previousSession.status)) {
      void syncSessionPatch(currentTab.id, previousSession.id, { status: "background" });
    }
  };

  const onSwitchSession = (sessionId: string) => {
    const nextActiveAt = Date.now();
    const previousActiveId = activeTab.activeSessionId;
    const previousSession = activeTab.sessions.find((session) => session.id === previousActiveId);
    const nextSession = activeTab.sessions.find((session) => session.id === sessionId);
    const targetPaneId = findPaneIdBySessionId(activeTab.paneLayout, sessionId);
    if (!targetPaneId || !nextSession) return;
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      activeSessionId: sessionId,
      activePaneId: targetPaneId,
      sessions: tab.sessions
        .filter((s) => !(previousActiveId !== sessionId && s.id === previousActiveId && isDraftSession(s)))
        .map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            unread: 0,
            status: restoreVisibleStatus(s),
            lastActiveAt: nextActiveAt
          };
        }
        if (s.id === tab.activeSessionId) {
          return { ...s, status: toBackgroundStatus(s.status) };
        }
        return s;
      }),
      viewingArchiveId: undefined
    }));
    const backendSessionId = parseNumericId(sessionId);
    if (backendSessionId !== null) {
      void safeInvoke("switch_session", { tabId: activeTab.id, sessionId: backendSessionId }, null);
    }
    if (previousActiveId !== sessionId) {
      if (previousSession && isForegroundActiveStatus(previousSession.status)) {
        void syncSessionPatch(activeTab.id, previousActiveId, { status: "background" });
      }
    }
    const nextStatus = restoreVisibleStatus(nextSession);
    void syncSessionPatch(activeTab.id, sessionId, {
      status: nextStatus,
      last_active_at: nextActiveAt
    });
  };

  const onCloseAgentPane = async (paneId: string, sessionId: string) => {
    const session = activeTab.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const nextActiveAt = Date.now();
    let nextActiveSessionId: string | null = null;

    updateTab(activeTab.id, (tab) => {
      const sessionExists = tab.sessions.some((item) => item.id === sessionId);
      if (!sessionExists) return tab;
      const canRemovePane = collectPaneLeaves(tab.paneLayout).length > 1;
      const remainingSessions = tab.sessions.filter((item) => item.id !== sessionId);
      const hasRemaining = remainingSessions.length > 0;
      const fallbackSession = hasRemaining ? null : createDraftSessionForTab(tab, "branch");
      const sessions = hasRemaining ? remainingSessions : [fallbackSession!];
      const nextSessionId = sessions[0]?.id ?? sessionId;

      let nextLayout = canRemovePane ? (removePaneNode(tab.paneLayout, paneId) ?? tab.paneLayout) : tab.paneLayout;
      nextLayout = remapPaneSession(nextLayout, sessionId, nextSessionId);
      const leaves = collectPaneLeaves(nextLayout);
      const nextPaneId = tab.activePaneId === paneId
        ? (leaves[0]?.id ?? tab.activePaneId)
        : tab.activePaneId;
      const nextActiveId = findPaneSessionId(nextLayout, nextPaneId) ?? nextSessionId;
      nextActiveSessionId = nextActiveId;

      return {
        ...tab,
        sessions: sessions.map((item) =>
          item.id === nextActiveId
            ? { ...item, unread: 0, status: restoreVisibleStatus(item), lastActiveAt: nextActiveAt }
            : item
        ),
        paneLayout: nextLayout,
        activePaneId: nextPaneId,
        activeSessionId: nextActiveId,
        viewingArchiveId: undefined
      };
    });

    if (nextActiveSessionId) {
      const backendSessionId = parseNumericId(nextActiveSessionId);
      if (backendSessionId !== null) {
        void safeInvoke("switch_session", { tabId: activeTab.id, sessionId: backendSessionId }, null);
      }
    }

    if (!isDraftSession(session)) {
      const backendSessionId = parseNumericId(session.id);
      if (backendSessionId !== null) {
        void safeInvoke("archive_session", { tabId: activeTab.id, sessionId: backendSessionId }, null);
      }
    }
  };

  const archiveSessionForTab = async (tabId: string, sessionId: string) => {
    const currentTab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = currentTab?.sessions.find((item) => item.id === sessionId);
    if (!currentTab || !session) return;
    const wasActiveSession = currentTab.activeSessionId === sessionId;
    if (isDraftSession(session)) {
      const nextSession = currentTab.sessions.find((item) => item.id !== sessionId);
      const nextActiveAt = Date.now();
      updateTab(tabId, (tab) => {
        let remaining = tab.sessions.filter((item) => item.id !== sessionId);
        if (remaining.length === 0) {
          remaining = [createDraftSessionForTab(tab, "branch")];
        }
        const nextActiveId = remaining[0]?.id ?? sessionId;
        return {
          ...tab,
          sessions: remaining.map((item) =>
            item.id === nextActiveId && item.status === "background"
              ? { ...item, status: restoreVisibleStatus(item), unread: 0, lastActiveAt: Date.now() }
              : item
          ),
          paneLayout: remapPaneSession(tab.paneLayout, sessionId, nextActiveId),
          activeSessionId: nextActiveId,
          viewingArchiveId: undefined
        };
      });
      if (nextSession) {
        const nextStatus = restoreVisibleStatus(nextSession);
        void syncSessionPatch(tabId, nextSession.id, {
          status: nextStatus,
          last_active_at: nextActiveAt
        });
      }
      return;
    }
    const backendSessionId = parseNumericId(sessionId);
    const archived = backendSessionId !== null
      ? await safeInvoke<BackendArchiveEntry | null>("archive_session", { tabId, sessionId: backendSessionId }, null)
      : null;

    const nextActiveAt = Date.now();
    let nextActiveSessionId: string | null = null;
    let nextActiveStatus: SessionStatus | null = null;
    updateTab(tabId, (tab) => {
      const index = tab.sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return tab;
      const entry: ArchiveEntry = {
        id: archived ? String(archived.id) : createId("archive"),
        sessionId: session.id,
        time: archived?.time ?? nowLabel(),
        mode: archived?.mode ?? session.mode,
        snapshot: session
      };
      const existingSessions = tab.sessions
        .filter((s) => s.id !== sessionId)
        .map((item) => ({ ...item, status: toBackgroundStatus(item.status) }));
      let remaining = existingSessions;
      if (wasActiveSession) {
        const draftSession = createDraftSessionForTab(tab, "branch");
        remaining = [draftSession, ...existingSessions];
      } else if (remaining.length === 0) {
        remaining = [createDraftSessionForTab(tab, "branch")];
      }
      const nextActive = remaining[0]?.id ?? sessionId;
      nextActiveSessionId = nextActive;
      nextActiveStatus = remaining[0] ? restoreVisibleStatus(remaining[0]) : null;
      return {
        ...tab,
        sessions: remaining.map((item) =>
          item.id === nextActive && item.status === "background"
            ? { ...item, status: restoreVisibleStatus(item), unread: 0, lastActiveAt: nextActiveAt }
            : item.id === nextActive && wasActiveSession
              ? { ...item, unread: 0, lastActiveAt: nextActiveAt }
              : item
        ),
        archive: [entry, ...tab.archive],
        paneLayout: remapPaneSession(tab.paneLayout, sessionId, nextActive),
        activeSessionId: nextActive,
        viewingArchiveId: undefined
      };
    });

    if (wasActiveSession && nextActiveSessionId) {
      const backendSessionId = parseNumericId(nextActiveSessionId);
      if (backendSessionId !== null) {
        void safeInvoke("switch_session", { tabId, sessionId: backendSessionId }, null);
      }
      if (nextActiveStatus) {
        void syncSessionPatch(tabId, nextActiveSessionId, {
          status: nextActiveStatus,
          last_active_at: nextActiveAt
        });
      }
    }
  };

  const onArchiveSession = async (sessionId: string) => {
    await archiveSessionForTab(activeTab.id, sessionId);
  };

  const onSelectArchive = (entryId: string) => {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      viewingArchiveId: entryId
    }));
  };

  const onExitArchive = () => {
    updateTab(activeTab.id, (tab) => ({ ...tab, viewingArchiveId: undefined }));
  };

  const onOpenSettings = () => {
    setSettingsDraft(cloneAppSettings(appSettings));
    navigateToRoute("settings");
  };

  const onCloseSettings = () => {
    setSettingsDraft(cloneAppSettings(appSettings));
    navigateToRoute("workspace");
  };

  const commitSettings = (nextSettings: AppSettings) => {
    setAppSettings(nextSettings);
    persistAppSettings(nextSettings);
    syncGlobalSettings(nextSettings);
    setSettingsDraft(cloneAppSettings(nextSettings));
  };

  const onUpdateSettings = (patch: Partial<AppSettings>) => {
    const nextSettings: AppSettings = {
      ...settingsDraft,
      ...patch,
      idlePolicy: patch.idlePolicy ? { ...patch.idlePolicy } : settingsDraft.idlePolicy
    };
    commitSettings(nextSettings);
  };

  const onUpdateSettingsIdlePolicy = (patch: Partial<Tab["idlePolicy"]>) => {
    const nextSettings: AppSettings = {
      ...settingsDraft,
      idlePolicy: {
        enabled: patch.enabled ?? settingsDraft.idlePolicy.enabled,
        idleMinutes: Math.max(1, Number(patch.idleMinutes ?? settingsDraft.idlePolicy.idleMinutes) || 1),
        maxActive: Math.max(1, Number(patch.maxActive ?? settingsDraft.idlePolicy.maxActive) || 1),
        pressure: patch.pressure ?? settingsDraft.idlePolicy.pressure
      }
    };
    commitSettings(nextSettings);
  };

  const markSessionIdle = async (tabId: string, sessionId: string, note?: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    updateTab(tabId, (currentTab) => ({
      ...currentTab,
      sessions: currentTab.sessions.map((currentSession) => {
        if (currentSession.id !== sessionId) return currentSession;
        const nextUnread = currentSession.id === currentTab.activeSessionId ? 0 : currentSession.unread + 1;
        return {
          ...currentSession,
          status: "idle",
          unread: nextUnread,
          lastActiveAt: Date.now(),
          messages: note
            ? [
                ...currentSession.messages,
                {
                  id: createId("msg"),
                  role: "system",
                  content: note,
                  time: nowLabel()
                }
              ]
            : currentSession.messages
        };
      })
    }));

    void syncSessionPatch(tabId, sessionId, { status: "idle", last_active_at: Date.now() });

    const updatedTab = stateRef.current.tabs.find((item) => item.id === tabId);
    const updatedSession = updatedTab?.sessions.find((item) => item.id === sessionId);
    if (!updatedTab || !updatedSession) return;

    if (updatedTab.activeSessionId !== sessionId && session.status !== "idle") {
      addToast({
        id: createId("toast"),
        text: note ?? t("taskCompletedToast", { title: displaySessionTitle(updatedSession.title) }),
        sessionId
      });
    }
  };

  const settleSessionAfterExit = async (tabId: string, sessionId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    if (session.status !== "idle") {
      await markSessionIdle(tabId, sessionId, t("agentExited"));
    }
  };

  const onFileSelect = async (node: TreeNode) => {
    if (node.kind !== "file") return;
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    const segments = node.path.split(/[\\/]+/).filter(Boolean);
    if (segments.length > 1) {
      setRepoCollapsedPaths((current) => {
        const next = new Set(current);
        let prefix = "";
        for (const segment of segments.slice(0, -1)) {
          prefix = prefix ? `${prefix}/${segment}` : segment;
          next.add(prefix);
        }
        return next;
      });
    }
    const path = resolvePath(currentTab.project?.path, node.path);
    const preview = await safeInvoke<FilePreview>("file_preview", { path }, {
      path: node.path,
      content: t("previewUnavailable"),
      mode: "preview"
    });
    updateTab(currentTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        path: preview.path || node.path,
        content: preview.content || t("previewUnavailable"),
        mode: "preview",
        originalContent: "",
        modifiedContent: "",
        dirty: false,
        source: "tree",
        statusLabel: node.status,
        parentPath: fileParentLabel(preview.path || node.path),
        section: undefined,
        diff: undefined
      }
    }));
    setSelectedGitChangeKey("");
    setPreviewMode("preview");
  };

  const openPreviewPath = async (path: string, options?: { clearGitSelection?: boolean; statusLabel?: string; parentPath?: string }) => {
    const preview = await safeInvoke<FilePreview>("file_preview", { path }, {
      path,
      content: t("previewUnavailable"),
      mode: "preview"
    });
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        path: preview.path || path,
        content: preview.content || t("previewUnavailable"),
        mode: "preview",
        originalContent: "",
        modifiedContent: "",
        dirty: false,
        source: "tree",
        statusLabel: options?.statusLabel ?? tab.filePreview.statusLabel,
        parentPath: options?.parentPath ?? fileParentLabel(preview.path || path),
        section: undefined,
        diff: undefined
      }
    }));
    if (options?.clearGitSelection ?? false) {
      setSelectedGitChangeKey("");
    }
    setPreviewMode("preview");
  };

  const onFileSearchSelect = async (node: TreeNode) => {
    setFileSearchQuery("");
    setFileSearchOpen(false);
    setFileSearchActiveIndex(0);
    setCodeSidebarView("files");
    await onFileSelect(node);
    requestAnimationFrame(() => {
      fileSearchInputRef.current?.blur();
    });
  };

  const onFileSearchBlur = () => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof Node && fileSearchShellRef.current?.contains(active)) return;
      setFileSearchOpen(false);
    });
  };

  const onFileSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!normalizedFileSearchQuery) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFileSearchOpen(true);
      setFileSearchActiveIndex((current) => (
        fileSearchResults.length === 0
          ? 0
          : Math.min(current + 1, fileSearchResults.length - 1)
      ));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFileSearchOpen(true);
      setFileSearchActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      if (!fileSearchResults.length) return;
      event.preventDefault();
      void onFileSearchSelect((fileSearchResults[fileSearchActiveIndex] ?? fileSearchResults[0]).node);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setFileSearchOpen(false);
    }
  };

  const onGitChangeSelect = async (change: GitChangeEntry) => {
    const currentTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id) ?? activeTab;
    const relativePath = sanitizeGitRelativePath(change.path);
    const path = resolvePath(currentTab.project?.path, relativePath);
    let payload = await safeInvoke<GitFileDiffPayload>("git_file_diff_payload", {
      path: currentTab.project?.path ?? "",
      target: currentTab.project?.target ?? { type: "native" },
      filePath: relativePath,
      section: change.section
    }, {
      original_content: "",
      modified_content: "",
      diff: ""
    });

    if (!payload.original_content && !payload.modified_content && !payload.diff) {
      const fallbackDiff = await safeInvoke<string>("git_diff_file", {
        path: currentTab.project?.path ?? "",
        target: currentTab.project?.target ?? { type: "native" },
        filePath: relativePath,
        staged: change.section === "staged"
      }, "");

      const fallbackPreview = await safeInvoke<FilePreview | null>("file_preview", { path }, null);
      payload = {
        original_content: "",
        modified_content: fallbackPreview?.content ?? "",
        diff: fallbackDiff
      };
    }

    const stats = computeDiffStats(payload.diff);
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        path,
        content: payload.modified_content,
        mode: "diff",
        diff: payload.diff,
        originalContent: payload.original_content,
        modifiedContent: payload.modified_content,
        diffStats: { files: stats.files, additions: stats.additions, deletions: stats.deletions },
        diffFiles: [change.path],
        dirty: false,
        source: "git",
        statusLabel: change.status,
        parentPath: change.parent,
        section: change.section
      }
    }));
    setPreviewMode("diff");

    setSelectedGitChangeKey(`${change.section}:${change.path}:${change.code}`);
  };

  const onGitChangeAction = async (change: GitChangeEntry, action: GitChangeAction) => {
    const relativePath = sanitizeGitRelativePath(change.path);
    const basePayload = {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" },
      filePath: relativePath
    };

    if (action === "stage") {
      await invokeGitAction("git_stage_file", basePayload);
      return;
    }
    if (action === "unstage") {
      await invokeGitAction("git_unstage_file", basePayload);
      return;
    }
    await invokeGitAction("git_discard_file", { ...basePayload, section: change.section });
  };

  const onPreviewEdit = (content: string) => {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        content,
        dirty: true
      }
    }));
  };

  const onPreviewMode = async (mode: "preview" | "diff") => {
    setPreviewMode(mode);
    if (mode === "preview") return;
    await refreshWorkspaceArtifacts(activeTab.id);
    const target = activeTab.project?.target ?? { type: "native" };
    const path = activeTab.project?.path ?? "";
    const diff = await safeInvoke<string>("git_diff", { path, target }, "");
    const stats = computeDiffStats(diff);
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        mode: "diff",
        diff,
        originalContent: "",
        modifiedContent: "",
        diffStats: { files: stats.files, additions: stats.additions, deletions: stats.deletions },
        diffFiles: stats.diffFiles,
        dirty: tab.filePreview.dirty
      }
    }));
  };

  const onSavePreview = async () => {
    const preview = activeTab.filePreview;
    if (!preview.path || !preview.dirty) return;
    const saved = await safeInvoke<FilePreview | null>("file_save", {
      path: preview.path,
      content: preview.content
    }, null);
    if (!saved) return;

    updateTab(activeTab.id, (tab) => ({
      ...tab,
      filePreview: {
        ...tab.filePreview,
        path: saved.path,
        content: saved.content,
        dirty: false
      }
    }));
    await refreshWorkspaceArtifacts(activeTab.id);
    addToast({ id: createId("toast"), text: `${t("saved")}: ${saved.path}`, sessionId: activeSession.id });
  };

  const invokeGitAction = async (command: string, payload: Record<string, unknown>) => {
    if (!activeTab.project?.path) {
      addToast({ id: createId("toast"), text: t("selectProjectFirst"), sessionId: activeSession.id });
      return false;
    }
    try {
      await invoke(command, payload);
      await refreshWorkspaceArtifacts(activeTab.id);
      const refreshedTab = stateRef.current.tabs.find((tab) => tab.id === activeTab.id);
      const selectedChange = refreshedTab?.gitChanges.find((change) => `${change.section}:${change.path}:${change.code}` === selectedGitChangeKey)
        ?? refreshedTab?.gitChanges.find((change) => {
          const currentPreviewPath = refreshedTab?.filePreview.path || activeTab.filePreview.path;
          return matchesGitPreviewPath(currentPreviewPath, change.path);
        });
      if (selectedChange) {
        await onGitChangeSelect(selectedChange);
      } else if (previewMode === "diff") {
        await onPreviewMode("diff");
      } else if (selectedGitChangeKey) {
        setSelectedGitChangeKey("");
        updateTab(activeTab.id, (tab) => ({
          ...tab,
          filePreview: createEmptyPreview()
        }));
      }
      return true;
    } catch (error) {
      addToast({
        id: createId("toast"),
        text: `${t("gitActionFailed")}: ${String(error)}`,
        sessionId: activeSession.id
      });
      return false;
    }
  };

  const onGitStageAll = async () => {
    await invokeGitAction("git_stage_all", {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" }
    });
  };

  const onGitUnstageAll = async () => {
    await invokeGitAction("git_unstage_all", {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" }
    });
  };

  const onGitDiscardAll = async () => {
    const ok = await invokeGitAction("git_discard_all", {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" }
    });
    if (ok) {
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        filePreview: createEmptyPreview()
      }));
      setPreviewMode("preview");
    }
  };

  const onGitCommit = async () => {
    if (!commitMessage.trim()) return;
    const ok = await invokeGitAction("git_commit", {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" },
      message: commitMessage.trim()
    });
    if (ok) {
      setCommitMessage("");
      addToast({
        id: createId("toast"),
        text: t("gitCommitSucceeded"),
        sessionId: activeSession.id
      });
    }
  };

  const onAddTerminal = async () => {
    if (!activeTab.project?.path) {
      addToast({ id: createId("toast"), text: t("selectProjectFirst"), sessionId: activeSession.id });
      return;
    }
    const info = await safeInvoke<{ id: number; output: string }>(
      "terminal_create",
      { tabId: activeTab.id, cwd: activeTab.project.path, target: activeTab.project.target },
      { id: Date.now(), output: "" }
    );
    updateTab(activeTab.id, (tab) => {
      const newTerminal = {
        id: `term-${info.id}`,
        title: formatTerminalTitle(tab.terminals.length + 1, locale),
        output: info.output ?? ""
      };
      return {
        ...tab,
        terminals: [...tab.terminals, newTerminal],
        activeTerminalId: newTerminal.id
      };
    });
  };

  const onTerminalSelect = (terminalId: string) => {
    updateTab(activeTab.id, (tab) => ({ ...tab, activeTerminalId: terminalId }));
  };

  const onCloseTerminal = async (terminalId: string) => {
    const numericId = Number(terminalId.replace("term-", ""));
    if (Number.isFinite(numericId)) {
      await safeInvoke("terminal_close", { tabId: activeTab.id, terminalId: numericId }, null);
    }

    updateTab(activeTab.id, (tab) => {
      const remaining = tab.terminals.filter((terminal) => terminal.id !== terminalId);
      const nextActiveId = tab.activeTerminalId === terminalId
        ? (remaining[0]?.id ?? "")
        : tab.activeTerminalId;

      return {
        ...tab,
        terminals: remaining,
        activeTerminalId: nextActiveId
      };
    });
  };

  const onOpenWorktree = async (tree: WorktreeInfo) => {
    setWorktreeView("status");
    setWorktreeModal({
      name: tree.name,
      path: tree.path,
      branch: tree.branch,
      status: tree.status,
      diff: tree.diff,
      tree: tree.tree,
      changes: tree.changes,
      loading: true
    });

    const detail = await safeInvoke<WorktreeDetail | null>(
      "worktree_inspect",
      { path: tree.path, target: activeTab.project?.target ?? { type: "native" }, depth: 4 },
      null
    );

    if (!detail) {
      setWorktreeModal({
        name: tree.name,
        path: tree.path,
        branch: tree.branch,
        status: tree.status,
        diff: tree.diff ?? "",
        tree: tree.tree ?? activeTab.fileTree,
        changes: tree.changes ?? activeTab.changesTree,
        loading: false
      });
      return;
    }

    setWorktreeModal({
      name: detail.name,
      path: detail.path,
      branch: detail.branch,
      status: detail.status,
      diff: detail.diff,
      tree: detail.root.children ?? [],
      changes: detail.changes,
      loading: false
    });
  };

  const onResizeStart = (type: "left" | "right-split") => (event: React.PointerEvent) => {
    event.preventDefault();
    document.body.classList.add("is-resizing-panels");
    document.body.classList.add(type === "right-split" ? "is-resizing-rows" : "is-resizing-columns");
    const startX = event.clientX;
    const startY = event.clientY;
    const { rightWidth, rightSplit } = stateRef.current.layout;
    const splitContainerHeight = type === "right-split"
      ? event.currentTarget instanceof HTMLElement
        ? event.currentTarget.parentElement?.getBoundingClientRect().height ?? 1
        : 1
      : 1;
    let frameId = 0;
    let pendingWidth = rightWidth;
    let pendingSplit = rightSplit;

    const flushLayout = () => {
      frameId = 0;
      updateState((current) => ({
        ...current,
        layout: {
          ...current.layout,
          rightWidth: type === "left" ? pendingWidth : current.layout.rightWidth,
          rightSplit: type === "right-split" ? pendingSplit : current.layout.rightSplit
        }
      }));
    };

    const onMove = (e: PointerEvent) => {
      if (type === "left") {
        pendingWidth = Math.max(0, Math.round(rightWidth - (e.clientX - startX)));
      }
      if (type === "right-split") {
        const delta = e.clientY - startY;
        pendingSplit = Math.max(0, Math.min(100, rightSplit + (delta / splitContainerHeight) * 100));
      }
      if (!frameId) {
        frameId = window.requestAnimationFrame(flushLayout);
      }
    };

    const onUp = () => {
      document.body.classList.remove("is-resizing-panels");
      document.body.classList.remove("is-resizing-columns", "is-resizing-rows");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        flushLayout();
      }
      requestAnimationFrame(() => {
        shellTerminalRef.current?.fit();
        fitAgentTerminals();
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleRightPane = (pane: "code" | "terminal") => {
    updateState((current) => ({
      ...current,
      layout: {
        ...current.layout,
        showCodePanel: pane === "code" ? !current.layout.showCodePanel : current.layout.showCodePanel,
        showTerminalPanel: pane === "terminal" ? !current.layout.showTerminalPanel : current.layout.showTerminalPanel
      }
    }));
    if (pane === "code") {
      setIsCodeExpanded(false);
    }
    requestAnimationFrame(() => {
      shellTerminalRef.current?.fit();
    });
  };

  const activeTerminal = activeTab.terminals.find((t) => t.id === activeTab.activeTerminalId) ?? activeTab.terminals[0];
  const showCodePanel = state.layout.showCodePanel;
  const showTerminalPanel = state.layout.showTerminalPanel;
  const showAgentPanel = !isCodeExpanded;

  const toggleCodeExpanded = async () => {
    if (isCodeExpanded) {
      if (codeSidebarView === "git" && activeTab.filePreview.mode === "diff" && activeTab.filePreview.path) {
        await openPreviewPath(activeTab.filePreview.path, {
          clearGitSelection: false,
          statusLabel: activeTab.filePreview.statusLabel,
          parentPath: activeTab.filePreview.parentPath
        });
      }
      setCodeSidebarView("files");
    }
    setIsCodeExpanded((value) => !value);
  };

  const setActivePane = (paneId: string, sessionId: string) => {
    const nextActiveAt = Date.now();
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      activePaneId: paneId,
      activeSessionId: sessionId,
      sessions: tab.sessions.map((session) => {
        if (session.id === sessionId) {
          return {
            ...session,
            unread: 0,
            status: restoreVisibleStatus(session),
            lastActiveAt: nextActiveAt
          };
        }
        if (session.id === tab.activeSessionId) {
          return { ...session, status: toBackgroundStatus(session.status) };
        }
        return session;
      })
    }));
  };

  const splitPane = (paneId: string, axis: "horizontal" | "vertical") => {
    let nextPaneId: string | null = null;
    updateTab(activeTab.id, (tab) => {
      const targetPaneId = findPaneSessionId(tab.paneLayout, paneId)
        ? paneId
        : findPaneIdBySessionId(tab.paneLayout, tab.activeSessionId)
          ?? collectPaneLeaves(tab.paneLayout)[0]?.id;
      if (!targetPaneId) return tab;
      const newSession = createDraftSessionForTab(tab, "branch");
      const nextLeaf = createPaneLeaf(newSession.id);
      nextPaneId = nextLeaf.id;
      return {
        ...tab,
        sessions: [newSession, ...tab.sessions.filter((session) => session.id !== newSession.id)],
        activePaneId: nextLeaf.id,
        activeSessionId: newSession.id,
        paneLayout: replacePaneNode(tab.paneLayout, targetPaneId, (leaf) => ({
          type: "split",
          id: createId("split"),
          axis,
          ratio: 0.5,
          first: leaf,
          second: nextLeaf
        }))
      };
    });
    if (nextPaneId) {
      focusAgentTerminal(nextPaneId);
    }
  };

  const onPaneSplitResizeStart = (splitId: string, axis: "horizontal" | "vertical") => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    document.body.classList.add("is-resizing-panels");
    document.body.classList.add(axis === "horizontal" ? "is-resizing-rows" : "is-resizing-columns");
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const initialRatio = activeTab.paneLayout;
    const startX = event.clientX;
    const startY = event.clientY;

    const readCurrentRatio = (node: SessionPaneNode): number | null => {
      if (node.type === "leaf") return null;
      if (node.id === splitId) return node.ratio;
      return readCurrentRatio(node.first) ?? readCurrentRatio(node.second);
    };

    const baseRatio = readCurrentRatio(initialRatio) ?? 0.5;
    let frameId = 0;
    let pendingRatio = baseRatio;

    const flushRatio = () => {
      frameId = 0;
      updateTab(activeTab.id, (tab) => ({
        ...tab,
        paneLayout: updateSplitRatio(tab.paneLayout, splitId, pendingRatio)
      }));
    };

    const onMove = (moveEvent: PointerEvent) => {
      const delta = axis === "vertical"
        ? (moveEvent.clientX - startX) / Math.max(rect.width, 1)
        : (moveEvent.clientY - startY) / Math.max(rect.height, 1);
      pendingRatio = Math.max(0, Math.min(1, baseRatio + delta));
      if (!frameId) {
        frameId = window.requestAnimationFrame(flushRatio);
      }
    };

    const onUp = () => {
      document.body.classList.remove("is-resizing-panels");
      document.body.classList.remove("is-resizing-columns", "is-resizing-rows");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frameId) {
        window.cancelAnimationFrame(frameId);
        flushRatio();
      }
      fitAgentTerminals();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onToggleSlashMenu = async (paneId: string) => {
    const nextOpen = !(slashMenuOpen && slashMenuPaneId === paneId);
    setSlashMenuPaneId(nextOpen ? paneId : null);
    setSlashMenuOpen(nextOpen);
    if (nextOpen) {
      await loadSlashSkills(activeTab.project?.path);
    }
  };

  const onSelectSlashMenuItem = (item: ClaudeSlashMenuItem) => {
    setSlashMenuOpen(false);
    setSlashMenuPaneId(null);
    void onAgentTerminalData(activeTab.activePaneId, `${item.command} `);
    focusAgentTerminal(activeTab.activePaneId);
  };

  const onRunCommandPaletteAction = (action: CommandPaletteAction | undefined) => {
    if (!action) return;
    closeCommandPalette();
    action.run();
  };

  const ensureAgentPaneSessionReady = async (paneId: string) => {
    if (isArchiveView) return null;
    const activeTabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    if (!activeTabSnapshot) return null;
    const paneSessionId = findPaneSessionId(activeTabSnapshot.paneLayout, paneId) ?? activeTabSnapshot.activeSessionId;
    const activeSessionSnapshot = activeTabSnapshot.sessions.find((session) => session.id === paneSessionId);
    if (!activeSessionSnapshot) return null;

    const materialized = isDraftSession(activeSessionSnapshot)
      ? await materializeSession(activeTabSnapshot.id, activeSessionSnapshot.id, "")
      : { tab: activeTabSnapshot, session: activeSessionSnapshot };
    const tabSnapshot = materialized?.tab ?? activeTabSnapshot;
    const sessionSnapshot = materialized?.session ?? activeSessionSnapshot;
    if (!tabSnapshot || !sessionSnapshot) return null;

    const runtimeKey = agentRuntimeKey(tabSnapshot.id, sessionSnapshot.id);
    if (!runningAgentKeysRef.current.has(runtimeKey)) {
      const started = await agentStartMaybe(tabSnapshot, sessionSnapshot);
      if (!started) return null;
      if (started.started) {
        syncAgentPaneSize(paneId, tabSnapshot.id, sessionSnapshot.id);
      }
      if (started.started && started.startupToken !== null) {
        await waitForAgentStartupDrain(tabSnapshot.id, sessionSnapshot.id, started.startupToken);
      }
    }

    syncAgentPaneSize(paneId, tabSnapshot.id, sessionSnapshot.id);
    touchSession(tabSnapshot.id, sessionSnapshot.id);
    return { tab: tabSnapshot, session: sessionSnapshot };
  };

  const onAgentTerminalData = async (paneId: string, data: string) => {
    if (isArchiveView || !data) return;
    const activeTabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    const paneSessionId = activeTabSnapshot
      ? (findPaneSessionId(activeTabSnapshot.paneLayout, paneId) ?? activeTabSnapshot.activeSessionId)
      : null;
    const currentSessionSnapshot = paneSessionId && activeTabSnapshot
      ? activeTabSnapshot.sessions.find((session) => session.id === paneSessionId) ?? null
      : null;
    const pendingTitle = currentSessionSnapshot
      ? trackAgentInitialTitleInput(paneId, currentSessionSnapshot, data)
      : null;
    const currentQueue = agentTerminalQueueRef.current.get(paneId) ?? Promise.resolve();
    const nextQueue = currentQueue
      .catch(() => undefined)
      .then(async () => {
        const ready = await ensureAgentPaneSessionReady(paneId);
        if (!ready) return;
        if (pendingTitle) {
          commitAgentSessionTitle(paneId, ready.tab.id, ready.session.id, pendingTitle);
        }
        await sendAgentRawChunk(ready.tab, ready.session, data);
      });
    agentTerminalQueueRef.current.set(paneId, nextQueue);
    await nextQueue;
  };

  const onSubmitDraftPrompt = async (paneId: string) => {
    const content = (draftPromptInputs[paneId] ?? "").trim();
    if (!content) return;
    setDraftPromptInputs((current) => ({
      ...current,
      [paneId]: ""
    }));
    await onAgentTerminalData(paneId, content);
    await onAgentTerminalData(paneId, "\r");
  };

  const onSendSpecialAgentKey = async (paneId: string, sequence: string) => {
    const ready = await ensureAgentPaneSessionReady(paneId);
    if (!ready) return;
    await sendAgentRawChunk(ready.tab, ready.session, sequence);
    focusAgentTerminal(paneId);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const hasModifier = event.metaKey || event.ctrlKey;
      const isEditableTarget = isTextInputTarget(event.target);

      if (hasModifier && key === "k") {
        event.preventDefault();
        if (commandPaletteOpen) {
          closeCommandPalette();
        } else {
          openCommandPalette();
          setSlashMenuOpen(false);
          setSlashMenuPaneId(null);
        }
        return;
      }

      if (commandPaletteOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeCommandPalette();
        }
        return;
      }

      if (hasModifier && key === "s") {
        if (!activeTab.filePreview.path) return;
        event.preventDefault();
        void onSavePreview();
        return;
      }

      if (route !== "workspace") return;

      if (hasModifier && key === "n") {
        event.preventDefault();
        onAddTab();
        return;
      }

      if (hasModifier && event.shiftKey && (event.key === "[" || event.key === "{")) {
        event.preventDefault();
        onCycleWorkspace(-1);
        return;
      }

      if (hasModifier && event.shiftKey && (event.key === "]" || event.key === "}")) {
        event.preventDefault();
        onCycleWorkspace(1);
        return;
      }

      if (!hasModifier && !event.altKey && !event.shiftKey && key === "f" && !isEditableTarget && !isArchiveView) {
        event.preventDefault();
        setIsFocusMode((value) => !value);
        return;
      }

      if (!hasModifier && !event.altKey && !event.shiftKey && event.key === "Escape" && isFocusMode) {
        event.preventDefault();
        setIsFocusMode(false);
        return;
      }

      if (isArchiveView) return;
      const isMacPlatform = typeof navigator !== "undefined" && (navigator.platform || "").toLowerCase().includes("mac");
      const isSplitShortcut = isMacPlatform
        ? event.metaKey && !event.ctrlKey && !event.altKey && key === "d"
        : event.altKey && !event.ctrlKey && !event.metaKey && key === "d";
      if (!isSplitShortcut) return;
      if (event.repeat) return;
      event.preventDefault();
      const splitAxis: "horizontal" | "vertical" = event.shiftKey ? "horizontal" : "vertical";
      splitPane(activeTab.activePaneId, splitAxis);
      setSlashMenuOpen(false);
      setSlashMenuPaneId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeTab.activePaneId,
    activeTab.filePreview.path,
    activeTab.filePreview.dirty,
    activeTab.filePreview.content,
    activeSession.id,
    commandPaletteOpen,
    isArchiveView,
    isFocusMode,
    route
  ]);

  useEffect(() => {
    if (!isArchiveView) {
      focusAgentTerminal();
    }
  }, [activeTab.activePaneId, activePaneSession.id, isArchiveView]);

  useEffect(() => {
    setCommitMessage("");
    setSelectedGitChangeKey("");
    setSlashMenuOpen(false);
    setSlashMenuPaneId(null);
  }, [activeTab.id]);

  useEffect(() => {
    if (!activeTab.project?.path) return;
    void refreshWorkspaceArtifacts(activeTab.id);
  }, [codeSidebarView, activeTab.id, activeTab.project?.path]);

  useEffect(() => {
    if (!activeTab.project?.path) return;
    const timer = window.setInterval(() => {
      void refreshWorkspaceArtifacts(activeTab.id);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeTab.id, activeTab.project?.path]);

  const onShellTerminalSize = useCallback((size: { cols: number; rows: number }) => {
    syncTerminalSize(size.cols, size.rows, activeTerminal?.id);
  }, [activeTerminal?.id, activeTab.id]);

  const onShellTerminalData = useCallback((data: string) => {
    if (!activeTerminal) return;
    const numericId = Number(activeTerminal.id.replace("term-", ""));
    if (!Number.isFinite(numericId)) return;
    void invoke("terminal_write", {
      tabId: activeTab.id,
      terminalId: numericId,
      input: data
    });
  }, [activeTerminal?.id, activeTab.id]);

  const onAgentTerminalSize = useCallback((
    paneId: string,
    tabId: string,
    sessionId: string,
    size: { cols: number; rows: number }
  ) => {
    agentPaneSizeRef.current.set(paneId, size);
    if (!runningAgentKeysRef.current.has(agentRuntimeKey(tabId, sessionId))) return;
    syncAgentRuntimeSize(tabId, sessionId, size);
  }, []);

  useEffect(() => {
    if (!showTerminalPanel || isCodeExpanded) return;
    requestAnimationFrame(() => {
      shellTerminalRef.current?.fit();
    });
  }, [showTerminalPanel, isCodeExpanded, state.layout.rightSplit]);

  useEffect(() => {
    if (activeTerminal && showTerminalPanel && !isCodeExpanded) {
      shellTerminalRef.current?.focus();
    }
  }, [activeTerminal?.id, showTerminalPanel, isCodeExpanded]);

  useEffect(() => {
    if (activeTerminal) return;
    terminalSizeRef.current = { id: undefined, cols: 0, rows: 0 };
  }, [activeTerminal?.id]);
  const layoutStyle = {
    ["--left-w" as string]: `${state.layout.leftWidth}px`,
    ["--right-w" as string]: `${state.layout.rightWidth}px`,
    ["--right-split" as string]: `${state.layout.rightSplit}%`
  };

  const workspaceTabs = [...state.tabs]
    .sort((left, right) => {
      if (sessionSort === "name") {
        return (displayPathName(left.project?.path) || displayWorkspaceTitle(left.title))
          .localeCompare(displayPathName(right.project?.path) || displayWorkspaceTitle(right.title), locale === "zh" ? "zh-CN" : "en");
      }
      const leftTime = Math.max(...left.sessions.map((session) => session.lastActiveAt));
      const rightTime = Math.max(...right.sessions.map((session) => session.lastActiveAt));
      return rightTime - leftTime;
    })
    .map((tab) => {
      const sessions = [...tab.sessions].sort((left, right) => {
        if (sessionSort === "name") {
          return displaySessionTitle(left.title).localeCompare(displaySessionTitle(right.title), locale === "zh" ? "zh-CN" : "en");
        }
        return right.lastActiveAt - left.lastActiveAt;
      });
      const hasRunning = sessions.some((session) => ["running", "waiting", "background"].includes(session.status));
      const unread = sessions.reduce((sum, session) => sum + session.unread, 0);
      return {
        id: tab.id,
        label: displayPathName(tab.project?.path) || displayWorkspaceTitle(tab.title),
        active: tab.id === state.activeTabId,
        hasRunning,
        unread,
        sessions
      };
    });
  const commandPaletteActions: CommandPaletteAction[] = [
    {
      id: "new-workspace",
      label: locale === "zh" ? "新建工作区" : "New Workspace",
      description: locale === "zh" ? "创建并切换到新的工作区" : "Create and switch to a new workspace",
      shortcut: "⌘/Ctrl N",
      keywords: "new workspace tab add create",
      run: onAddTab
    },
    {
      id: "toggle-focus",
      label: locale === "zh" ? (isFocusMode ? "退出专注模式" : "进入专注模式") : (isFocusMode ? "Exit Focus Mode" : "Enter Focus Mode"),
      description: locale === "zh" ? "隐藏左右面板，聚焦命令流" : "Hide side panels and focus the command stream",
      shortcut: "F",
      keywords: "focus mode zen panel hide",
      run: () => setIsFocusMode((value) => !value)
    },
    {
      id: "toggle-code",
      label: showCodePanel
        ? (locale === "zh" ? "隐藏代码面板" : "Hide Code Panel")
        : (locale === "zh" ? "显示代码面板" : "Show Code Panel"),
      description: locale === "zh" ? "切换右侧代码预览区域" : "Toggle the right-side code preview area",
      keywords: "code panel preview right inspector",
      run: () => toggleRightPane("code")
    },
    {
      id: "toggle-terminal",
      label: showTerminalPanel
        ? (locale === "zh" ? "隐藏终端面板" : "Hide Terminal Panel")
        : (locale === "zh" ? "显示终端面板" : "Show Terminal Panel"),
      description: locale === "zh" ? "切换右侧终端区域" : "Toggle the right-side terminal area",
      keywords: "terminal panel shell dock right",
      run: () => toggleRightPane("terminal")
    },
    {
      id: "focus-input",
      label: locale === "zh" ? "聚焦当前 Agent" : "Focus Current Agent",
      description: locale === "zh" ? "将光标移动到当前 agent 终端" : "Move cursor to the active agent terminal",
      keywords: "agent terminal focus",
      run: () => focusAgentTerminal()
    },
    {
      id: "split-pane-vertical",
      label: t("splitVertical"),
      description: t("splitVerticalDescription"),
      shortcut: "Alt/⌘ D",
      keywords: "split pane vertical agent",
      run: () => splitPane(activeTab.activePaneId, "vertical")
    },
    {
      id: "split-pane-horizontal",
      label: t("splitHorizontal"),
      description: t("splitHorizontalDescription"),
      shortcut: "Shift + Alt/⌘ D",
      keywords: "split pane horizontal agent",
      run: () => splitPane(activeTab.activePaneId, "horizontal")
    },
    {
      id: "switch-prev-workspace",
      label: locale === "zh" ? "切换到上一个工作区" : "Switch To Previous Workspace",
      description: locale === "zh" ? "按时间序列回到上一个工作区" : "Jump to the previous workspace in the stack",
      shortcut: "⌘/Ctrl ⇧ [",
      keywords: "workspace previous back",
      run: () => onCycleWorkspace(-1)
    },
    {
      id: "switch-next-workspace",
      label: locale === "zh" ? "切换到下一个工作区" : "Switch To Next Workspace",
      description: locale === "zh" ? "按时间序列前往下一个工作区" : "Jump to the next workspace in the stack",
      shortcut: "⌘/Ctrl ⇧ ]",
      keywords: "workspace next forward",
      run: () => onCycleWorkspace(1)
    },
    {
      id: "open-settings",
      label: route === "settings"
        ? (locale === "zh" ? "返回工作区" : "Back To Workspace")
        : (locale === "zh" ? "打开设置" : "Open Settings"),
      description: route === "settings"
        ? (locale === "zh" ? "关闭设置并返回工作台" : "Close settings and return to the workbench")
        : (locale === "zh" ? "打开全局设置面板" : "Open global settings panel"),
      keywords: "settings preferences",
      run: () => {
        if (route === "settings") {
          onCloseSettings();
        } else {
          onOpenSettings();
        }
      }
    },
    ...workspaceTabs.map((tab) => ({
      id: `workspace:${tab.id}`,
      label: `${locale === "zh" ? "切换到" : "Switch To"} ${tab.label}`,
      description: locale === "zh" ? "直接跳转到该工作区" : "Jump directly to this workspace",
      keywords: `workspace ${tab.label.toLowerCase()}`,
      run: () => onSwitchWorkspace(tab.id)
    }))
  ];
  const normalizedCommandPaletteQuery = commandPaletteQuery.trim().toLowerCase();
  const filteredCommandPaletteActions = normalizedCommandPaletteQuery
    ? commandPaletteActions.filter((action) => {
      const haystack = `${action.label} ${action.description} ${action.keywords}`.toLowerCase();
      return haystack.includes(normalizedCommandPaletteQuery);
    })
    : commandPaletteActions;
  const activeCommandPaletteAction = filteredCommandPaletteActions[commandPaletteActiveIndex] ?? filteredCommandPaletteActions[0];

  useEffect(() => {
    if (!filteredCommandPaletteActions.length) {
      setCommandPaletteActiveIndex(0);
      return;
    }
    setCommandPaletteActiveIndex((current) => Math.min(current, filteredCommandPaletteActions.length - 1));
  }, [filteredCommandPaletteActions.length]);

  const gitChangeGroups = [
    {
      key: "changes" as const,
      label: t("changes"),
      items: activeTab.gitChanges.filter((change) => change.section === "changes")
    },
    {
      key: "staged" as const,
      label: t("stagedChanges"),
      items: activeTab.gitChanges.filter((change) => change.section === "staged")
    },
    {
      key: "untracked" as const,
      label: t("untrackedFiles"),
      items: activeTab.gitChanges.filter((change) => change.section === "untracked")
    }
  ].filter((group) => group.items.length > 0);
  const previewGitChange = activeTab.gitChanges.find((change) => matchesGitPreviewPath(activeTab.filePreview.path, change.path));
  const activeGitChangeKey = previewGitChange
    ? `${previewGitChange.section}:${previewGitChange.path}:${previewGitChange.code}`
    : selectedGitChangeKey;
  const gitSummary = {
    changes: gitChangeGroups.find((group) => group.key === "changes")?.items.length ?? 0,
    staged: gitChangeGroups.find((group) => group.key === "staged")?.items.length ?? 0,
    untracked: gitChangeGroups.find((group) => group.key === "untracked")?.items.length ?? 0
  };
  const previewFileName = displayPathName(activeTab.filePreview.path);
  const workspaceFolderName = displayPathName(activeTab.project?.path) || t("noWorkspace");
  const previewPathLabel = activeTab.filePreview.path
    ? (() => {
      const workspaceRoot = activeTab.project?.path;
      if (!workspaceRoot) return activeTab.filePreview.path;
      const normalizedRoot = normalizeComparablePath(workspaceRoot);
      const normalizedPreview = normalizeComparablePath(activeTab.filePreview.path);
      if (normalizedPreview.startsWith(normalizedRoot)) {
        const relative = activeTab.filePreview.path.slice(workspaceRoot.length).replace(/^[/\\]+/, "");
        return relative || previewFileName;
      }
      return activeTab.filePreview.path;
    })()
    : "";
  const searchableFiles = flattenTree(activeTab.fileTree)
    .filter((node) => node.kind === "file")
    .map((node) => ({
      ...node,
      absolutePath: resolvePath(activeTab.project?.path, node.path)
    }));
  const normalizedFileSearchQuery = fileSearchQuery.trim().toLowerCase();
  const fileSearchResults = normalizedFileSearchQuery
    ? searchableFiles
      .map((node) => ({
        node,
        score: fuzzyFileScore(normalizedFileSearchQuery, `${node.name} ${node.path}`)
      }))
      .filter((item) => item.score >= 0)
      .sort((left, right) => right.score - left.score || left.node.path.localeCompare(right.node.path))
      .slice(0, 24)
    : [];
  const showFileSearchDropdown = fileSearchOpen && normalizedFileSearchQuery.length > 0;

  useEffect(() => {
    if (!normalizedFileSearchQuery) {
      setFileSearchOpen(false);
      setFileSearchActiveIndex(0);
      return;
    }
    setFileSearchActiveIndex((current) => Math.min(current, Math.max(fileSearchResults.length - 1, 0)));
  }, [fileSearchResults.length, normalizedFileSearchQuery]);

  useEffect(() => {
    if (!showFileSearchDropdown) {
      setFileSearchDropdownStyle(null);
      return;
    }

    const updateDropdownPosition = () => {
      const anchor = fileSearchShellRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 320), Math.max(320, viewportWidth - 24));
      const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
      const belowSpace = Math.max(0, viewportHeight - rect.bottom - 12);
      const aboveSpace = Math.max(0, rect.top - 12);
      const preferredHeight = 180;
      const placeAbove = belowSpace < preferredHeight && aboveSpace > belowSpace + 40;
      const placement = placeAbove ? "above" : "below";
      const maxHeight = Math.max(120, Math.min(420, placeAbove ? aboveSpace : belowSpace));
      setFileSearchDropdownStyle({
        left,
        width,
        maxHeight,
        placement,
        top: placeAbove ? undefined : rect.bottom + 8,
        bottom: placeAbove ? Math.max(12, viewportHeight - rect.top + 8) : undefined
      });
    };

    updateDropdownPosition();
    window.addEventListener("resize", updateDropdownPosition);
    window.addEventListener("scroll", updateDropdownPosition, true);

    return () => {
      window.removeEventListener("resize", updateDropdownPosition);
      window.removeEventListener("scroll", updateDropdownPosition, true);
    };
  }, [showFileSearchDropdown, state.layout.rightWidth, showCodePanel, isCodeExpanded]);

  useEffect(() => {
    if (!showFileSearchDropdown) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (fileSearchShellRef.current?.contains(target)) return;
      if ((target as Element).closest?.(".workspace-search-dropdown")) return;
      setFileSearchOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [showFileSearchDropdown]);

  const currentFileChangeCount = activeTab.git.changes;
  const hasStructuredDiffContent = Boolean(
    (activeTab.filePreview.originalContent && activeTab.filePreview.originalContent.length > 0)
    || (activeTab.filePreview.modifiedContent && activeTab.filePreview.modifiedContent.length > 0)
  );
  const hasTerminalOutput = Boolean(activeTerminal?.output?.trim());
  const terminalProgressPercent = activeTerminal
    ? (hasTerminalOutput ? 88 : 52)
    : 8;
  const terminalProgressTone = activeTerminal
    ? (hasTerminalOutput ? "live" : "steady")
    : "idle";
  const isSettingsRoute = route === "settings";
  const slashMenuItems: ClaudeSlashMenuItem[] = [
    ...BUILTIN_SLASH_COMMANDS.map((item) => ({
      id: `builtin:${item.command}`,
      command: item.command,
      description: item.description[locale],
      section: "builtin" as const
    })),
    ...BUNDLED_CLAUDE_SKILLS.map((item) => ({
      id: `bundled:${item.command}`,
      command: item.command,
      description: item.description[locale],
      section: "bundled" as const
    })),
    ...slashSkillItems.map((item) => ({
      id: item.id,
      command: item.command,
      description: item.description,
      section: item.scope === "personal" ? "personal" : "project",
      sourcePath: item.source_path,
      sourceKind: item.source_kind
    }))
  ];
  const slashMenuSections = [
    {
      id: "builtin" as const,
      label: t("slashBuiltins"),
      items: slashMenuItems.filter((item) => item.section === "builtin")
    },
    {
      id: "bundled" as const,
      label: t("slashBundledSkills"),
      items: slashMenuItems.filter((item) => item.section === "bundled")
    },
    {
      id: "project" as const,
      label: t("slashProjectSkills"),
      items: slashMenuItems.filter((item) => item.section === "project")
    },
    {
      id: "personal" as const,
      label: t("slashPersonalSkills"),
      items: slashMenuItems.filter((item) => item.section === "personal")
    }
  ].filter((section) => section.items.length > 0);
  const settingsNavItems = [
    { id: "general" as const, label: t("settingsGeneral"), icon: <SettingsGeneralIcon /> },
    { id: "appearance" as const, label: t("settingsAppearance"), icon: <SettingsAppearanceIcon /> }
  ];
  const trimmedLaunchCommand = settingsDraft.agentCommand.trim();
  const launchCommandStateClass = agentCommandStatus.loading
    ? "checking"
    : !trimmedLaunchCommand
      ? "idle"
      : agentCommandStatus.available
        ? "available"
        : "missing";
  const launchCommandStatusText = agentCommandStatus.loading
    ? t("launchCommandChecking")
    : !trimmedLaunchCommand
      ? t("launchCommandEmpty")
      : agentCommandStatus.available
        ? t("launchCommandAvailable", { runtime: agentCommandStatus.runtimeLabel || commandCheckRuntimeLabel })
        : t("launchCommandMissing", { runtime: agentCommandStatus.runtimeLabel || commandCheckRuntimeLabel });
  const launchCommandDetailText = !trimmedLaunchCommand
    ? ""
    : agentCommandStatus.available
      ? (agentCommandStatus.resolvedPath
        ? t("launchCommandResolvedPath", { path: agentCommandStatus.resolvedPath })
        : "")
      : (agentCommandStatus.error ?? "");
  const renderAgentPane = (node: SessionPaneNode) => {
    if (node.type === "split") {
      return (
        <div key={node.id} className={`agent-split-pane ${node.axis}`}>
          <div className="agent-split-child" style={{ flex: `${node.ratio} 1 0%` }}>{renderAgentPane(node.first)}</div>
          <div className={`agent-split-divider ${node.axis}`} onPointerDown={onPaneSplitResizeStart(node.id, node.axis)} />
          <div className="agent-split-child" style={{ flex: `${1 - node.ratio} 1 0%` }}>{renderAgentPane(node.second)}</div>
        </div>
      );
    }

    const session = activeTab.sessions.find((item) => item.id === node.sessionId) ?? activePaneSession;
    const isPaneActive = activeTab.activePaneId === node.id;
    const progress = (() => {
      const ratio = sessionCompletionRatio(session);
      if (ratio > 0) return Math.max(14, ratio);
      if (session.status === "running" || session.status === "background") return 34;
      if (session.status === "waiting") return 22;
      return 6;
    })();
    const tone = session.status === "running" || session.status === "background"
      ? "live"
      : session.status === "waiting"
        ? "queued"
        : "idle";
    const statusTone = sessionTone(session.status);
    const showDraftPromptInput = isHiddenDraftPlaceholder(session);

    return (
      <section
        key={node.id}
        className={`agent-pane-card ${isPaneActive ? "active" : ""}`}
        onMouseDown={() => setActivePane(node.id, session.id)}
      >
        <div className={`surface-progress ${tone}`} aria-hidden="true">
          <span className="surface-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <div className="agent-pane-header">
          <div className="agent-pane-header-copy">
            <span className={`session-top-dot ${statusTone} ${statusTone === "active" ? "pulse" : ""}`} />
            <span className="agent-pane-title">{displaySessionTitle(session.title)}</span>
          </div>
          <div className="agent-pane-actions">
            <button
              type="button"
              className="pane-action split"
              onClick={() => splitPane(node.id, "vertical")}
              title={t("splitVertical")}
              aria-label={t("splitVertical")}
            >
              <AgentSplitHorizontalIcon />
            </button>
            <button
              type="button"
              className="pane-action split"
              onClick={() => splitPane(node.id, "horizontal")}
              title={t("splitHorizontal")}
              aria-label={t("splitHorizontal")}
            >
              <AgentSplitVerticalIcon />
            </button>
            <button type="button" className="pane-action close" onClick={() => void onCloseAgentPane(node.id, session.id)} title={t("close")}>
              <HeaderCloseIcon />
            </button>
          </div>
        </div>
        <div className="agent-pane-body" data-testid={`agent-pane-${node.id}`}>
          {showDraftPromptInput ? (
            <div className="agent-draft-launcher">
              <div className="agent-draft-launcher-card">
                <div className="agent-draft-launcher-copy">
                  <div className="agent-draft-launcher-title">{t("draftSessionPrompt")}</div>
                  <div className="agent-draft-launcher-hint">{t("draftTaskPlaceholder")}</div>
                </div>
                <form
                  className="agent-pane-input agent-draft-launcher-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void onSubmitDraftPrompt(node.id);
                  }}
                >
                  <div className="agent-compose">
                    <input
                      ref={(element) => setDraftPromptInputRef(node.id, element)}
                      className="agent-compose-field agent-draft-launcher-field"
                      value={draftPromptInputs[node.id] ?? ""}
                      onChange={(event) => setDraftPromptInputs((current) => ({
                        ...current,
                        [node.id]: event.target.value
                      }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.nativeEvent as KeyboardEvent).isComposing) {
                          event.preventDefault();
                        }
                      }}
                      placeholder={t("draftTaskPlaceholder")}
                      aria-label={t("draftTaskPlaceholder")}
                      data-testid={`agent-draft-input-${node.id}`}
                      autoFocus={isPaneActive}
                    />
                    <button
                      type="submit"
                      className="agent-send-button"
                      disabled={!draftPromptInputs[node.id]?.trim()}
                      title={t("send")}
                      aria-label={t("send")}
                    >
                      <AgentSendIcon />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <AgentStreamTerminal
              ref={(handle) => setAgentTerminalRef(node.id, handle)}
              streamId={session.id}
              stream={session.stream}
              toneKey={isPaneActive ? "active" : "inactive"}
              theme={theme}
              fontSize={editorMetrics.terminalFontSize}
              mode="interactive"
              autoFocus={isPaneActive}
              onData={(data) => {
                void onAgentTerminalData(node.id, data);
              }}
              onSize={(size) => onAgentTerminalSize(node.id, activeTab.id, session.id, size)}
            />
          )}
        </div>
      </section>
    );
  };

  return (
    <div ref={appRef} className="app" style={layoutStyle} data-theme={theme}>
      <header className={`topbar ${isSettingsRoute ? "topbar-settings" : ""}`}>
        <div className="topbar-tabs-wrap">
          {isSettingsRoute ? (
            <div className="route-topbar" data-testid="settings-topbar">
              <button className="route-topbar-back" type="button" onClick={onCloseSettings}>
                <HeaderBackIcon />
                <span>{t("backToApp")}</span>
              </button>
              <div className="route-topbar-title">{t("settings")}</div>
            </div>
          ) : (
            <div className="topbar-session-strip topbar-workspace-strip" data-testid="workspace-topbar">
              {workspaceTabs.map((item) => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`session-top-tab workspace-top-tab ${item.active ? "active" : ""} ${item.hasRunning ? "running-glow" : ""}`}
                  onClick={() => onSwitchWorkspace(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSwitchWorkspace(item.id);
                    }
                  }}
                  title={item.label}
                >
                  <span className={`session-top-dot ${item.hasRunning ? "active pulse" : "idle"}`} />
                  <span className="session-top-label">{item.label}</span>
                  {!item.active && item.unread > 0 && (
                    <span className="session-top-unread" title={`${item.unread}`} aria-label={`${item.unread}`}>
                      {item.unread > 9 ? "9+" : item.unread}
                    </span>
                  )}
                  <button
                    type="button"
                    className="session-top-close"
                    title={t("close")}
                    aria-label={t("close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveTab(item.id);
                    }}
                  >
                    <HeaderCloseIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="session-top-add"
                onClick={onAddTab}
                title={locale === "zh" ? "新建工作区" : "Add workspace"}
                aria-label={locale === "zh" ? "新建工作区" : "Add workspace"}
              >
                <HeaderAddIcon />
              </button>
            </div>
          )}
        </div>
        <div className="topbar-actions">
          {!isSettingsRoute && (
            <>
              <button
                type="button"
                className="topbar-tool topbar-tool-wide"
                onClick={openCommandPalette}
                title={locale === "zh" ? "快速操作（⌘/Ctrl+K）" : "Quick actions (⌘/Ctrl+K)"}
                aria-label={locale === "zh" ? "快速操作" : "Quick actions"}
              >
                <SearchIcon />
                <span>{locale === "zh" ? "操作" : "Actions"}</span>
              </button>
              <button className="topbar-tool" type="button" onClick={onOpenSettings} data-testid="settings-open" title={t("settings")} aria-label={t("settings")}>
                <HeaderSettingsIcon />
              </button>
            </>
          )}
        </div>
      </header>

      {isSettingsRoute ? (
        <main className="settings-route" data-testid="settings-page">
          <section className="settings-layout">
            <aside className="settings-sidebar-v2">
              <nav className="settings-nav-list" aria-label={t("settings")}>
                {settingsNavItems.map((item) => {
                  const isActive = item.id === activeSettingsPanel;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setActiveSettingsPanel(item.id);
                      }}
                    >
                      <span className="settings-nav-icon">{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <section className="settings-content-v2">
              <div className="settings-scroll-panel">
                {activeSettingsPanel === "general" ? (
                  <>
                    <div className="settings-group-card">
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("launchCommand")}</strong>
                          <span>{t("launchCommandHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <div className="settings-command-field">
                            <input
                              className="settings-inline-input"
                              value={settingsDraft.agentCommand}
                              onChange={(e) => onUpdateSettings({ agentCommand: e.target.value })}
                              placeholder={t("launchCommandPlaceholder")}
                              data-testid="settings-agent-command"
                            />
                            <div
                              className={`settings-inline-status ${launchCommandStateClass}`}
                              data-testid="settings-agent-command-status"
                            >
                              <span className="settings-inline-status-dot" aria-hidden="true" />
                              <div className="settings-inline-status-copy">
                                <span>{launchCommandStatusText}</span>
                                {launchCommandDetailText && <small>{launchCommandDetailText}</small>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("autoSuspend")}</strong>
                          <span>{t("autoSuspendHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={settingsDraft.idlePolicy.enabled}
                              onChange={() => onUpdateSettingsIdlePolicy({ enabled: !settingsDraft.idlePolicy.enabled })}
                            />
                            <span className="toggle-track"><span className="toggle-thumb" /></span>
                          </label>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("idleAfter")}</strong>
                          <span>{t("idleAfterHint")}</span>
                        </div>
                        <div className="settings-row-control settings-number-control">
                          <input
                            className="settings-inline-number"
                            type="number"
                            min={1}
                            value={settingsDraft.idlePolicy.idleMinutes}
                            onChange={(e) => onUpdateSettingsIdlePolicy({ idleMinutes: Number(e.target.value) })}
                            data-testid="settings-idle-minutes"
                          />
                          <span>{t("minutesShort")}</span>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("maxActive")}</strong>
                          <span>{t("maxActiveHint")}</span>
                        </div>
                        <div className="settings-row-control settings-number-control">
                          <input
                            className="settings-inline-number"
                            type="number"
                            min={1}
                            value={settingsDraft.idlePolicy.maxActive}
                            onChange={(e) => onUpdateSettingsIdlePolicy({ maxActive: Number(e.target.value) })}
                            data-testid="settings-max-active"
                          />
                          <span>{t("sessionsWord")}</span>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("memoryPressure")}</strong>
                          <span>{t("memoryPressureHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <label className="toggle">
                            <input
                              type="checkbox"
                              checked={settingsDraft.idlePolicy.pressure}
                              onChange={() => onUpdateSettingsIdlePolicy({ pressure: !settingsDraft.idlePolicy.pressure })}
                            />
                            <span className="toggle-track"><span className="toggle-thumb" /></span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="settings-group-card">
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("theme")}</strong>
                          <span>{locale === "zh" ? "当前版本仅保留深色主题。" : "This version uses a dark-only theme."}</span>
                        </div>
                        <div className="settings-row-control">
                          <div className="settings-pill-select single">
                            <span className="settings-pill-option active">{t("themeDark")}</span>
                          </div>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("languageLabel")}</strong>
                          <span>{t("languageHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <div className="settings-pill-select">
                            <button
                              type="button"
                              className={`settings-pill-option ${locale === "zh" ? "active" : ""}`}
                              onClick={() => onSelectLocale("zh")}
                            >
                              中文
                            </button>
                            <button
                              type="button"
                              className={`settings-pill-option ${locale === "en" ? "active" : ""}`}
                              onClick={() => onSelectLocale("en")}
                            >
                              English
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="settings-footer-bar">
                <div className="settings-page-status">
                  {t("settingsAutoSave")}
                </div>
              </div>
            </section>
          </section>
        </main>
      ) : (
      <main className="workspace-shell">
        <div className="workspace-main-header workspace-shell-header">
          <div className="workspace-main-header-copy">
            <div className="workspace-main-meta">
              <span className="workspace-main-chip">
                <WorkspaceFolderIcon />
                <span>{workspaceFolderName}</span>
              </span>
              <span className="workspace-main-chip">
                <WorkspaceBranchIcon />
                <span>{activeTab.git.branch || "—"}</span>
              </span>
              <span className="workspace-main-chip">
                <WorkspaceChangesIcon />
                <span>{t("changesCount", { count: currentFileChangeCount })}</span>
              </span>
            </div>
          </div>
          <div className="workspace-main-actions">
            <button
              type="button"
              className={`workspace-panel-toggle ${showCodePanel ? "active" : ""}`}
              onClick={() => toggleRightPane("code")}
              title={t("codePanel")}
              aria-pressed={showCodePanel}
            >
              <WorkspaceCodeIcon />
              <span>{t("codePanel")}</span>
            </button>
            <button
              type="button"
              className={`workspace-panel-toggle ${showTerminalPanel ? "active" : ""}`}
              onClick={() => toggleRightPane("terminal")}
              title={t("terminalPanel")}
              aria-pressed={showTerminalPanel}
            >
              <WorkspaceTerminalIcon />
              <span>{t("terminalPanel")}</span>
            </button>
            <span className="workspace-shortcut-hint">
              {locale === "zh" ? "⌘/Ctrl+K 快速操作" : "⌘/Ctrl+K actions"}
            </span>
          </div>
        </div>
      <div className={`workspace-stack ${isFocusMode ? "focus-mode" : ""} ${isCodeExpanded ? "code-expanded" : ""}`}>
        <div
          className="workspace-top-shell"
          style={!isCodeExpanded && showTerminalPanel ? { flex: `0 0 ${state.layout.rightSplit}%` } : undefined}
        >
          {showAgentPanel && (
            <>
              <section
                className="panel center-panel workspace-agent-shell"
                style={{ flex: "1 1 0%" }}
              >
                <div className="panel-inner studio-panel compact">
                  {isArchiveView && (
                    <div className="archive-banner">
                      <div>
                        {t("viewingArchivedSession")}
                        <div className="hint">{t("exitArchiveHint")}</div>
                      </div>
                      <button className="btn tiny" onClick={onExitArchive}>{t("exit")}</button>
                    </div>
                  )}
                  <div className="agent-pane-workspace">
                    {isArchiveView ? (
                      <section className="agent-pane-card archive-only">
                        <div className="agent-pane-header">
                          <div className="agent-pane-header-copy">
                            <span className={`session-top-dot ${sessionTone(viewedSession.status)} ${sessionTone(viewedSession.status) === "active" ? "pulse" : ""}`} />
                            <span className="agent-pane-title">{displaySessionTitle(viewedSession.title)}</span>
                          </div>
                        </div>
                        <div className="agent-pane-body">
                          {viewedSessionPlainStream.trim() ? (
                            <AgentStreamTerminal streamId={viewedSession.id} stream={viewedSession.stream} toneKey="active" theme={theme} fontSize={editorMetrics.terminalFontSize} />
                          ) : (
                            <div className="terminal-empty">{t("archiveViewReadonly")}</div>
                          )}
                        </div>
                      </section>
                    ) : (
                      renderAgentPane(activeTab.paneLayout)
                    )}
                  </div>
                </div>
              </section>

              {showCodePanel && <div className="v-resizer" data-resize="left" onPointerDown={onResizeStart("left")} />}
            </>
          )}

          {showCodePanel && (
            <section
              className="panel workspace-code-shell"
              style={isCodeExpanded ? { flex: "1 1 100%" } : { flex: `0 0 ${state.layout.rightWidth}px` }}
            >
              <div className="panel-inner workspace-code-panel">
                <div className="workspace-code-header">
                  <div className="workspace-code-modes">
                    {isCodeExpanded ? (
                      <>
                        <button
                          type="button"
                          className={`workspace-panel-toggle ${codeSidebarView === "files" ? "active" : ""}`}
                          onClick={() => setCodeSidebarView("files")}
                        >
                          <WorkspaceFolderIcon />
                          <span>{t("files")}</span>
                        </button>
                        <button
                          type="button"
                          className={`workspace-panel-toggle ${codeSidebarView === "git" ? "active" : ""}`}
                          onClick={() => setCodeSidebarView("git")}
                        >
                          <WorkspaceChangesIcon />
                          <span>Git Diff</span>
                        </button>
                        {previewPathLabel && (
                          <span className="workspace-code-current-path" title={previewPathLabel}>
                            {previewPathLabel}
                          </span>
                        )}
                      </>
                    ) : (
                      <div className="workspace-code-title-block">
                        <span className="section-kicker">{t("codePanel")}</span>
                        <strong>{previewFileName || t("selectFileFromNavigator")}</strong>
                      </div>
                    )}
                  </div>
                  <div className="workspace-code-actions">
                    <div className="workspace-search-shell" ref={fileSearchShellRef}>
                      <div className="workspace-search-field">
                        <SearchIcon />
                        <input
                          ref={fileSearchInputRef}
                          value={fileSearchQuery}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setFileSearchQuery(nextValue);
                            setFileSearchOpen(Boolean(nextValue.trim()));
                            setFileSearchActiveIndex(0);
                          }}
                          onFocus={(event) => {
                            setFileSearchOpen(Boolean(event.currentTarget.value.trim()));
                          }}
                          onBlur={onFileSearchBlur}
                          onKeyDown={onFileSearchKeyDown}
                          placeholder={locale === "zh" ? "搜索文件并跳转…" : "Search files and jump..."}
                          autoComplete="off"
                          spellCheck={false}
                          aria-expanded={showFileSearchDropdown}
                          aria-controls="workspace-file-search-results"
                          aria-activedescendant={showFileSearchDropdown ? `workspace-file-search-option-${fileSearchActiveIndex}` : undefined}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="workspace-icon-button"
                      onClick={() => { void toggleCodeExpanded(); }}
                      aria-label={isCodeExpanded ? (locale === "zh" ? "退出展开" : "Exit expand") : (locale === "zh" ? "展开代码区" : "Expand code area")}
                      title={isCodeExpanded ? (locale === "zh" ? "退出展开" : "Exit expand") : (locale === "zh" ? "展开代码区" : "Expand code area")}
                    >
                      {isCodeExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
                    </button>
                  </div>
                </div>

                <div className={`workspace-code-body ${isCodeExpanded ? "expanded" : "collapsed"}`}>
                  <div className="workspace-code-editor">
                    {hasPreviewFile ? (
                      activeTab.filePreview.mode === "diff" ? (
                        activeTab.filePreview.source === "git" && Boolean(activeTab.filePreview.section) && hasStructuredDiffContent ? (
                          <div className="editor-surface diff-editor-surface" data-testid="preview-diff-editor">
                            <DiffEditor
                              key={`${activeTab.filePreview.path}:${activeTab.filePreview.section ?? "diff"}`}
                              height="100%"
                              original={activeTab.filePreview.originalContent ?? ""}
                              modified={activeTab.filePreview.modifiedContent ?? ""}
                              originalModelPath={`${activeTab.filePreview.path}.original`}
                              modifiedModelPath={activeTab.filePreview.path}
                              language={inferEditorLanguage(activeTab.filePreview.path)}
                              theme="vs-dark"
                              options={{
                                automaticLayout: true,
                                readOnly: true,
                                renderSideBySide: true,
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                scrollbar: {
                                  verticalScrollbarSize: 6,
                                  horizontalScrollbarSize: 6,
                                  useShadows: false,
                                  alwaysConsumeMouseWheel: false
                                },
                                wordWrap: "on",
                                fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, monospace",
                                fontSize: editorMetrics.fontSize,
                                lineNumbersMinChars: 3,
                                renderWhitespace: "selection"
                              }}
                            />
                          </div>
                        ) : (
                          <pre className="diff code-surface">{activeTab.filePreview.diff || t("noDiffAvailable")}</pre>
                        )
                      ) : (
                        <div className="editor-surface" data-testid="preview-editor">
                          <Editor
                            key={activeTab.filePreview.path}
                            height="100%"
                            path={activeTab.filePreview.path}
                            language={inferEditorLanguage(activeTab.filePreview.path)}
                            value={activeTab.filePreview.content}
                            onChange={(value) => onPreviewEdit(value ?? "")}
                            theme="vs-dark"
                            options={{
                              automaticLayout: true,
                              fontFamily: "JetBrains Mono, Cascadia Mono, ui-monospace, monospace",
                              fontSize: editorMetrics.fontSize,
                              minimap: { enabled: false },
                              scrollBeyondLastLine: false,
                              scrollbar: {
                                verticalScrollbarSize: 6,
                                horizontalScrollbarSize: 6,
                                useShadows: false,
                                alwaysConsumeMouseWheel: false
                              },
                              wordWrap: "on",
                              padding: { top: editorMetrics.paddingY, bottom: editorMetrics.paddingY },
                              lineNumbersMinChars: 3,
                              renderWhitespace: "selection"
                            }}
                          />
                        </div>
                      )
                    ) : (
                      <div className="preview-empty">{t("selectFileFromNavigator")}</div>
                    )}
                  </div>

                  {isCodeExpanded && (
                    <aside className="workspace-code-sidebar">
                      {codeSidebarView === "files" ? (
                        <>
                          <div className="workspace-code-sidebar-head">
                            <span className="section-kicker">{t("repositoryNavigator")}</span>
                            <button className="workspace-icon-button bare" type="button" onClick={() => void refreshWorkspaceArtifacts(activeTab.id)} title={t("refresh")} aria-label={t("refresh")}>
                              <RefreshIcon />
                            </button>
                          </div>
                          {activeTab.fileTree.length === 0 ? (
                            <div className="tree-empty">{t("selectProjectToLoadFiles")}</div>
                          ) : (
                            <TreeView
                              nodes={activeTab.fileTree}
                              onSelect={onFileSelect}
                              collapsedPaths={repoCollapsedPaths}
                              locale={locale}
                              selectedPath={activeTab.filePreview.path}
                              rootPath={activeTab.project?.path}
                              onToggleCollapse={(path) => {
                                setRepoCollapsedPaths((current) => {
                                  const next = new Set(current);
                                  if (next.has(path)) {
                                    next.delete(path);
                                  } else {
                                    next.add(path);
                                  }
                                  return next;
                                });
                              }}
                            />
                          )}
                        </>
                      ) : (
                        <div className="workspace-git-sidebar">
                          <div className="workspace-code-sidebar-head git-sidebar-head">
                            <span className="section-kicker">{t("sourceControl")}</span>
                            <div className="git-toolbar-actions">
                              <button className="workspace-icon-button bare" type="button" onClick={() => void refreshWorkspaceArtifacts(activeTab.id)} title={t("refresh")} aria-label={t("refresh")}>
                                <RefreshIcon />
                              </button>
                              <button className="workspace-icon-button bare" type="button" onClick={() => void onGitStageAll()} title={t("stageAll")} aria-label={t("stageAll")}>
                                <GitStageIcon />
                              </button>
                              <button className="workspace-icon-button bare" type="button" onClick={() => void onGitUnstageAll()} title={t("unstageAll")} aria-label={t("unstageAll")}>
                                <GitUnstageIcon />
                              </button>
                              <button className="workspace-icon-button bare" type="button" onClick={() => void onGitDiscardAll()} title={t("discardAll")} aria-label={t("discardAll")}>
                                <GitDiscardIcon />
                              </button>
                              <button className="workspace-icon-button bare" type="button" onClick={() => void onGitCommit()} disabled={!commitMessage.trim()} title={t("commit")} aria-label={t("commit")}>
                                <AgentSendIcon />
                              </button>
                            </div>
                          </div>
                          <div className="workspace-git-compose">
                            <div className="form-row">
                              <input
                                value={commitMessage}
                                onChange={(e) => setCommitMessage(e.target.value)}
                                placeholder={t("commitPlaceholder")}
                                data-testid="git-commit-message"
                                className="workspace-git-commit-input"
                              />
                            </div>
                          </div>
                          <div className="source-control-list">
                            {gitChangeGroups.length === 0 && <div className="tree-empty">{t("noChangesDetected")}</div>}
                            {gitChangeGroups.map((group) => (
                              <div key={group.key} className="source-group">
                                <div className="source-group-head">
                                  <span>{group.label}</span>
                                  <span>{group.items.length}</span>
                                </div>
                                <div className="source-group-items">
                                  {group.items.map((change) => {
                                    const changeKey = `${change.section}:${change.path}:${change.code}`;
                                    const rowActions = change.section === "staged"
                                      ? [{ id: "unstage" as const, title: t("unstageFile"), icon: <GitUnstageIcon /> }]
                                      : [
                                        { id: "stage" as const, title: t("stageFile"), icon: <GitStageIcon /> },
                                        { id: "discard" as const, title: t("discardFile"), icon: <GitDiscardIcon /> }
                                      ];
                                    return (
                                      <div
                                        key={changeKey}
                                        role="button"
                                        tabIndex={0}
                                        className={`source-change-row ${activeGitChangeKey === changeKey ? "active" : ""}`}
                                        data-section={change.section}
                                        onClick={() => void onGitChangeSelect(change)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            void onGitChangeSelect(change);
                                          }
                                        }}
                                      >
                                        <span className="source-change-file-icon" aria-hidden="true">
                                          {getFileIcon(change.name, false, false)}
                                        </span>
                                        <span className="source-change-copy">
                                          <span className="source-change-name">{change.name}</span>
                                          <span className="source-change-parent">{change.parent || "."}</span>
                                        </span>
                                        <span className="source-change-tail">
                                          <span className={`source-status-badge ${change.section}`} title={change.status}>{change.code}</span>
                                          <span className="source-change-actions">
                                            {rowActions.map((action) => (
                                              <button
                                                key={action.id}
                                                type="button"
                                                className="source-action-btn"
                                                title={action.title}
                                                aria-label={action.title}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void onGitChangeAction(change, action.id);
                                                }}
                                              >
                                                {action.icon}
                                              </button>
                                            ))}
                                          </span>
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </aside>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>

        {!isCodeExpanded && showTerminalPanel && (
          <>
            <div
              className="h-resizer workspace-bottom-splitter"
              data-resize="right-split"
              onPointerDown={onResizeStart("right-split")}
            />
            <section className="panel workspace-terminal-shell">
              <div className="panel-inner terminal-card workspace-terminal-panel">
                <div className={`surface-progress ${terminalProgressTone}`} aria-hidden="true">
                  <span className="surface-progress-bar" style={{ width: `${terminalProgressPercent}%` }} />
                </div>
                <div className="terminal-toolbar">
                  <div className="terminal-toolbar-title">{t("terminalPanel")}</div>
                  <div className="terminal-toolbar-actions">
                    <select
                      className="terminal-select"
                      value={activeTerminal?.id ?? ""}
                      onChange={(event) => onTerminalSelect(event.target.value)}
                    >
                      {activeTab.terminals.map((term) => (
                        <option key={term.id} value={term.id}>
                          {displayTerminalTitle(term.title)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="workspace-icon-button"
                      onClick={() => activeTerminal && void onCloseTerminal(activeTerminal.id)}
                      disabled={!activeTerminal}
                      title={t("close")}
                      aria-label={t("close")}
                    >
                      <HeaderCloseIcon />
                    </button>
                    <button
                      type="button"
                      className="workspace-icon-button"
                      onClick={() => void onAddTerminal()}
                      title={t("new")}
                      aria-label={t("new")}
                    >
                      <HeaderAddIcon />
                    </button>
                  </div>
                </div>
                <div className="terminal-output">
                  {activeTerminal ? (
                    <ShellTerminal
                      ref={shellTerminalRef}
                      terminalId={activeTerminal.id}
                      output={activeTerminal.output ?? ""}
                      theme={theme}
                      fontSize={editorMetrics.terminalFontSize}
                      onData={onShellTerminalData}
                      onSize={onShellTerminalSize}
                      autoFocus={showTerminalPanel && !isCodeExpanded}
                    />
                  ) : (
                    <div className="terminal-empty">{t("noTerminalYet")}</div>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      </main>
      )}

      {showFileSearchDropdown && fileSearchDropdownStyle && appRef.current && createPortal(
        <div
          className={`workspace-search-dropdown floating ${fileSearchDropdownStyle.placement}`}
          id="workspace-file-search-results"
          role="listbox"
          style={{
            left: fileSearchDropdownStyle.left,
            width: fileSearchDropdownStyle.width,
            maxHeight: fileSearchDropdownStyle.maxHeight,
            top: fileSearchDropdownStyle.top,
            bottom: fileSearchDropdownStyle.bottom
          }}
        >
          {fileSearchResults.length === 0 ? (
            <div className="workspace-search-empty">{locale === "zh" ? "未找到匹配文件" : "No matching files"}</div>
          ) : (
            fileSearchResults.map(({ node }, index) => (
              <button
                key={node.absolutePath}
                id={`workspace-file-search-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === fileSearchActiveIndex}
                tabIndex={-1}
                className={`code-search-result ${index === fileSearchActiveIndex ? "active" : ""}`}
                onMouseEnter={() => setFileSearchActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  void onFileSearchSelect(node);
                }}
              >
                <span className="code-search-result-name">{node.name}</span>
                <span className="code-search-result-path">{fileParentLabel(node.path) || "."}</span>
              </button>
            ))
          )}
        </div>,
        appRef.current
      )}

      {commandPaletteOpen && (
        <div
          className="command-palette-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCommandPalette();
            }
          }}
        >
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={locale === "zh" ? "快速操作面板" : "Quick actions palette"}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="command-palette-search-row">
              <SearchIcon />
              <input
                ref={commandPaletteInputRef}
                className="command-palette-search-input"
                value={commandPaletteQuery}
                onChange={(event) => setCommandPaletteQuery(event.target.value)}
                placeholder={locale === "zh" ? "搜索操作、面板或工作区…" : "Search actions, panels, or workspaces..."}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandPaletteActiveIndex((index) => {
                      if (!filteredCommandPaletteActions.length) return 0;
                      return Math.min(index + 1, filteredCommandPaletteActions.length - 1);
                    });
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandPaletteActiveIndex((index) => Math.max(index - 1, 0));
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onRunCommandPaletteAction(activeCommandPaletteAction);
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeCommandPalette();
                  }
                }}
              />
            </div>
            <div className="command-palette-results">
              {filteredCommandPaletteActions.length === 0 ? (
                <div className="command-palette-empty">
                  {locale === "zh" ? "未找到匹配操作" : "No matching actions"}
                </div>
              ) : (
                filteredCommandPaletteActions.map((action, index) => (
                  <button
                    key={action.id}
                    type="button"
                    className={`command-palette-item ${index === commandPaletteActiveIndex ? "active" : ""}`}
                    onMouseEnter={() => setCommandPaletteActiveIndex(index)}
                    onClick={() => onRunCommandPaletteAction(action)}
                  >
                    <span className="command-palette-item-copy">
                      <span className="command-palette-item-label">{action.label}</span>
                      <span className="command-palette-item-description">{action.description}</span>
                    </span>
                    {action.shortcut && <span className="command-palette-shortcut">{action.shortcut}</span>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map((toast) => (
          <button key={toast.id} className="toast" onClick={() => onSwitchSession(toast.sessionId)}>
            {toast.text}
          </button>
        ))}
      </div>

      {worktreeModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>{worktreeModal.name}</h3>
              <button className="btn tiny" onClick={() => setWorktreeModal(null)}>{t("close")}</button>
            </div>
            <div className="file-tabs">
              {(["status", "diff", "tree"] as const).map((view) => (
                <div
                  key={view}
                  className={`t-tab ${worktreeView === view ? "active" : ""}`}
                  onClick={() => setWorktreeView(view)}
                >
                  {view === "status" ? t("statusTab") : view === "diff" ? t("diff") : t("treeTab")}
                </div>
              ))}
            </div>
            <div className="modal-body">
              {worktreeModal.loading && <div className="empty">{t("loadingWorktreeDetails")}</div>}
              {worktreeView === "status" && (
                <div>
                  <div className="muted">{t("path")}: {worktreeModal.path}</div>
                  <div className="muted">{t("branch")}: {worktreeModal.branch}</div>
                  <div className="status">{worktreeModal.status || t("clean")}</div>
                </div>
              )}
              {worktreeView === "diff" && (
                <pre className="diff">{worktreeModal.diff || t("noDiffAvailable")}</pre>
              )}
              {worktreeView === "tree" && (
                <TreeView
                  nodes={worktreeModal.tree ?? []}
                  onSelect={onFileSelect}
                  collapsedPaths={worktreeCollapsedPaths}
                  locale={locale}
                  onToggleCollapse={(path) => {
                    setWorktreeCollapsedPaths((current) => {
                      const next = new Set(current);
                      if (next.has(path)) {
                        next.delete(path);
                      } else {
                        next.add(path);
                      }
                      return next;
                    });
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {state.overlay.visible && (
        <div className="overlay" data-testid="overlay">
          <div className="modal onboarding-modal">
            <div className="onboarding-form">
              <div className="onboarding-header">
              <div className="section-kicker">{t("launchWorkspace")}</div>
              <h2>{t("launchWorkspaceTitle")}</h2>
              <p>{t("launchWorkspaceDescription")}</p>
              </div>
              <div className="choice-grid">
                <div className={`choice ${state.overlay.mode === "remote" ? "active" : ""}`} onClick={() => onOverlaySelectMode("remote")} data-testid="choice-remote">
                  <strong>{t("remoteGit")}</strong>
                  <div className="hint">{t("remoteGitHint")}</div>
                </div>
                <div className={`choice ${state.overlay.mode === "local" ? "active" : ""}`} onClick={() => onOverlaySelectMode("local")} data-testid="choice-local">
                  <strong>{t("localFolder")}</strong>
                  <div className="hint">{t("localFolderHint")}</div>
                </div>
              </div>
            {overlayCanUseWsl && (
              <div className="choice-grid small">
                <div className={`choice ${state.overlay.target.type === "native" ? "active" : ""}`} onClick={() => onOverlayUpdateTarget({ type: "native" })}>
                  <strong>{t("nativeTarget")}</strong>
                  <div className="hint">{t("nativeTargetHint")}</div>
                </div>
                <div className={`choice ${state.overlay.target.type === "wsl" ? "active" : ""}`} onClick={() => onOverlayUpdateTarget({ type: "wsl" })}>
                  <strong>WSL</strong>
                  <div className="hint">{t("wslHint")}</div>
                </div>
              </div>
            )}
            {overlayCanUseWsl && state.overlay.target.type === "wsl" && (
              <input
                value={state.overlay.target.distro ?? ""}
                onChange={(e) => onOverlayUpdateTarget({ type: "wsl", distro: e.target.value })}
                placeholder={t("optionalDistroPlaceholder")}
              />
            )}
            {state.overlay.mode === "remote" ? (
              <input
                value={state.overlay.input}
                onChange={(e) => onOverlayUpdateInput(e.target.value)}
                placeholder={t("pasteGitUrl")}
                data-testid="git-input"
              />
            ) : (
              <div className="local-picker web-folder-picker" data-testid="folder-select">
                <div className="web-folder-picker-toolbar">
                  <div className="web-folder-picker-paths">
                    <div className="hint">{locale === "zh" ? "浏览位置" : "Browsing"}</div>
                    <strong>{folderBrowser.currentPath || state.overlay.input || (locale === "zh" ? "正在加载…" : "Loading...")}</strong>
                    <div className="hint" data-testid="folder-selected">{t("selected")}: {state.overlay.input || t("notSelected")}</div>
                  </div>
                  <div className="web-folder-picker-actions">
                    <button className="btn tiny ghost" type="button" onClick={() => onBrowseOverlayDirectory(folderBrowser.homePath || undefined, true)} disabled={folderBrowser.loading}>
                      {locale === "zh" ? "Home" : "Home"}
                    </button>
                    <button className="btn tiny ghost" type="button" onClick={() => onBrowseOverlayDirectory(folderBrowser.parentPath)} disabled={folderBrowser.loading || !folderBrowser.parentPath}>
                      {locale === "zh" ? "上一级" : "Up"}
                    </button>
                    <button className="btn tiny primary" type="button" onClick={() => onSelectOverlayDirectory(folderBrowser.currentPath)} disabled={!folderBrowser.currentPath}>
                      {locale === "zh" ? "选择当前目录" : "Use Current Folder"}
                    </button>
                  </div>
                </div>
                {folderBrowser.notice && <div className="folder-browser-notice">{folderBrowser.notice}</div>}

                <div className="web-folder-picker-roots">
                  {folderBrowser.roots.map((root) => (
                    <button
                      key={root.id}
                      type="button"
                      className={`folder-root-chip ${state.overlay.input === root.path || folderBrowser.currentPath === root.path ? "active" : ""}`}
                      onClick={() => onBrowseOverlayDirectory(root.path, true)}
                    >
                      <span>{root.label}</span>
                      <small>{root.description}</small>
                    </button>
                  ))}
                </div>

                <div className="web-folder-picker-list">
                  {folderBrowser.loading && <div className="tree-empty">{locale === "zh" ? "正在读取服务端目录…" : "Loading server directories..."}</div>}
                  {!folderBrowser.loading && folderBrowser.error && <div className="tree-empty">{folderBrowser.error}</div>}
                  {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.length === 0 && (
                    <div className="tree-empty">{locale === "zh" ? "当前目录下没有可进入的子目录" : "No subdirectories in this location"}</div>
                  )}
                  {!folderBrowser.loading && !folderBrowser.error && folderBrowser.entries.map((entry) => (
                    <div key={entry.path} className={`folder-browser-row ${state.overlay.input === entry.path ? "selected" : ""}`}>
                      <button type="button" className="folder-browser-open" onClick={() => onBrowseOverlayDirectory(entry.path)}>
                        <WorkspaceFolderIcon />
                        <span>{entry.name}</span>
                      </button>
                      <button type="button" className="btn tiny ghost" onClick={() => onSelectOverlayDirectory(entry.path)}>
                        {locale === "zh" ? "选择" : "Select"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={onOverlayCancel}>{t("cancel")}</button>
              <button className="btn primary" onClick={onStartWorkspace} data-testid="start-workspace">{t("startWorkspace")}</button>
            </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

type TreeProps = {
  nodes: TreeNode[];
  depth?: number;
  onSelect?: (node: TreeNode) => void;
  collapsedPaths?: Set<string>;
  onToggleCollapse?: (path: string) => void;
  locale?: Locale;
  selectedPath?: string;
  rootPath?: string;
};

const TreeView = ({ nodes, depth = 0, onSelect, collapsedPaths, onToggleCollapse, locale = "en", selectedPath, rootPath }: TreeProps) => {
  if (!nodes?.length) return null;
  const sortedNodes = sortTreeNodes(nodes, locale);
  return (
    <div className="tree tree-list">
      {sortedNodes.map((node) => {
        const isDirectory = node.kind === "dir";
        const isExpanded = isDirectory ? collapsedPaths?.has(node.path) ?? false : false;
        const isSelected = !isDirectory && Boolean(selectedPath) && normalizeComparablePath(rootPath ? resolvePath(rootPath, node.path) : node.path) === normalizeComparablePath(selectedPath);
        return (
          <div key={node.path} className="tree-node">
            <div
              className={`tree-line ${node.kind === "file" ? "file" : "dir"} ${node.status ? "changed" : ""} ${isSelected ? "selected" : ""}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                if (isDirectory) {
                  onToggleCollapse?.(node.path);
                  return;
                }
                onSelect?.(node);
              }}
            >
              <span className="tree-disclosure">
                {isDirectory ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : null}
              </span>
              <span className="tree-icon">
                {getFileIcon(node.name, isDirectory, isExpanded)}
              </span>
              <span className="tree-label">{node.name}</span>
              {node.status && <span className="status">{node.status}</span>}
            </div>
            {node.children?.length && isExpanded ? (
              <div className="tree-children">
                <TreeView
                  nodes={node.children}
                  depth={depth + 1}
                  onSelect={onSelect}
                  collapsedPaths={collapsedPaths}
                  onToggleCollapse={onToggleCollapse}
                  locale={locale}
                  selectedPath={selectedPath}
                  rootPath={rootPath}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
