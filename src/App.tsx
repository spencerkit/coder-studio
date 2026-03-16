import { useEffect, useMemo, useRef, useState } from "react";
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
  AgentPlusIcon,
  AgentSendIcon,
  GitDiscardIcon,
  GitStageIcon,
  GitUnstageIcon,
  HeaderAddIcon,
  HeaderBackIcon,
  HeaderCloseIcon,
  HeaderSettingsIcon,
  RailFilesIcon,
  RailGitIcon,
  RailSessionsIcon,
  SettingsAppearanceIcon,
  SettingsArchiveIcon,
  SettingsConfigIcon,
  SettingsEnvironmentIcon,
  SettingsGeneralIcon,
  SettingsGitIcon,
  SettingsMcpIcon,
  SettingsWorktreeIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
  WorkspaceBranchIcon,
  WorkspaceChangesIcon,
  WorkspaceCodeIcon,
  WorkspaceFolderIcon,
  WorkspaceTerminalIcon
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

type AppSettings = {
  agentProvider: Tab["agent"]["provider"];
  agentCommand: string;
  idlePolicy: Tab["idlePolicy"];
};

type AppTheme = "dark" | "light";
type AppRoute = "workspace" | "settings";
type SettingsPanel = "general" | "appearance";

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";
const APP_THEME_STORAGE_KEY = "coder-studio.app-theme";
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

const readStoredTheme = (): AppTheme => {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    // Ignore storage failures and fall back to media preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

const readCurrentRoute = (): AppRoute => {
  if (typeof window === "undefined") return "workspace";
  return window.location.hash === SETTINGS_ROUTE_HASH ? "settings" : "workspace";
};

const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const sanitizeAnsiStream = (value: string) => {
  if (!value) return value;
  return value
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
    .replace(/\x1b\[(?![0-9;:]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?!\[)/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "");
};

const sanitizeAnsiForTerminal = (value: string) => {
  if (!value) return value;
  return value
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
    .replace(/[\u0000\u000B\u000C\u000E-\u001A\u001C-\u001F\u007F]/g, "");
};

const stripAnsi = (value: string) => {
  if (!value) return value;
  return sanitizeAnsiStream(value).replace(/\x1b\[[0-9;:]*m/g, "");
};

type AgentStreamTerminalProps = {
  stream: string;
  theme: AppTheme;
  fontSize: number;
};

const readAgentTerminalTheme = (source?: Element | null) => {
  if (typeof window === "undefined") {
    return { background: "black", foreground: "white" };
  }
  const styles = window.getComputedStyle((source as Element | null) ?? document.documentElement);
  const rootStyles = window.getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--terminal-bg").trim() || rootStyles.getPropertyValue("--terminal-bg").trim() || "black";
  const foreground = styles.getPropertyValue("--terminal-fg").trim() || rootStyles.getPropertyValue("--terminal-fg").trim() || "white";
  return { background, foreground };
};

const writeXtermSnapshot = (term: XTerminal, previous: string, next: string) => {
  if (next === previous) return;
  if (next.startsWith(previous)) {
    const delta = next.slice(previous.length);
    if (delta) term.write(delta);
    return;
  }
  term.reset();
  if (next) term.write(next);
};

const AgentStreamTerminal = ({ stream, theme, fontSize }: AgentStreamTerminalProps) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const outputSnapshotRef = useRef("");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!termRef.current) {
      const term = new XTerminal({
        convertEol: true,
        disableStdin: true,
        cursorBlink: false,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
        fontSize,
        theme: readAgentTerminalTheme(mount.closest(".app"))
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(mount);
      termRef.current = term;
      fitRef.current = fitAddon;
      outputSnapshotRef.current = "";
    }

    const term = termRef.current;
    if (!term) return;
    const normalized = sanitizeAnsiForTerminal(stream);
    term.options = {
      fontSize,
      theme: readAgentTerminalTheme(mount.closest(".app"))
    };
    writeXtermSnapshot(term, outputSnapshotRef.current, normalized);
    outputSnapshotRef.current = normalized;
    requestAnimationFrame(() => fitRef.current?.fit());
  }, [stream, fontSize, theme]);

  useEffect(() => {
    const mount = mountRef.current;
    const fitAddon = fitRef.current;
    if (!mount || !fitAddon) return;
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(mount);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
    outputSnapshotRef.current = "";
  }, []);

  return <div ref={mountRef} className="agent-pane-xterm" />;
};

const showWslOption = (() => {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  const isMac = platform.includes("mac");
  const isWindows = platform.includes("win");
  const isLinux = platform.includes("linux");
  const isWsl = isLinux && (ua.includes("microsoft") || ua.includes("wsl"));
  if (isMac || isWsl || isLinux) return false;
  return isWindows;
})();

const safeInvoke = async <T,>(command: string, payload: Record<string, unknown>, fallback: T): Promise<T> => {
  if (!isTauri) {
    return fallback;
  }
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

const sessionStatusLabel = (status: SessionStatus, t: Translator) => {
  switch (status) {
    case "idle":
      return t("idle");
    case "running":
      return t("running");
    case "background":
      return t("background");
    case "waiting":
      return t("waiting");
    case "suspended":
      return t("suspended");
    case "queued":
      return t("queued");
    default:
      return status;
  }
};

const queueTaskStatusLabel = (status: BackendQueueTask["status"], t: Translator) => {
  switch (status) {
    case "running":
      return t("running");
    case "done":
      return t("done");
    default:
      return t("queued");
  }
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

const sessionTitleFromInput = (value: string) => {
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? value.trim();
  if (firstLine.length <= 48) return firstLine;
  return `${firstLine.slice(0, 45)}...`;
};

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

const activeTaskForSession = (session: Session) => session.queue.find((task) => task.status === "running");

const isForegroundActiveStatus = (status: SessionStatus) => status === "running" || status === "waiting";

const toBackgroundStatus = (status: SessionStatus): SessionStatus => (isForegroundActiveStatus(status) ? "background" : status);

const restoreVisibleStatus = (session: Session): SessionStatus => {
  if (session.status !== "background") return session.status;
  return activeTaskForSession(session) ? "running" : "waiting";
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

export default function App() {
  const [state, setState] = useRelaxState(workbenchState);
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readStoredAppSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() => readStoredAppSettings());
  const [route, setRoute] = useState<AppRoute>(() => readCurrentRoute());
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("general");
  const [queueInput, setQueueInput] = useState("");
  const [paneInputs, setPaneInputs] = useState<Record<string, string>>({});
  const [commitMessage, setCommitMessage] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [worktreeModal, setWorktreeModal] = useState<WorktreeModalState | null>(null);
  const [worktreeView, setWorktreeView] = useState<"status" | "diff" | "tree">("status");
  const [previewMode, setPreviewMode] = useState<"preview" | "diff">("preview");
  const [leftRailView, setLeftRailView] = useState<"sessions" | "files" | "git">("sessions");
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
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalMountRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const xtermFitRef = useRef<FitAddon | null>(null);
  const terminalOutputRef = useRef<{ id?: string; snapshot: string }>({ snapshot: "" });
  const terminalSizeRef = useRef<{ id?: string; cols: number; rows: number }>({ cols: 0, rows: 0 });
  const paneInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
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

  const readTerminalTheme = () => {
    if (typeof window === "undefined") {
      return { background: "black", foreground: "white" };
    }
    const source = appRef.current ?? document.documentElement;
    const styles = window.getComputedStyle(source);
    const rootStyles = window.getComputedStyle(document.documentElement);
    const background = styles.getPropertyValue("--terminal-bg").trim();
    const foreground = styles.getPropertyValue("--terminal-fg").trim();
    return {
      background: background || rootStyles.getPropertyValue("--terminal-bg").trim() || "black",
      foreground: foreground || rootStyles.getPropertyValue("--terminal-fg").trim() || "white"
    };
  };

  const syncTerminalSize = (term: XTerminal, terminalId = activeTerminal?.id) => {
    if (!isTauri || !activeTab.id || !terminalId) return;
    const numericId = Number(terminalId.replace("term-", ""));
    if (!Number.isFinite(numericId)) return;
    const last = terminalSizeRef.current;
    if (last.id === terminalId && last.cols === term.cols && last.rows === term.rows) return;
    terminalSizeRef.current = { id: terminalId, cols: term.cols, rows: term.rows };
    void invoke("terminal_resize", {
      tabId: activeTab.id,
      terminalId: numericId,
      cols: term.cols,
      rows: term.rows
    });
  };

  const updateState = (updater: (current: WorkbenchState) => WorkbenchState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
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
    persistWorkbenchState(state);
  }, [state]);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
      } catch {
        // Ignore storage failures and keep in-memory theme state.
      }
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    persistAppSettings(appSettings);
  }, [appSettings]);

  useEffect(() => {
    syncGlobalSettings(appSettings);
  }, []);

  useEffect(() => {
    if (!showWslOption && stateRef.current.overlay.target.type === "wsl") {
      updateState((current) => ({
        ...current,
        overlay: { ...current.overlay, target: { type: "native" } }
      }));
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<AgentEvent>("agent://event", (event) => {
      const { tab_id, session_id, kind, data } = event.payload;
      const cleaned = stripAnsi(data);
      const styledChunk = sanitizeAnsiForTerminal(data);
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
                  ? `\n[${cleaned}]\n`
                  : kind === "stderr"
                    ? (styledChunk ? `\n[stderr] ${styledChunk}` : "")
                    : styledChunk;
              const MAX_AGENT_CHARS = 200000;
              const nextStream = `${session.stream}${streamChunk}`.slice(-MAX_AGENT_CHARS);
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
        void settleSessionAfterExit(tab_id, session_id);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<AgentLifecycleEvent>("agent://lifecycle", (event) => {
      const { tab_id, session_id, kind, data } = event.payload;
      let nextStatus: SessionStatus | null = null;
      if (kind === "turn_waiting" || kind === "approval_required") {
        nextStatus = "waiting";
      } else if (kind === "tool_started" || kind === "tool_finished") {
        nextStatus = "running";
      } else if (kind === "turn_completed" || kind === "session_ended") {
        nextStatus = "idle";
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
        void completeRunningTask(tab_id, session_id);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<TerminalEvent>("terminal://event", (event) => {
      const { tab_id, terminal_id, data } = event.payload;
      if (!data) return;
      const termId = `term-${terminal_id}`;
      const MAX_TERM_CHARS = 200000;
      updateState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) => {
          if (tab.id !== tab_id) return tab;
          return {
            ...tab,
            terminals: tab.terminals.map((term) => {
              if (term.id !== termId) return term;
              const nextOutput = `${term.output}${data}`.slice(-MAX_TERM_CHARS);
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
  const activePaneSessionId = useMemo(
    () => findPaneSessionId(activeTab.paneLayout, activeTab.activePaneId) ?? activeTab.activeSessionId,
    [activeTab]
  );
  const activePaneSession = useMemo(
    () => activeTab.sessions.find((session) => session.id === activePaneSessionId) ?? activeSession,
    [activePaneSessionId, activeSession, activeTab.sessions]
  );
  const paneLeaves = useMemo(() => collectPaneLeaves(activeTab.paneLayout), [activeTab.paneLayout]);

  const displayWorkspaceTitle = (value: string) => localizeWorkspaceTitle(value, locale);
  const displaySessionTitle = (value: string) => localizeSessionTitle(value, locale);
  const displayTerminalTitle = (value: string) => localizeTerminalTitle(value, locale);
  const hasPreviewFile = Boolean(activeTab.filePreview.path);

  const archivedEntry = activeTab.viewingArchiveId
    ? activeTab.archive.find((entry) => entry.id === activeTab.viewingArchiveId)
    : undefined;
  const sessionForView = archivedEntry ? archivedEntry.snapshot : activeSession;
  const isArchiveView = Boolean(archivedEntry);
  const queueSession = isArchiveView ? sessionForView : activeSession;
  const queuePlainStream = stripAnsi(queueSession.stream);

  const addToast = (toast: Toast) => {
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 4000);
  };

  const invokeAgent = async (command: string, payload: Record<string, unknown>, sessionId: string, label: string) => {
    if (!isTauri) return true;
    try {
      await invoke(command, payload);
      return true;
    } catch (error) {
      addToast({
        id: createId("toast"),
        text: `${label}: ${String(error)}`,
        sessionId
      });
      return false;
    }
  };

  const loadSlashSkills = async (cwd?: string) => {
    if (!isTauri) {
      setSlashSkillItems([]);
      return;
    }
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
    if (isTauri) {
      const created = await safeInvoke<BackendSession | null>("create_session", { tabId, mode: currentSession.mode }, null);
      if (created) {
        nextSession = createSessionFromBackend(created, locale);
      }
    }

    const title = sessionTitleFromInput(firstInput);
    let tabSnapshot: Tab | null = null;
    let sessionSnapshot: Session | null = null;
    updateTab(tabId, (tab) => {
      const draftSession = tab.sessions.find((session) => session.id === sessionId);
      if (!draftSession) return tab;
      const baseSession = nextSession ?? createSession(tab.sessions.length + 1, draftSession.mode, locale);
      const preparedSession: Session = {
        ...baseSession,
        title,
        status: baseSession.status === "queued" ? "queued" : "waiting",
        mode: draftSession.mode,
        autoFeed: draftSession.autoFeed,
        isDraft: false,
        queue: draftSession.queue,
        messages: [
          ...draftSession.messages,
          { id: createId("msg"), role: "user", content: firstInput, time: nowLabel() }
        ],
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
    if (!isTauri) return;
    const snapshot = await safeInvoke<TabSnapshot | null>("tab_snapshot", { tabId }, null);
    if (!snapshot) return;
    updateTab(tabId, (tab) => {
      const nextSessions = snapshot.sessions.map((session) => {
        const existing = tab.sessions.find((item) => parseNumericId(item.id) === session.id);
        return createSessionFromBackend(session, locale, existing);
      });
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
        activeSessionId: String(snapshot.active_session_id),
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
    if (!tab || !path || !target) return;

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
  };

  const syncSessionPatch = async (tabId: string, sessionId: string, patch: SessionPatch) => {
    if (!isTauri) return;
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
    if (isTauri && backendSessionId !== null) {
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
    await refreshWorkspaceArtifacts(overlay.tabId);

    const refreshedTab = stateRef.current.tabs.find((tab) => tab.id === overlay.tabId);
    const firstFile = flattenTree(refreshedTab?.fileTree ?? [])[0];
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
    return invokeAgent("agent_start", {
      tabId: tab.id,
      sessionId: session.id,
      provider: tab.agent.provider,
      command,
      claudeSessionId: session.claudeSessionId,
      cwd,
      target
    }, session.id, t("agentStartFailed"));
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
    await invokeAgent("agent_send", {
      tabId: tab.id,
      sessionId: session.id,
      input,
      appendNewline: true
    }, session.id, t("agentSendFailed"));
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
    await invokeAgent("agent_send", {
      tabId: tab.id,
      sessionId: session.id,
      input,
      appendNewline: false
    }, session.id, t("agentKeySendFailed"));
  };

  const onNewSession = async () => {
    const currentTab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeTabId);
    if (!currentTab) return;
    const mode: SessionMode = "branch";
    updateTab(currentTab.id, (tab) => {
      const newSession = createDraftSessionForTab(tab, mode);
      const updatedSessions: Session[] = tab.sessions
        .filter((s) => !isDraftSession(s))
        .map((s) =>
        s.id === tab.activeSessionId ? { ...s, status: toBackgroundStatus(s.status) } : s
      );
      return {
        ...tab,
        sessions: [newSession, ...updatedSessions],
        activeSessionId: newSession.id,
        paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
          ...leaf,
          sessionId: newSession.id
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
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      activeSessionId: sessionId,
      paneLayout: replacePaneNode(tab.paneLayout, tab.activePaneId, (leaf) => ({
        ...leaf,
        sessionId
      })),
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
    if (isTauri && backendSessionId !== null) {
      void safeInvoke("switch_session", { tabId: activeTab.id, sessionId: backendSessionId }, null);
    }
    if (previousActiveId !== sessionId) {
      if (previousSession && isForegroundActiveStatus(previousSession.status)) {
        void syncSessionPatch(activeTab.id, previousActiveId, { status: "background" });
      }
    }
    if (nextSession) {
      const nextStatus = restoreVisibleStatus(nextSession);
      void syncSessionPatch(activeTab.id, sessionId, {
        status: nextStatus,
        last_active_at: nextActiveAt
      });
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
    const archived = isTauri && backendSessionId !== null
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
      if (isTauri && backendSessionId !== null) {
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

  const onToggleAutoFeed = () => {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((s) => (s.id === tab.activeSessionId ? { ...s, autoFeed: !s.autoFeed } : s))
    }));
    void syncSessionPatch(activeTab.id, activeTab.activeSessionId, { auto_feed: !activeSession.autoFeed });
  };

  const onQueueAdd = async () => {
    const text = queueInput.trim();
    if (!text) return;
    let nextTaskId: string | null = null;
    const backendSessionId = parseNumericId(activeTab.activeSessionId);
    if (isTauri && backendSessionId !== null) {
      const createdTask = await safeInvoke<BackendQueueTask | null>(
        "queue_add",
        { tabId: activeTab.id, sessionId: backendSessionId, text },
        null
      );
      if (createdTask) {
        nextTaskId = String(createdTask.id);
      }
    }
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((s) =>
        s.id === tab.activeSessionId
          ? { ...s, queue: [...s.queue, { id: nextTaskId ?? createId("task"), text, status: "queued" }] }
          : s
      )
    }));
    setQueueInput("");
  };

  const completeRunningTask = async (tabId: string, sessionId: string, reason?: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    const runningTask = activeTaskForSession(session);
    if (isTauri && runningTask) {
      const backendSessionId = parseNumericId(sessionId);
      const backendTaskId = parseNumericId(runningTask.id);
      if (backendSessionId !== null && backendTaskId !== null) {
        await safeInvoke("queue_complete", { tabId, sessionId: backendSessionId, taskId: backendTaskId }, null);
      }
    }

    updateTab(tabId, (currentTab) => ({
      ...currentTab,
      sessions: currentTab.sessions.map((currentSession) => {
        if (currentSession.id !== sessionId) return currentSession;
        const queue: Session["queue"] = currentSession.queue.map((task) =>
          task.status === "running" ? { ...task, status: "done" } : task
        );
        const completedTask = currentSession.queue.find((task) => task.status === "running");
        const nextUnread = currentSession.id === currentTab.activeSessionId ? 0 : currentSession.unread + 1;
        return {
          ...currentSession,
          status: "idle",
          queue,
          unread: nextUnread,
          lastActiveAt: Date.now(),
          messages: completedTask
            ? [
                ...currentSession.messages,
                {
                  id: createId("msg"),
                  role: "agent",
                  content: reason ?? t("taskCompleteMessage", { text: completedTask.text }),
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

    if (updatedTab.activeSessionId !== sessionId && runningTask) {
      addToast({
        id: createId("toast"),
        text: t("taskCompletedToast", { title: displaySessionTitle(updatedSession.title) }),
        sessionId
      });
    }

    const nextTask = updatedSession.queue.find((task) => task.status === "queued");
    if (updatedSession.autoFeed && nextTask) {
      setTimeout(() => {
        void runTask(tabId, sessionId, nextTask.id);
      }, 320);
    }
  };

  const settleSessionAfterExit = async (tabId: string, sessionId: string) => {
    const tab = stateRef.current.tabs.find((item) => item.id === tabId);
    const session = tab?.sessions.find((item) => item.id === sessionId);
    if (!tab || !session) return;

    if (activeTaskForSession(session)) {
      await completeRunningTask(tabId, sessionId, t("agentExited"));
      return;
    }

    if (session.status !== "idle") {
      updateTab(tabId, (currentTab) => ({
        ...currentTab,
        sessions: currentTab.sessions.map((currentSession) =>
          currentSession.id === sessionId
            ? { ...currentSession, status: "idle", lastActiveAt: Date.now() }
            : currentSession
        )
      }));
      void syncSessionPatch(tabId, sessionId, { status: "idle", last_active_at: Date.now() });
    }
  };

  const onSessionEnd = async () => {
    if (isDraftSession(activeSession)) {
      await onArchiveSession(activeSession.id);
      return;
    }
    await completeRunningTask(activeTab.id, activeTab.activeSessionId);
  };

  const onStopAgent = async () => {
    if (isDraftSession(activeSession)) return;
    if (isTauri) {
      await safeInvoke("agent_stop", { tabId: activeTab.id, sessionId: activeTab.activeSessionId }, null);
    }
    await completeRunningTask(activeTab.id, activeTab.activeSessionId, t("taskStopped"));
  };

  const runTask = async (tabId: string, sessionId: string, taskId: string) => {
    const tabSnapshot = stateRef.current.tabs.find((t) => t.id === tabId);
    const sessionSnapshot = tabSnapshot?.sessions.find((s) => s.id === sessionId);
    if (!tabSnapshot || !sessionSnapshot) return;
    if (activeTaskForSession(sessionSnapshot)) return;
    const taskText = sessionSnapshot?.queue.find((task) => task.id === taskId)?.text ?? "task";

    if (isTauri) {
      const backendSessionId = parseNumericId(sessionId);
      const backendTaskId = parseNumericId(taskId);
      if (backendSessionId !== null && backendTaskId !== null) {
        await safeInvoke("queue_run", { tabId, sessionId: backendSessionId, taskId: backendTaskId }, null);
      }
    }

    updateTab(tabId, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const queue: Session["queue"] = s.queue.map((task) => (task.id === taskId ? { ...task, status: "running" } : task));
        return {
          ...s,
          status: resolveVisibleStatus(tab, s, "waiting"),
          queue,
          messages: [
            ...s.messages,
            {
              id: createId("msg"),
              role: "agent",
              content: t("workingOn", { text: queue.find((q) => q.id === taskId)?.text ?? "task" }),
              time: nowLabel()
            }
          ]
        };
      })
    }));
    touchSession(tabId, sessionId);

    if (isTauri && tabSnapshot && sessionSnapshot) {
      const started = await agentStartMaybe(tabSnapshot, sessionSnapshot);
      if (!started) return;
      await agentSend(tabSnapshot, sessionSnapshot, taskText);
      return;
    }
  };

  const onQueueRun = () => {
    if (activeTaskForSession(activeSession)) return;
    const nextTask = activeSession.queue.find((task) => task.status === "queued");
    if (!nextTask) return;
    void runTask(activeTab.id, activeSession.id, nextTask.id);
  };

  const onFileSelect = async (node: TreeNode) => {
    if (node.kind !== "file") return;
    const path = resolvePath(activeTab.project?.path, node.path);
    const preview = await safeInvoke<FilePreview>("file_preview", { path }, {
      path: node.path,
      content: t("previewUnavailable"),
      mode: "preview"
    });
    updateTab(activeTab.id, (tab) => ({
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

  const onGitChangeSelect = async (change: GitChangeEntry) => {
    const relativePath = sanitizeGitRelativePath(change.path);
    const path = resolvePath(activeTab.project?.path, relativePath);
    let payload = await safeInvoke<GitFileDiffPayload>("git_file_diff_payload", {
      path: activeTab.project?.path ?? "",
      target: activeTab.project?.target ?? { type: "native" },
      filePath: relativePath,
      section: change.section
    }, {
      original_content: "",
      modified_content: "",
      diff: ""
    });

    if (!payload.original_content && !payload.modified_content && !payload.diff) {
      const fallbackDiff = await safeInvoke<string>("git_diff_file", {
        path: activeTab.project?.path ?? "",
        target: activeTab.project?.target ?? { type: "native" },
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
    if (!isTauri) return false;
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
    if (isTauri && Number.isFinite(numericId)) {
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

    if (!isTauri) {
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

  const onResizeStart = (type: "left" | "right" | "right-split") => (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const { leftWidth, rightWidth, rightSplit } = stateRef.current.layout;
    const splitContainerWidth = type === "right-split"
      ? event.currentTarget instanceof HTMLElement
        ? event.currentTarget.parentElement?.getBoundingClientRect().width ?? 1
        : 1
      : 1;

    const onMove = (e: PointerEvent) => {
      if (type === "left") {
        const next = Math.max(0, leftWidth + (e.clientX - startX));
        updateState((current) => ({ ...current, layout: { ...current.layout, leftWidth: next } }));
      }
      if (type === "right") {
        const next = Math.max(0, rightWidth - (e.clientX - startX));
        updateState((current) => ({ ...current, layout: { ...current.layout, rightWidth: next } }));
      }
      if (type === "right-split") {
        const delta = e.clientX - startX;
        const next = Math.max(0, Math.min(100, rightSplit + (delta / splitContainerWidth) * 100));
        updateState((current) => ({ ...current, layout: { ...current.layout, rightSplit: next } }));
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      requestAnimationFrame(() => {
        xtermFitRef.current?.fit();
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
    requestAnimationFrame(() => {
      xtermFitRef.current?.fit();
    });
  };

  const activeTerminal = activeTab.terminals.find((t) => t.id === activeTab.activeTerminalId) ?? activeTab.terminals[0];
  const showCodePanel = state.layout.showCodePanel;
  const showTerminalPanel = state.layout.showTerminalPanel;
  const isRightPanelVisible = showCodePanel || showTerminalPanel;

  const setPaneInputValue = (paneId: string, value: string) => {
    setPaneInputs((current) => ({ ...current, [paneId]: value }));
  };

  const focusPaneInput = (paneId: string) => {
    requestAnimationFrame(() => {
      const input = paneInputRefs.current[paneId];
      input?.focus();
      const length = input?.value.length ?? 0;
      input?.setSelectionRange(length, length);
    });
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

  const splitPane = async (paneId: string, axis: "horizontal" | "vertical") => {
    let newSessionId = "";
    let newPaneId = "";
    updateTab(activeTab.id, (tab) => {
      const newSession = createDraftSessionForTab(tab, "branch");
      const nextLeaf = createPaneLeaf(newSession.id);
      newSessionId = newSession.id;
      newPaneId = nextLeaf.id;
      return {
        ...tab,
        sessions: [newSession, ...tab.sessions.filter((session) => session.id !== newSession.id)],
        activePaneId: nextLeaf.id,
        activeSessionId: newSession.id,
        paneLayout: replacePaneNode(tab.paneLayout, paneId, (leaf) => ({
          type: "split",
          id: createId("split"),
          axis,
          ratio: 0.5,
          first: leaf,
          second: nextLeaf
        }))
      };
    });
    focusPaneInput(newPaneId || newSessionId);
  };

  const closePane = (paneId: string) => {
    if (paneLeaves.length <= 1) return;
    updateTab(activeTab.id, (tab) => {
      const nextLayout = removePaneNode(tab.paneLayout, paneId) ?? tab.paneLayout;
      const nextLeaves = collectPaneLeaves(nextLayout);
      const nextPane = nextLeaves.find((leaf) => leaf.id !== paneId) ?? nextLeaves[0];
      if (!nextPane) return tab;
      return {
        ...tab,
        paneLayout: nextLayout,
        activePaneId: nextPane.id,
        activeSessionId: nextPane.sessionId
      };
    });
  };

  useEffect(() => {
    const shellTerm = xtermRef.current;
    if (shellTerm) {
      shellTerm.options.theme = readTerminalTheme();
      shellTerm.options.fontSize = editorMetrics.terminalFontSize;
      if (shellTerm.rows > 0) {
        shellTerm.refresh(0, shellTerm.rows - 1);
      }
    }
  }, [editorMetrics.terminalFontSize, theme]);

  const onToggleSlashMenu = async (paneId: string) => {
    const nextOpen = !(slashMenuOpen && slashMenuPaneId === paneId);
    setSlashMenuPaneId(nextOpen ? paneId : null);
    setSlashMenuOpen(nextOpen);
    if (nextOpen) {
      await loadSlashSkills(activeTab.project?.path);
    }
  };

  const onSelectSlashMenuItem = (paneId: string, item: ClaudeSlashMenuItem) => {
    setPaneInputs((current) => ({
      ...current,
      [paneId]: replaceLeadingSlashToken(current[paneId] ?? "", item.command)
    }));
    setSlashMenuOpen(false);
    setSlashMenuPaneId(null);
    focusPaneInput(paneId);
  };

  const onSendAgent = async (paneId: string) => {
    const paneSessionId = findPaneSessionId(activeTab.paneLayout, paneId) ?? activePaneSession.id;
    const content = (paneInputs[paneId] ?? "").trim();
    if (!content || isArchiveView) return;
    const activeTabSnapshot = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeTabId);
    const activeSessionSnapshot = activeTabSnapshot?.sessions.find((s) => s.id === paneSessionId);
    if (!activeTabSnapshot || !activeSessionSnapshot) return;
    const wasDraft = isDraftSession(activeSessionSnapshot);
    const materialized = wasDraft
      ? await materializeSession(activeTabSnapshot.id, activeSessionSnapshot.id, content)
      : { tab: activeTabSnapshot, session: activeSessionSnapshot };
    const tabSnapshot = materialized?.tab ?? activeTabSnapshot;
    const sessionSnapshot = materialized?.session ?? activeSessionSnapshot;
    if (!tabSnapshot || !sessionSnapshot) return;
    if (!wasDraft) {
      updateTab(tabSnapshot.id, (tab) => ({
        ...tab,
        sessions: tab.sessions.map((s) =>
          s.id === sessionSnapshot.id
            ? {
                ...s,
                status: resolveVisibleStatus(tab, s, "waiting"),
                lastActiveAt: Date.now(),
                messages: [
                  ...s.messages,
                  { id: createId("msg"), role: "user", content, time: nowLabel() }
                ]
              }
            : s
        )
      }));
    }
    setPaneInputValue(paneId, "");
    focusPaneInput(paneId);
    touchSession(tabSnapshot.id, sessionSnapshot.id);

    if (isTauri) {
      const started = await agentStartMaybe(tabSnapshot, sessionSnapshot);
      if (!started) return;
      await agentSend(tabSnapshot, sessionSnapshot, content);
      return;
    }

    updateTab(tabSnapshot.id, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((s) =>
        s.id === sessionSnapshot.id
          ? { ...s, stream: `${s.stream}\n> ${content}\n` }
          : s
      )
    }));
  };

  const onSendSpecialAgentKey = async (paneId: string, sequence: string) => {
    if (isArchiveView) return;
    const tabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    const paneSessionId = findPaneSessionId(activeTab.paneLayout, paneId) ?? activePaneSession.id;
    const sessionSnapshot = tabSnapshot?.sessions.find((session) => session.id === paneSessionId);
    if (!tabSnapshot || !sessionSnapshot) return;
    if (isDraftSession(sessionSnapshot)) return;
    await sendRawAgentInput(tabSnapshot, sessionSnapshot, sequence);
    focusPaneInput(paneId);
  };

  const onAgentInputKeyDown = (paneId: string) => (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const currentInput = paneInputs[paneId] ?? "";
    if (event.key === "Enter" && event.shiftKey) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (currentInput.trim()) {
        void onSendAgent(paneId);
      } else {
        void onSendSpecialAgentKey(paneId, "\r");
      }
      return;
    }

    const sequence = AGENT_SPECIAL_KEY_MAP[event.key];
    if (!sequence) return;

    if (currentInput.trim()) return;

    event.preventDefault();
    void onSendSpecialAgentKey(paneId, sequence);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (!activeTab.filePreview.path) return;
        event.preventDefault();
        void onSavePreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab.filePreview.path, activeTab.filePreview.dirty, activeTab.filePreview.content, activeSession.id]);

  useEffect(() => {
    if (!isArchiveView) {
      focusPaneInput(activeTab.activePaneId);
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
    if (leftRailView === "files" || leftRailView === "git") {
      void refreshWorkspaceArtifacts(activeTab.id);
    }
  }, [leftRailView, activeTab.id, activeTab.project?.path]);

  useEffect(() => {
    if (!activeTab.project?.path) return;
    const timer = window.setInterval(() => {
      void refreshWorkspaceArtifacts(activeTab.id);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeTab.id, activeTab.project?.path]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container || !showTerminalPanel || !isRightPanelVisible) return;

    if (!xtermRef.current || terminalMountRef.current !== container) {
      xtermRef.current?.dispose();
      const term = new XTerminal({
        convertEol: true,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
        fontSize: editorMetrics.terminalFontSize,
        theme: readTerminalTheme()
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      xtermRef.current = term;
      xtermFitRef.current = fitAddon;
      terminalMountRef.current = container;
      term.open(container);
      terminalOutputRef.current = { id: activeTerminal?.id, snapshot: "" };
      if (activeTerminal?.output) {
        term.write(activeTerminal.output);
        terminalOutputRef.current.snapshot = activeTerminal.output;
      }
      fitAddon.fit();
      syncTerminalSize(term, activeTerminal?.id);
      return;
    }

    xtermRef.current.options = {
      fontSize: editorMetrics.terminalFontSize,
      theme: readTerminalTheme()
    };
    requestAnimationFrame(() => {
      xtermFitRef.current?.fit();
      const term = xtermRef.current;
      if (term) syncTerminalSize(term, activeTerminal?.id);
    });
  }, [showTerminalPanel, isRightPanelVisible, activeTab.id, activeTerminal?.id, editorMetrics.terminalFontSize, theme]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    const fit = xtermFitRef.current;
    if (!container || !fit || !showTerminalPanel || !isRightPanelVisible) return;
    const observer = new ResizeObserver(() => {
      fit.fit();
      const term = xtermRef.current;
      if (term) syncTerminalSize(term, activeTerminal?.id);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [showTerminalPanel, isRightPanelVisible, activeTab.id, activeTerminal?.id]);

  useEffect(() => {
    const onResize = () => {
      if (!showTerminalPanel || !isRightPanelVisible) return;
      xtermFitRef.current?.fit();
      const term = xtermRef.current;
      if (term) syncTerminalSize(term, activeTerminal?.id);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeTab.id, activeTerminal?.id, isRightPanelVisible, showTerminalPanel]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (!activeTerminal) {
      term.reset();
      terminalOutputRef.current = { id: undefined, snapshot: "" };
      terminalSizeRef.current = { id: undefined, cols: 0, rows: 0 };
      return;
    }
    const output = activeTerminal.output ?? "";
    if (terminalOutputRef.current.id !== activeTerminal.id) {
      term.reset();
      terminalOutputRef.current = { id: activeTerminal.id, snapshot: "" };
      terminalSizeRef.current = { id: undefined, cols: 0, rows: 0 };
    }
    writeXtermSnapshot(term, terminalOutputRef.current.snapshot, output);
    terminalOutputRef.current.snapshot = output;
  }, [activeTab.id, activeTerminal?.id, activeTerminal?.output]);

  useEffect(() => () => {
    xtermRef.current?.dispose();
    xtermRef.current = null;
    xtermFitRef.current = null;
    terminalMountRef.current = null;
    terminalOutputRef.current = { id: undefined, snapshot: "" };
    terminalSizeRef.current = { id: undefined, cols: 0, rows: 0 };
  }, []);

  useEffect(() => {
    if (xtermRef.current && activeTerminal) {
      xtermRef.current.focus();
    }
  }, [activeTerminal?.id, showTerminalPanel, isRightPanelVisible]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term || !activeTerminal || !showTerminalPanel || !isRightPanelVisible) return;
    const disposable = term.onData((data) => {
      if (!isTauri) return;
      const numericId = Number(activeTerminal.id.replace("term-", ""));
      if (!Number.isFinite(numericId)) return;
      void invoke("terminal_write", {
        tabId: activeTab.id,
        terminalId: numericId,
        input: data
      });
    });
    return () => {
      disposable.dispose();
    };
  }, [activeTerminal?.id, activeTab.id, showTerminalPanel, isRightPanelVisible]);
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
  const selectedGitChange = activeTab.gitChanges.find((change) => `${change.section}:${change.path}:${change.code}` === selectedGitChangeKey)
    ?? activeTab.gitChanges.find((change) => matchesGitPreviewPath(activeTab.filePreview.path, change.path));
  const previewGitChange = activeTab.gitChanges.find((change) => matchesGitPreviewPath(activeTab.filePreview.path, change.path));
  const gitSummary = {
    changes: gitChangeGroups.find((group) => group.key === "changes")?.items.length ?? 0,
    staged: gitChangeGroups.find((group) => group.key === "staged")?.items.length ?? 0,
    untracked: gitChangeGroups.find((group) => group.key === "untracked")?.items.length ?? 0
  };
  const previewFileName = displayPathName(activeTab.filePreview.path);
  const previewParentPath = activeTab.filePreview.parentPath || fileParentLabel(activeTab.filePreview.path);
  const workspaceFolderName = displayPathName(activeTab.project?.path) || t("noWorkspace");
  const currentFileChangeCount = activeTab.git.changes;
  const hasStructuredDiffContent = Boolean(
    (activeTab.filePreview.originalContent && activeTab.filePreview.originalContent.length > 0)
    || (activeTab.filePreview.modifiedContent && activeTab.filePreview.modifiedContent.length > 0)
  );
  const fileProgressPercent = hasPreviewFile
    ? activeTab.filePreview.mode === "diff"
      ? Math.min(100, Math.max(24, currentFileChangeCount * 12))
      : activeTab.filePreview.dirty
        ? 94
        : 40
    : 8;
  const fileProgressTone = hasPreviewFile
    ? (activeTab.filePreview.mode === "diff" || activeTab.filePreview.dirty ? "warning" : "steady")
    : "idle";
  const hasTerminalOutput = Boolean(activeTerminal?.output?.trim());
  const terminalProgressPercent = activeTerminal
    ? (hasTerminalOutput ? 88 : 52)
    : 8;
  const terminalProgressTone = activeTerminal
    ? (hasTerminalOutput ? "live" : "steady")
    : "idle";
  const rightPanelModeClass = showCodePanel && showTerminalPanel ? "dual-pane" : "single-pane";
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
    { id: "general" as const, label: t("settingsGeneral"), icon: <SettingsGeneralIcon />, enabled: true },
    { id: "configuration" as const, label: t("settingsConfiguration"), icon: <SettingsConfigIcon />, enabled: false },
    { id: "appearance" as const, label: t("settingsAppearance"), icon: <SettingsAppearanceIcon />, enabled: true },
    { id: "mcp" as const, label: t("settingsMcpServers"), icon: <SettingsMcpIcon />, enabled: false },
    { id: "git" as const, label: t("gitNav"), icon: <SettingsGitIcon />, enabled: false },
    { id: "environment" as const, label: t("settingsEnvironment"), icon: <SettingsEnvironmentIcon />, enabled: false },
    { id: "worktrees" as const, label: t("settingsWorktrees"), icon: <SettingsWorktreeIcon />, enabled: false },
    { id: "archives" as const, label: t("settingsArchives"), icon: <SettingsArchiveIcon />, enabled: false }
  ];
  const railItems = [
    { id: "sessions" as const, label: t("sessionsNav"), count: activeTab.sessions.length, icon: <RailSessionsIcon /> },
    { id: "files" as const, label: t("files"), count: flattenTree(activeTab.fileTree).filter((node) => node.kind === "file").length, icon: <RailFilesIcon /> },
    { id: "git" as const, label: t("gitNav"), count: activeTab.git.changes, icon: <RailGitIcon /> }
  ];

  const onFolderPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files || files.length === 0) return;
    const first = files[0] as File & { path?: string; webkitRelativePath?: string };
    let pickedPath = first.path;
    if (!pickedPath && first.webkitRelativePath) {
      const root = first.webkitRelativePath.split("/")[0];
      pickedPath = root;
    }
    updateState((current) => ({
      ...current,
      overlay: { ...current.overlay, input: pickedPath || current.overlay.input }
    }));
  };

  const openFolderDialog = async () => {
    if (isTauri) {
      try {
        const value = await invoke<string | null>("dialog_pick_folder", {});
        if (typeof value === "string" && value.trim()) {
          updateState((current) => ({
            ...current,
            overlay: { ...current.overlay, input: value }
          }));
        } else {
          addToast({ id: createId("toast"), text: t("noFolderSelected"), sessionId: activeSession.id });
        }
      } catch (error) {
        addToast({ id: createId("toast"), text: t("dialogFailed"), sessionId: activeSession.id });
      }
      return;
    }
    folderInputRef.current?.click();
  };

  const renderAgentPane = (node: SessionPaneNode) => {
    if (node.type === "split") {
      return (
        <div key={node.id} className={`agent-split-pane ${node.axis}`}>
          <div className="agent-split-child">{renderAgentPane(node.first)}</div>
          <div className={`agent-split-divider ${node.axis}`} />
          <div className="agent-split-child">{renderAgentPane(node.second)}</div>
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
    const plainStream = stripAnsi(session.stream);

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
            <span className={`session-top-dot ${sessionTone(session.status)} ${sessionTone(session.status) === "active" ? "pulse" : ""}`} />
            <span className="agent-pane-title">{displaySessionTitle(session.title)}</span>
            <span className="agent-pane-status">{sessionStatusLabel(session.status, t)}</span>
          </div>
          <div className="agent-pane-actions">
            <button type="button" className="pane-action" onClick={() => void splitPane(node.id, "horizontal")} title={locale === "zh" ? "横向拆分" : "Split rows"}>▤</button>
            <button type="button" className="pane-action" onClick={() => void splitPane(node.id, "vertical")} title={locale === "zh" ? "纵向拆分" : "Split columns"}>▥</button>
            <button type="button" className="pane-action close" onClick={() => closePane(node.id)} title={t("close")} disabled={paneLeaves.length <= 1}>
              <HeaderCloseIcon />
            </button>
          </div>
        </div>
        <div className="agent-pane-body" data-testid={`agent-pane-${node.id}`}>
          {plainStream.trim() ? (
            <AgentStreamTerminal stream={session.stream} theme={theme} fontSize={editorMetrics.terminalFontSize} />
          ) : (
            <div className="terminal-empty">{isDraftSession(session) ? t("draftSessionPrompt") : t("noTaskInProgress")}</div>
          )}
        </div>
        <div className="agent-pane-input">
          <div className="agent-compose" ref={isPaneActive ? slashMenuRef : undefined}>
            <button
              type="button"
              className={`agent-plus-button ${slashMenuOpen && slashMenuPaneId === node.id ? "active" : ""}`}
              onClick={() => void onToggleSlashMenu(node.id)}
              aria-label={t("slashMenu")}
              title={t("slashMenu")}
            >
              <AgentPlusIcon />
            </button>
            {slashMenuOpen && slashMenuPaneId === node.id && (
              <div className="agent-slash-menu" data-testid="agent-slash-menu">
                <div className="agent-slash-menu-head">
                  <span>{t("slashMenu")}</span>
                  {slashMenuLoading && <span className="agent-slash-menu-status">{t("loading")}</span>}
                </div>
                <div className="agent-slash-menu-body">
                  {slashMenuSections.map((section) => (
                    <div key={section.id} className="agent-slash-group">
                      <div className="agent-slash-group-title">{section.label}</div>
                      <div className="agent-slash-group-items">
                        {section.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="agent-slash-item"
                            onClick={() => onSelectSlashMenuItem(node.id, item)}
                          >
                            <span className="agent-slash-item-copy">
                              <span className="agent-slash-item-command">{item.command}</span>
                              <span className="agent-slash-item-description">{item.description}</span>
                            </span>
                            {item.sourceKind && (
                              <span className="agent-slash-item-meta">{item.sourceKind === "skill" ? t("slashSkillBadge") : t("slashCommandBadge")}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!slashMenuLoading && slashMenuSections.length === 0 && (
                    <div className="agent-slash-empty">{t("slashMenuEmpty")}</div>
                  )}
                </div>
              </div>
            )}
            <textarea
              ref={(element) => {
                paneInputRefs.current[node.id] = element;
              }}
              className="agent-compose-field"
              value={paneInputs[node.id] ?? ""}
              onChange={(event) => setPaneInputValue(node.id, event.target.value)}
              placeholder={t("agentInputPlaceholder")}
              disabled={isArchiveView}
              data-testid={`agent-input-${node.id}`}
              onKeyDown={onAgentInputKeyDown(node.id)}
              rows={3}
            />
            <div className="agent-input-actions compact">
              <button
                className="agent-send-button"
                onClick={() => void onSendAgent(node.id)}
                disabled={isArchiveView}
                data-testid={`agent-send-${node.id}`}
                title={t("send")}
                aria-label={t("send")}
              >
                <AgentSendIcon />
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div ref={appRef} className="app" style={layoutStyle} data-theme={theme}>
      <header className={`topbar ${isSettingsRoute ? "topbar-settings" : ""}`}>
        <div className="topbar-tabs-wrap">
          {isSettingsRoute ? (
            <div className="settings-topbar" data-testid="settings-topbar">
              <div className="settings-topbar-copy">
                <div className="section-kicker">{t("globalSettings")}</div>
                <div className="settings-topbar-title">{t("settings")}</div>
              </div>
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
                className="topbar-tool"
                onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                title={theme === "dark" ? t("themeLight") : t("themeDark")}
                aria-label={t("theme")}
              >
                {theme === "dark" ? <ThemeDarkIcon /> : <ThemeLightIcon />}
              </button>
              <button
                type="button"
                className="topbar-tool locale"
                onClick={() => setLocale((current) => current === "zh" ? "en" : "zh")}
                data-testid="locale-toggle-compact"
                title={t("languageLabel")}
                aria-label={t("languageLabel")}
              >
                {locale === "zh" ? "中" : "EN"}
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
              <button className="settings-back-link" type="button" onClick={onCloseSettings}>
                <HeaderBackIcon />
                <span>{t("backToApp")}</span>
              </button>

              <nav className="settings-nav-list" aria-label={t("settings")}>
                {settingsNavItems.map((item) => {
                  const isActive = item.id === activeSettingsPanel;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item ${isActive ? "active" : ""} ${item.enabled ? "" : "disabled"}`}
                      onClick={() => {
                        if (!item.enabled) return;
                        if (item.id === "general" || item.id === "appearance") {
                          setActiveSettingsPanel(item.id);
                        }
                      }}
                      disabled={!item.enabled}
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
                    <div className="settings-section-heading">
                      <h2>{t("settingsGeneral")}</h2>
                    </div>

                    <div className="settings-group-card">
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("launchCommand")}</strong>
                          <span>{t("launchCommandHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <input
                            className="settings-inline-input"
                            value={settingsDraft.agentCommand}
                            onChange={(e) => onUpdateSettings({ agentCommand: e.target.value })}
                            placeholder={t("launchCommandPlaceholder")}
                            data-testid="settings-agent-command"
                          />
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
                    <div className="settings-section-heading">
                      <h2>{t("settingsAppearance")}</h2>
                    </div>

                    <div className="settings-group-card">
                      <div className="settings-row">
                        <div className="settings-row-copy">
                          <strong>{t("theme")}</strong>
                          <span>{t("themeHint")}</span>
                        </div>
                        <div className="settings-row-control">
                          <div className="settings-pill-select">
                            <button
                              type="button"
                              className={`settings-pill-option ${theme === "light" ? "active" : ""}`}
                              onClick={() => setTheme("light")}
                            >
                              {t("themeLight")}
                            </button>
                            <button
                              type="button"
                              className={`settings-pill-option ${theme === "dark" ? "active" : ""}`}
                              onClick={() => setTheme("dark")}
                            >
                              {t("themeDark")}
                            </button>
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
                              onClick={() => setLocale("zh")}
                            >
                              中文
                            </button>
                            <button
                              type="button"
                              className={`settings-pill-option ${locale === "en" ? "active" : ""}`}
                              onClick={() => setLocale("en")}
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
          </div>
        </div>
      <div className="workspace-layout">
        <section className="panel left-panel">
          <div className="panel-inner sidebar-workbench">
            <div className="sidebar-rail">
              {railItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rail-tab ${leftRailView === item.id ? "active" : ""}`}
                  onClick={() => setLeftRailView(item.id)}
                  title={item.label}
                >
                  <span className="rail-icon">{item.icon}</span>
                </button>
              ))}
            </div>

            <div className="sidebar-panel">
              {leftRailView === "sessions" && (
                <div className="section grow queue-card compact">
                  <div className="session-stack-list">
                    {activeTab.sessions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`session-stack-item ${item.id === activeTab.activeSessionId ? "active" : ""}`}
                        onClick={() => onSwitchSession(item.id)}
                      >
                        <span className={`session-top-dot ${sessionTone(item.status)} ${sessionTone(item.status) === "active" ? "pulse" : ""}`} />
                        <span className="session-stack-copy">
                          <span className="session-stack-title">{displaySessionTitle(item.title)}</span>
                          <span className="session-stack-meta">{sessionStatusLabel(item.status, t)}</span>
                        </span>
                        {item.unread > 0 && <span className="session-top-unread">{item.unread > 9 ? "9+" : item.unread}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="section-head">
                    <div>
                      <div className="section-kicker">{t("sessionsNav")}</div>
                      <h3>{displaySessionTitle(activeSession.title)}</h3>
                    </div>
                    <div className="section-actions">
                      <button className="btn tiny" type="button" onClick={() => void onNewSession()}>{t("newSession")}</button>
                      <label className="toggle">
                        <input type="checkbox" checked={queueSession.autoFeed} onChange={onToggleAutoFeed} disabled={isArchiveView} />
                        <span className="toggle-track"><span className="toggle-thumb" /></span>
                        <span>{t("autoFeed")}</span>
                      </label>
                    </div>
                  </div>
                  <div className="queue-controls inline">
                    <input value={queueInput} onChange={(e) => setQueueInput(e.target.value)} placeholder={t("queuePlaceholder")} disabled={isArchiveView} data-testid="queue-input" />
                    <div className="section-actions">
                      <button className="btn tiny" onClick={() => void onQueueAdd()} disabled={isArchiveView} data-testid="queue-add">{t("add")}</button>
                      <button className="btn tiny ghost" onClick={onQueueRun} disabled={isArchiveView || Boolean(activeTaskForSession(activeSession))} data-testid="queue-run">{t("runNext")}</button>
                    </div>
                  </div>
                  <div className="queue-list">
                    {queueSession.queue.length === 0 && <div className="empty">{t("queueEmpty")}</div>}
                    {queueSession.queue.map((task) => (
                      <div key={task.id} className={`queue-item ${task.status}`}>
                        <div>
                          <span>{task.text}</span>
                          <small>{queueTaskStatusLabel(task.status, t)}</small>
                        </div>
                        {task.status === "running" && <span className="pulse-dot" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {leftRailView === "files" && (
                <div className="section grow repo-card blueprint-card">
                  {activeTab.fileTree.length === 0 && <div className="tree-empty">{t("selectProjectToLoadFiles")}</div>}
                  <TreeView
                    nodes={activeTab.fileTree}
                    onSelect={onFileSelect}
                    collapsedPaths={repoCollapsedPaths}
                    locale={locale}
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
                </div>
              )}

              {leftRailView === "git" && (
                <>
                  <div className="section workspace-brief compact git-overview">
                    <div className="section-kicker">Git</div>
                    <div className="brief-grid">
                      <div className="brief-card">
                        <span>{t("branch")}</span>
                        <strong>{activeTab.git.branch}</strong>
                      </div>
                      <div className="brief-card">
                        <span>{t("changes")}</span>
                        <strong>{activeTab.git.changes}</strong>
                      </div>
                      <div className="brief-card full">
                        <span>{t("status")}</span>
                        <strong>{activeTab.git.changes > 0 ? t("modified") : t("clean")}</strong>
                      </div>
                    </div>
                    <div className="git-summary-strip">
                      <span>{t("changesCount", { count: gitSummary.changes })}</span>
                      <span>{t("stagedCount", { count: gitSummary.staged })}</span>
                      <span>{t("untrackedCount", { count: gitSummary.untracked })}</span>
                    </div>
                    <div className="section-actions">
                      <button className="btn tiny" onClick={() => void refreshWorkspaceArtifacts(activeTab.id)}>{t("refresh")}</button>
                    </div>
                  </div>

                  <div className="section grow repo-card blueprint-card">
                    <div className="section-head">
                      <div>
                        <div className="section-kicker">{t("changes")}</div>
                        <h3>{t("sourceControl")}</h3>
                      </div>
                    </div>
                    {gitChangeGroups.length === 0 && <div className="tree-empty">{t("noChangesDetected")}</div>}
                    <div className="source-control-list">
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
                                  className={`source-change-row ${selectedGitChangeKey === changeKey ? "active" : ""}`}
                                  onClick={() => void onGitChangeSelect(change)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      void onGitChangeSelect(change);
                                    }
                                  }}
                                >
                                  <span className={`source-status-badge ${change.section}`}>{change.code}</span>
                                  <span className="source-change-copy">
                                    <span className="source-change-name">{change.name}</span>
                                    <span className="source-change-parent">{change.parent || "."}</span>
                                  </span>
                                  <span className="source-change-tail">
                                    <span className="source-change-label">{change.status}</span>
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

                  <div className="section git-actions-card compact">
                    <div className="section-head">
                      <div>
                        <div className="section-kicker">{t("commitMessage")}</div>
                        <h3>{t("commit")}</h3>
                      </div>
                    </div>
                    <div className="form-row">
                      <input
                        value={commitMessage}
                        onChange={(e) => setCommitMessage(e.target.value)}
                        placeholder={t("commitPlaceholder")}
                        data-testid="git-commit-message"
                      />
                    </div>
                    <div className="git-actions-grid">
                      <button className="btn tiny" type="button" onClick={() => void onGitStageAll()}>
                        {t("stageAll")}
                      </button>
                      <button className="btn tiny ghost" type="button" onClick={() => void onGitUnstageAll()}>
                        {t("unstageAll")}
                      </button>
                      <button className="btn tiny ghost danger" type="button" onClick={() => void onGitDiscardAll()}>
                        {t("discardAll")}
                      </button>
                      <button className="btn tiny primary" type="button" onClick={() => void onGitCommit()} disabled={!commitMessage.trim()}>
                        {t("commit")}
                      </button>
                    </div>
                  </div>

                  <div className="section ecosystem-card compact">
                    <div className="mini-section">
                      <div className="section-kicker">{t("worktrees")}</div>
                      <div className="worktree-list">
                        {activeTab.worktrees.length === 0 && <div className="empty">{t("noWorktrees")}</div>}
                        {activeTab.worktrees.map((tree) => (
                          <button
                            key={tree.path}
                            className="worktree-item"
                            onClick={() => void onOpenWorktree(tree)}
                          >
                            <div>{tree.name}</div>
                            <div className="muted">{tree.branch}</div>
                            <div className="muted">{tree.status || t("clean")}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <div className="v-resizer" data-resize="left" onPointerDown={onResizeStart("left")} />

        <section className="workspace-main">
          <div className={`workspace-main-body ${isRightPanelVisible ? "has-right-panel" : "right-panel-hidden"}`}>
            <section className="panel center-panel workspace-center-panel">
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
                          <span className={`session-top-dot ${sessionTone(queueSession.status)} ${sessionTone(queueSession.status) === "active" ? "pulse" : ""}`} />
                          <span className="agent-pane-title">{displaySessionTitle(queueSession.title)}</span>
                          <span className="agent-pane-status">{sessionStatusLabel(queueSession.status, t)}</span>
                        </div>
                      </div>
                      <div className="agent-pane-body">
                        {queuePlainStream.trim() ? (
                          <AgentStreamTerminal stream={queueSession.stream} theme={theme} fontSize={editorMetrics.terminalFontSize} />
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

            {isRightPanelVisible && (
              <>
                <div className="v-resizer" data-resize="right" onPointerDown={onResizeStart("right")} />

                <section className={`panel right workspace-right-panel ${rightPanelModeClass}`}>
                  <div className={`panel-inner workspace-right-grid ${rightPanelModeClass}`}>
                    {showCodePanel && (
                      <div className="workspace-right-pane inspector-card file-preview">
                        <div className={`surface-progress ${fileProgressTone}`} aria-hidden="true">
                          <span className="surface-progress-bar" style={{ width: `${fileProgressPercent}%` }} />
                        </div>
                        {hasPreviewFile && (
                          <div className="editor-context-bar">
                            <div className="editor-context-copy">
                              <span className="editor-context-name">{previewFileName}</span>
                              <span className="editor-context-path">{previewParentPath || "."}</span>
                            </div>
                            <div className="editor-context-meta">
                              {activeTab.filePreview.statusLabel && <span className="editor-meta-pill">{activeTab.filePreview.statusLabel}</span>}
                              {activeTab.filePreview.mode === "diff" && <span className="editor-meta-pill">{t("diff")}</span>}
                              {selectedGitChange && (
                                <span className="editor-context-actions">
                                  {(selectedGitChange.section === "staged"
                                    ? [{ id: "unstage" as const, title: t("unstageFile"), icon: <GitUnstageIcon /> }]
                                    : [
                                      { id: "stage" as const, title: t("stageFile"), icon: <GitStageIcon /> },
                                      { id: "discard" as const, title: t("discardFile"), icon: <GitDiscardIcon /> }
                                    ]).map((action) => (
                                    <button
                                      key={action.id}
                                      type="button"
                                      className="editor-context-action"
                                      title={action.title}
                                      aria-label={action.title}
                                      onClick={() => void onGitChangeAction(selectedGitChange, action.id)}
                                    >
                                      {action.icon}
                                    </button>
                                  ))}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
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
                                  theme={theme === "light" ? "vs" : "vs-dark"}
                                  options={{
                                    automaticLayout: true,
                                    readOnly: true,
                                    renderSideBySide: true,
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    wordWrap: "on",
                                    fontFamily: "IBM Plex Mono, JetBrains Mono, monospace",
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
                                theme={theme === "light" ? "vs" : "vs-dark"}
                                options={{
                                  automaticLayout: true,
                                  fontFamily: "IBM Plex Mono, JetBrains Mono, monospace",
                                  fontSize: editorMetrics.fontSize,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
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
                    )}

                    {showCodePanel && showTerminalPanel && (
                      <div
                        className="v-resizer workspace-right-splitter"
                        data-resize="right-split"
                        onPointerDown={onResizeStart("right-split")}
                      />
                    )}

                    {showTerminalPanel && (
                      <div className="workspace-right-pane inspector-card terminal-card">
                        <div className={`surface-progress ${terminalProgressTone}`} aria-hidden="true">
                          <span className="surface-progress-bar" style={{ width: `${terminalProgressPercent}%` }} />
                        </div>
                        <div className="section-head">
                          <div>
                            <div className="section-kicker">{t("shellDock")}</div>
                            <h3>{t("projectTerminal")}</h3>
                          </div>
                          <button className="btn tiny" onClick={() => void onAddTerminal()}>{t("new")}</button>
                        </div>
                        <div className="terminal-tabs">
                          {activeTab.terminals.map((term) => (
                            <div
                              key={term.id}
                              className={`t-tab ${term.id === activeTab.activeTerminalId ? "active" : ""}`}
                              onClick={() => onTerminalSelect(term.id)}
                            >
                              <span className="t-tab-label">{displayTerminalTitle(term.title)}</span>
                              <button
                                type="button"
                                className="t-tab-close"
                                aria-label={t("close")}
                                title={t("close")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void onCloseTerminal(term.id);
                                }}
                              >
                                <HeaderCloseIcon />
                              </button>
                            </div>
                          ))}
                        </div>
                        <div
                          className="terminal-output"
                          ref={terminalContainerRef}
                          onClick={() => xtermRef.current?.focus()}
                        >
                          {!activeTerminal && (
                            <div className="terminal-empty">{t("noTerminalYet")}</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
      </main>
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
            <div className="onboarding-copy">
              <div className="section-kicker">{t("launchWorkspace")}</div>
              <h2>{t("launchWorkspaceTitle")}</h2>
              <p>{t("launchWorkspaceDescription")}</p>
              <div className="onboarding-points">
                <div className="brief-card">
                  <span>{t("sessionsCard")}</span>
                  <strong>{t("parallelAgentTracks")}</strong>
                </div>
                <div className="brief-card">
                  <span>{t("gitCard")}</span>
                  <strong>{t("liveDiffAndWorktree")}</strong>
                </div>
                <div className="brief-card">
                  <span>{t("terminalCard")}</span>
                  <strong>{t("embeddedShellControl")}</strong>
                </div>
              </div>
            </div>
            <div className="onboarding-form">
              <div className="locale-toggle onboarding-language" aria-label={t("languageLabel")}>
                <button
                  type="button"
                  className={`btn tiny ghost mode ${locale === "en" ? "active" : ""}`}
                  onClick={() => setLocale("en")}
                  data-testid="overlay-locale-en"
                >
                  EN
                </button>
                <button
                  type="button"
                  className={`btn tiny ghost mode ${locale === "zh" ? "active" : ""}`}
                  onClick={() => setLocale("zh")}
                  data-testid="overlay-locale-zh"
                >
                  中文
                </button>
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
            {showWslOption && (
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
            {showWslOption && state.overlay.target.type === "wsl" && (
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
              <div className="local-picker">
                <button className="btn primary" onClick={openFolderDialog} data-testid="folder-select">{t("selectFolder")}</button>
                <div className="hint" data-testid="folder-selected">{t("selected")}: {state.overlay.input || t("notSelected")}</div>
                {!isTauri && (
                  <input
                    ref={folderInputRef}
                    type="file"
                    onChange={onFolderPick}
                    style={{ display: "none" }}
                    data-testid="folder-input"
                    {...({ webkitdirectory: "true" } as Record<string, string>)}
                  />
                )}
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
};

const TreeView = ({ nodes, depth = 0, onSelect, collapsedPaths, onToggleCollapse, locale = "en" }: TreeProps) => {
  if (!nodes?.length) return null;
  const sortedNodes = sortTreeNodes(nodes, locale);
  return (
    <div className="tree tree-list">
      {sortedNodes.map((node) => {
        const isDirectory = node.kind === "dir";
        const isExpanded = isDirectory ? collapsedPaths?.has(node.path) ?? false : false;
        return (
          <div key={node.path} className="tree-node">
            <div
              className={`tree-line ${node.kind === "file" ? "file" : "dir"} ${node.status ? "changed" : ""}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                if (isDirectory) {
                  onToggleCollapse?.(node.path);
                  return;
                }
                onSelect?.(node);
              }}
            >
              {isDirectory && (
                <span className="tree-disclosure">{isExpanded ? "▾" : "▸"}</span>
              )}
              <span className="tree-label">{node.name}{isDirectory ? "/" : ""}</span>
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
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
