import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRelaxState } from "@relax-state/react";
import Editor from "@monaco-editor/react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ArchiveEntry,
  ExecTarget,
  FilePreview,
  Session,
  SessionMode,
  SessionStatus,
  Tab,
  TreeNode,
  WorkbenchState,
  WorktreeInfo,
  createEmptyPreview,
  createId,
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

type AppSettings = {
  agentProvider: Tab["agent"]["provider"];
  agentCommand: string;
  idlePolicy: Tab["idlePolicy"];
};

const APP_SETTINGS_STORAGE_KEY = "coder-studio.app-settings";

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
      agentProvider: parsed.agentProvider === "codex" ? "codex" : "claude",
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

const isTauri = typeof window !== "undefined" && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
const stripAnsi = (value: string) => {
  if (!value) return value;
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "");
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

const modeLabel = (mode: SessionMode, t: Translator) => (mode === "branch" ? t("branchMode") : t("gitTreeMode"));

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

const poolSummary = (tab: Tab, t: Translator) => {
  const active = tab.sessions.filter((s) => !["queued", "suspended"].includes(s.status)).length;
  const queued = tab.sessions.filter((s) => s.status === "queued").length;
  return t("poolSummary", { active, max: tab.idlePolicy.maxActive, queued });
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
  lastActiveAt: source.last_active_at
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

export default function App() {
  const [state, setState] = useRelaxState(workbenchState);
  const [locale, setLocale] = useState<Locale>(() => getPreferredLocale());
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readStoredAppSettings());
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(() => readStoredAppSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queueInput, setQueueInput] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [worktreeModal, setWorktreeModal] = useState<WorktreeModalState | null>(null);
  const [worktreeView, setWorktreeView] = useState<"status" | "diff" | "tree">("status");
  const [previewMode, setPreviewMode] = useState<"preview" | "diff">("preview");
  const [repoTreeMode, setRepoTreeMode] = useState<"files" | "changes">("files");
  const [repoCollapsedPaths, setRepoCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [worktreeCollapsedPaths, setWorktreeCollapsedPaths] = useState<Set<string>>(() => new Set());
  const stateRef = useRef(state);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerminal | null>(null);
  const xtermFitRef = useRef<FitAddon | null>(null);
  const terminalOutputRef = useRef<{ id?: string; length: number }>({ length: 0 });
  const agentTerminalRef = useRef<HTMLDivElement | null>(null);
  const agentXtermRef = useRef<XTerminal | null>(null);
  const agentFitRef = useRef<FitAddon | null>(null);
  const agentOutputRef = useRef<{ id?: string; length: number }>({ length: 0 });
  const agentInputRef = useRef<HTMLInputElement | null>(null);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const agentSpecialKeys = useMemo(
    () => AGENT_SPECIAL_KEYS.map((item) => ({ ...item, label: t(item.labelKey) })),
    [t]
  );

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
    persistWorkbenchState(state);
  }, [state]);

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

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
                ? resolveVisibleStatus(tab, session, "running")
                : isExit
                  ? "idle"
                  : session.status;
              const streamChunk = isExit
                ? "\n[agent exited]\n"
                : isSystem
                  ? `\n[${cleaned}]\n`
                  : kind === "stderr"
                    ? `\n[stderr] ${data}`
                    : data;
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
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [t]);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = listen<AgentLifecycleEvent>("agent://lifecycle", (event) => {
      const { tab_id, session_id, kind } = event.payload;
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
        lastActiveAt: Date.now()
      };
      const remainingSessions = tab.sessions.filter((session) => session.id !== sessionId);
      tabSnapshot = {
        ...tab,
        sessions: [preparedSession, ...remainingSessions],
        activeSessionId: preparedSession.id,
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

    const [git, worktrees, tree] = await Promise.all([
      safeInvoke<GitStatus>("git_status", { path, target }, { branch: tab.git.branch || "main", changes: tab.git.changes ?? 0, last_commit: tab.git.lastCommit || "—" }),
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

  const openOverlayForTab = (tabId: string) => {
    updateState((current) => ({
      ...current,
      activeTabId: tabId,
      overlay: {
        visible: true,
        tabId,
        mode: "remote",
        input: "",
        target: { type: "native" }
      }
    }));
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

  const onSelectTab = (tabId: string) => {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    updateState((current) => ({
      ...current,
      activeTabId: tabId,
      overlay: {
        ...current.overlay,
        visible: tab.status === "init",
        tabId
      }
    }));
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
    if (!tab.project?.path) return;
    const command = buildAgentCommand(tab);
    const cwd = tab.project.path;
    const target = tab.project.target;
    await invokeAgent("agent_start", {
      tabId: tab.id,
      sessionId: session.id,
      provider: tab.agent.provider,
      command,
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
    await agentStartMaybe(tab, session);
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

  const onArchiveSession = async (sessionId: string) => {
    const session = activeTab.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    const wasActiveSession = activeTab.activeSessionId === sessionId;
    if (isDraftSession(session)) {
      const nextSession = activeTab.sessions.find((item) => item.id !== sessionId);
      const nextActiveAt = Date.now();
      updateTab(activeTab.id, (tab) => {
        let remaining = tab.sessions.filter((item) => item.id !== sessionId);
        if (remaining.length === 0) {
          remaining = [createSession(1, "branch", locale)];
        }
        const nextActiveId = remaining[0]?.id ?? sessionId;
        return {
          ...tab,
          sessions: remaining.map((item) =>
            item.id === nextActiveId && item.status === "background"
              ? { ...item, status: restoreVisibleStatus(item), unread: 0, lastActiveAt: Date.now() }
              : item
          ),
          activeSessionId: nextActiveId,
          viewingArchiveId: undefined
        };
      });
      if (nextSession) {
        const nextStatus = restoreVisibleStatus(nextSession);
        void syncSessionPatch(activeTab.id, nextSession.id, {
          status: nextStatus,
          last_active_at: nextActiveAt
        });
      }
      return;
    }
    const backendSessionId = parseNumericId(sessionId);
    const archived = isTauri && backendSessionId !== null
      ? await safeInvoke<BackendArchiveEntry | null>("archive_session", { tabId: activeTab.id, sessionId: backendSessionId }, null)
      : null;

    let bootstrapSession: Session | null = null;
    if (activeTab.sessions.length === 1) {
      const created = isTauri
        ? await safeInvoke<BackendSession | null>("create_session", { tabId: activeTab.id, mode: "branch" }, null)
        : null;
      bootstrapSession = created ? createSessionFromBackend(created, locale) : createSession(1, "branch", locale);
    }

    const nextActiveAt = Date.now();
    let nextActiveSessionId: string | null = null;
    let nextActiveStatus: SessionStatus | null = null;
    updateTab(activeTab.id, (tab) => {
      const index = tab.sessions.findIndex((s) => s.id === sessionId);
      if (index === -1) return tab;
      const entry: ArchiveEntry = {
        id: archived ? String(archived.id) : createId("archive"),
        sessionId: session.id,
        time: archived?.time ?? nowLabel(),
        mode: archived?.mode ?? session.mode,
        snapshot: session
      };
      let remaining = tab.sessions.filter((s) => s.id !== sessionId);
      if (remaining.length === 0) {
        remaining = [bootstrapSession ?? createSession(1, "branch", locale)];
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
        activeSessionId: nextActive,
        viewingArchiveId: undefined
      };
    });

    if (wasActiveSession && nextActiveSessionId) {
      const backendSessionId = parseNumericId(nextActiveSessionId);
      if (isTauri && backendSessionId !== null) {
        void safeInvoke("switch_session", { tabId: activeTab.id, sessionId: backendSessionId }, null);
      }
      if (nextActiveStatus) {
        void syncSessionPatch(activeTab.id, nextActiveSessionId, {
          status: nextActiveStatus,
          last_active_at: nextActiveAt
        });
      }
    }
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

  const onUpdateSessionMode = (mode: SessionMode) => {
    updateTab(activeTab.id, (tab) => ({
      ...tab,
      sessions: tab.sessions.map((s) => (s.id === tab.activeSessionId ? { ...s, mode } : s))
    }));
    void syncSessionPatch(activeTab.id, activeTab.activeSessionId, { mode });
  };

  const onOpenSettings = () => {
    setSettingsDraft(cloneAppSettings(appSettings));
    setSettingsOpen(true);
  };

  const onCloseSettings = () => {
    setSettingsOpen(false);
    setSettingsDraft(cloneAppSettings(appSettings));
  };

  const onUpdateSettings = (patch: Partial<AppSettings>) => {
    setSettingsDraft((current) => ({
      ...current,
      ...patch,
      idlePolicy: patch.idlePolicy ? { ...patch.idlePolicy } : current.idlePolicy
    }));
  };

  const onUpdateSettingsIdlePolicy = (patch: Partial<Tab["idlePolicy"]>) => {
    setSettingsDraft((current) => ({
      ...current,
      idlePolicy: {
        ...current.idlePolicy,
        ...patch
      }
    }));
  };

  const onApplySettings = () => {
    const nextSettings: AppSettings = {
      agentProvider: settingsDraft.agentProvider,
      agentCommand: settingsDraft.agentCommand.trim() || appSettings.agentCommand,
      idlePolicy: {
        enabled: settingsDraft.idlePolicy.enabled,
        idleMinutes: Math.max(1, Number(settingsDraft.idlePolicy.idleMinutes) || 1),
        maxActive: Math.max(1, Number(settingsDraft.idlePolicy.maxActive) || 1),
        pressure: settingsDraft.idlePolicy.pressure
      }
    };
    setAppSettings(nextSettings);
    persistAppSettings(nextSettings);
    syncGlobalSettings(nextSettings);
    setSettingsDraft(cloneAppSettings(nextSettings));
    setSettingsOpen(false);
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
      await agentStartMaybe(tabSnapshot, sessionSnapshot);
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
        dirty: false
      }
    }));
    setPreviewMode("preview");
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
        diffStats: { files: stats.files, additions: stats.additions, deletions: stats.deletions },
        diffFiles: stats.diffFiles,
        dirty: tab.filePreview.dirty
      }
    }));
  };

  const onSavePreview = async () => {
    const preview = activeTab.filePreview;
    if (!preview.path || preview.mode !== "preview" || !preview.dirty) return;
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

  const onRepoTreeModeChange = async (mode: "files" | "changes") => {
    setRepoTreeMode(mode);
    if (mode === "changes") {
      await refreshWorkspaceArtifacts(activeTab.id);
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

  const onResizeStart = (type: "left" | "right" | "right-top") => (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const { leftWidth, rightWidth, rightTopHeight } = stateRef.current.layout;

    const onMove = (e: PointerEvent) => {
      if (type === "left") {
        const next = Math.max(220, Math.min(420, leftWidth + (e.clientX - startX)));
        updateState((current) => ({ ...current, layout: { ...current.layout, leftWidth: next } }));
      }
      if (type === "right") {
        const next = Math.max(280, Math.min(520, rightWidth - (e.clientX - startX)));
        updateState((current) => ({ ...current, layout: { ...current.layout, rightWidth: next } }));
      }
      if (type === "right-top") {
        const delta = e.clientY - startY;
        const next = Math.max(30, Math.min(70, rightTopHeight + delta * 0.1));
        updateState((current) => ({ ...current, layout: { ...current.layout, rightTopHeight: next } }));
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      requestAnimationFrame(() => {
        agentFitRef.current?.fit();
        xtermFitRef.current?.fit();
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const activeTerminal = activeTab.terminals.find((t) => t.id === activeTab.activeTerminalId) ?? activeTab.terminals[0];

  useEffect(() => {
    if (!agentTerminalRef.current) return;
    if (!agentXtermRef.current) {
      const term = new XTerminal({
        convertEol: true,
        disableStdin: true,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
        fontSize: 12,
        theme: {
          background: "#0f1a24",
          foreground: "#e6edf5"
        }
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      agentXtermRef.current = term;
      agentFitRef.current = fitAddon;
      term.open(agentTerminalRef.current);
      fitAddon.fit();
      if (isTauri && activeTab.id && activeSession?.id) {
        void invoke("agent_resize", {
          tabId: activeTab.id,
          sessionId: activeSession.id,
          cols: term.cols,
          rows: term.rows
        });
      }
    }
  }, []);

  useEffect(() => {
    const container = agentTerminalRef.current;
    const fit = agentFitRef.current;
    if (!container || !fit) return;
    const observer = new ResizeObserver(() => {
      fit.fit();
      const term = agentXtermRef.current;
      if (term && isTauri && activeTab.id && activeSession?.id) {
        void invoke("agent_resize", {
          tabId: activeTab.id,
          sessionId: activeSession.id,
          cols: term.cols,
          rows: term.rows
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const term = agentXtermRef.current;
    if (!term) return;
    const session = sessionForView;
    if (!session) {
      term.reset();
      agentOutputRef.current = { id: undefined, length: 0 };
      return;
    }
    const output = session.stream ?? "";
    if (agentOutputRef.current.id !== session.id) {
      term.reset();
      agentOutputRef.current = { id: session.id, length: 0 };
    }
    const prev = agentOutputRef.current.length;
    if (output.length >= prev) {
      const delta = output.slice(prev);
      if (delta) term.write(delta);
      agentOutputRef.current.length = output.length;
    } else {
      term.reset();
      term.write(output);
      agentOutputRef.current.length = output.length;
    }
    requestAnimationFrame(() => {
      agentFitRef.current?.fit();
      if (isTauri && activeTab.id && activeSession?.id) {
        void invoke("agent_resize", {
          tabId: activeTab.id,
          sessionId: activeSession.id,
          cols: term.cols,
          rows: term.rows
        });
      }
    });
  }, [sessionForView?.id, sessionForView?.stream]);


  const onSendAgent = async () => {
    const content = agentInput.trim();
    if (!content || isArchiveView) return;
    const activeTabSnapshot = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeTabId);
    const activeSessionSnapshot = activeTabSnapshot?.sessions.find((s) => s.id === activeTabSnapshot?.activeSessionId);
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
          s.id === tab.activeSessionId
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
    setAgentInput("");
    agentInputRef.current?.focus();
    touchSession(tabSnapshot.id, sessionSnapshot.id);

    if (isTauri) {
      await agentStartMaybe(tabSnapshot, sessionSnapshot);
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

  const onSendSpecialAgentKey = async (sequence: string) => {
    if (isArchiveView) return;
    const tabSnapshot = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeTabId);
    const sessionSnapshot = tabSnapshot?.sessions.find((session) => session.id === tabSnapshot?.activeSessionId);
    if (!tabSnapshot || !sessionSnapshot) return;
    if (isDraftSession(sessionSnapshot)) return;
    await sendRawAgentInput(tabSnapshot, sessionSnapshot, sequence);
    agentInputRef.current?.focus();
  };

  const onAgentInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (agentInput.trim()) {
        void onSendAgent();
      } else {
        void onSendSpecialAgentKey("\r");
      }
      return;
    }

    const sequence = AGENT_SPECIAL_KEY_MAP[event.key];
    if (!sequence) return;

    if (agentInput.trim()) return;

    event.preventDefault();
    void onSendSpecialAgentKey(sequence);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (previewMode !== "preview" || !activeTab.filePreview.path) return;
        event.preventDefault();
        void onSavePreview();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewMode, activeTab.filePreview.path, activeTab.filePreview.dirty, activeTab.filePreview.content, activeSession.id]);

  useEffect(() => {
    if (!isArchiveView) {
      agentInputRef.current?.focus();
    }
  }, [activeSession.id, isArchiveView]);

  useEffect(() => {
    if (!terminalContainerRef.current) return;
    if (!xtermRef.current) {
      const term = new XTerminal({
        convertEol: true,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
        fontSize: 12,
        theme: {
          background: "#0b0f16",
          foreground: "#c8d5e6"
        }
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      xtermRef.current = term;
      xtermFitRef.current = fitAddon;
      term.open(terminalContainerRef.current);
      fitAddon.fit();
      if (isTauri && activeTab.id && activeTerminal) {
        const numericId = Number(activeTerminal.id.replace("term-", ""));
        if (!Number.isNaN(numericId)) {
          void invoke("terminal_resize", {
            tabId: activeTab.id,
            terminalId: numericId,
            cols: term.cols,
            rows: term.rows
          });
        }
      }
    }
  }, []);

  useEffect(() => {
    const container = terminalContainerRef.current;
    const fit = xtermFitRef.current;
    if (!container || !fit) return;
    const observer = new ResizeObserver(() => {
      fit.fit();
      const term = xtermRef.current;
      if (term && isTauri && activeTab.id && activeTerminal) {
        const numericId = Number(activeTerminal.id.replace("term-", ""));
        if (!Number.isNaN(numericId)) {
          void invoke("terminal_resize", {
            tabId: activeTab.id,
            terminalId: numericId,
            cols: term.cols,
            rows: term.rows
          });
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => {
      agentFitRef.current?.fit();
      xtermFitRef.current?.fit();
      const agentTerm = agentXtermRef.current;
      if (agentTerm && isTauri && activeTab.id && activeSession?.id) {
        void invoke("agent_resize", {
          tabId: activeTab.id,
          sessionId: activeSession.id,
          cols: agentTerm.cols,
          rows: agentTerm.rows
        });
      }
      const term = xtermRef.current;
      if (term && isTauri && activeTab.id && activeTerminal) {
        const numericId = Number(activeTerminal.id.replace("term-", ""));
        if (!Number.isNaN(numericId)) {
          void invoke("terminal_resize", {
            tabId: activeTab.id,
            terminalId: numericId,
            cols: term.cols,
            rows: term.rows
          });
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    if (!activeTerminal) {
      term.reset();
      terminalOutputRef.current = { id: undefined, length: 0 };
      return;
    }
    const output = activeTerminal.output ?? "";
    if (terminalOutputRef.current.id !== activeTerminal.id) {
      term.reset();
      terminalOutputRef.current = { id: activeTerminal.id, length: 0 };
    }
    const prev = terminalOutputRef.current.length;
    if (output.length >= prev) {
      const delta = output.slice(prev);
      if (delta) term.write(delta);
      terminalOutputRef.current.length = output.length;
    } else {
      term.reset();
      term.write(output);
      terminalOutputRef.current.length = output.length;
    }
    requestAnimationFrame(() => {
      xtermFitRef.current?.fit();
      if (isTauri && activeTab.id && activeTerminal) {
        const numericId = Number(activeTerminal.id.replace("term-", ""));
        if (!Number.isNaN(numericId)) {
          void invoke("terminal_resize", {
            tabId: activeTab.id,
            terminalId: numericId,
            cols: term.cols,
            rows: term.rows
          });
        }
      }
    });
  }, [activeTerminal?.id, activeTerminal?.output]);

  useEffect(() => {
    if (xtermRef.current && activeTerminal) {
      xtermRef.current.focus();
    }
  }, [activeTerminal?.id]);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term || !activeTerminal) return;
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
  }, [activeTerminal?.id, activeTab.id]);
  const layoutStyle = {
    ["--left-w" as string]: `${state.layout.leftWidth}px`,
    ["--right-w" as string]: `${state.layout.rightWidth}px`,
    ["--right-top-h" as string]: `${state.layout.rightTopHeight}%`
  };

  const fileTabs = flattenTree(activeTab.fileTree).slice(0, 4);
  const activeTask = activeTaskForSession(sessionForView);
  const completionRatio = sessionCompletionRatio(sessionForView);
  const sessionCounts = {
    active: activeTab.sessions.filter((session) => ["running", "waiting", "background"].includes(session.status)).length,
    waiting: activeTab.sessions.filter((session) => session.status === "waiting").length,
    queued: activeTab.sessions.filter((session) => session.status === "queued").length
  };
  const repoTreeNodes = repoTreeMode === "files" ? activeTab.fileTree : activeTab.changesTree;

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
        const selected = await openDialog({
          directory: true,
          multiple: false,
          title: t("selectFolderDialog")
        });
        const value = Array.isArray(selected) ? selected[0] : selected;
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

  return (
    <div className="app" style={layoutStyle}>
      <div className="backdrop-orb orb-a" />
      <div className="backdrop-orb orb-b" />
      <header className="topbar">
        <div className="brand-group">
          <div className="logo" data-testid="app-logo">
            <span className="dot" />
            <div className="logo-copy">
              <strong>Coder Studio</strong>
              <span>{t("appTagline")}</span>
            </div>
          </div>
          <div className="workspace-banner" data-testid="workspace-pill">
            <span className="banner-label">{t("workspaceLabel")}</span>
            <span className="banner-value">{displayPathName(activeTab.project?.path) || t("noWorkspace")}</span>
          </div>
        </div>
        <div className="tabs shell-tabs">
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${tab.id === state.activeTabId ? "active" : ""} ${tab.status}`}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="dot" />
              <span>{displayWorkspaceTitle(tab.title)}</span>
            </button>
          ))}
        </div>
        <div className="topbar-actions">
          <div className="metric-chip">{t("activeCount", { count: sessionCounts.active })}</div>
          <div className="metric-chip">{t("waitingCount", { count: sessionCounts.waiting })}</div>
          <div className="metric-chip">{t("queuedCount", { count: sessionCounts.queued })}</div>
          <div className="locale-toggle" aria-label={t("languageLabel")}>
            <button
              type="button"
              className={`btn tiny ghost mode ${locale === "en" ? "active" : ""}`}
              onClick={() => setLocale("en")}
              data-testid="locale-en"
            >
              EN
            </button>
            <button
              type="button"
              className={`btn tiny ghost mode ${locale === "zh" ? "active" : ""}`}
              onClick={() => setLocale("zh")}
              data-testid="locale-zh"
            >
              中文
            </button>
          </div>
          <button className="btn tiny ghost" type="button" onClick={onOpenSettings} data-testid="settings-open">
            {t("settings")}
          </button>
          <button className="tab add" onClick={onAddTab} data-testid="tab-add">{t("newTab")}</button>
        </div>
      </header>

      <main className="workspace-layout">
        <section className="panel left-panel">
          <div className="panel-inner sidebar-panel">
            <div className="section workspace-brief">
              <div className="section-kicker">{t("workspaceBrief")}</div>
              <div className="brief-grid">
                <div className="brief-card">
                  <span>{t("branch")}</span>
                  <strong>{activeTab.git.branch}</strong>
                </div>
                <div className="brief-card">
                  <span>{t("changes")}</span>
                  <strong>{activeTab.git.changes}</strong>
                </div>
                <div className="brief-card">
                  <span>{t("path")}</span>
                  <strong>{displayPathName(activeTab.project?.path) || t("noWorkspace")}</strong>
                </div>
              </div>
            </div>

            <div className="section mission-control">
              <div className="section-head">
                <div>
                  <div className="section-kicker">{t("missionControl")}</div>
                  <h3>{t("sessionOperations")}</h3>
                </div>
                <div className="section-actions">
                  <button className="btn tiny" onClick={onNewSession} disabled={isArchiveView} data-testid="session-new">{t("newSession")}</button>
                  <button className="btn tiny ghost" onClick={onSessionEnd} disabled={isArchiveView}>{t("complete")}</button>
                  <button className="btn tiny ghost danger" onClick={onStopAgent} disabled={isArchiveView}>{t("stop")}</button>
                </div>
              </div>
              <div className="stats-strip">
                <div className="stat-tile">
                  <span>{t("pool")}</span>
                  <strong>{poolSummary(activeTab, t)}</strong>
                </div>
                <div className="stat-tile">
                  <span>{t("currentTask")}</span>
                  <strong>{activeTask?.text ?? t("awaitingInstruction")}</strong>
                </div>
              </div>
              <div className="session-mode">
                <div className="label">{t("mode")}</div>
                <div className="mode-toggle">
                  <button className={`btn tiny mode ${queueSession.mode === "branch" ? "active" : ""}`} onClick={() => onUpdateSessionMode("branch")} disabled={isArchiveView}>
                    {t("branchMode")}
                  </button>
                  <button className={`btn tiny mode ${queueSession.mode === "git_tree" ? "active" : ""}`} onClick={() => onUpdateSessionMode("git_tree")} disabled={isArchiveView}>
                    {t("gitTreeMode")}
                  </button>
                </div>
              </div>
            </div>

            <div className="section session-list-card">
              <div className="section-head">
                <div>
                  <div className="section-kicker">{t("sessionDeck")}</div>
                  <h3>{t("parallelWorkstreams")}</h3>
                </div>
              </div>
              <div className="list session-list">
                {activeTab.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item session-card ${session.id === activeTab.activeSessionId ? "active" : ""}`}
                  >
                    <button className="session-main" onClick={() => onSwitchSession(session.id)}>
                      <div className="session-title-row">
                        <div className="session-title">{displaySessionTitle(session.title)}</div>
                        <span className={`badge ${session.status}`}>{sessionStatusLabel(session.status, t)}</span>
                      </div>
                      <div className="session-meta">
                        <span>{modeLabel(session.mode, t)}</span>
                        <span>{t("tasksCount", { count: session.queue.length })}</span>
                        <span>{t("completePercent", { percent: sessionCompletionRatio(session) })}</span>
                      </div>
                    </button>
                    <div className="session-actions">
                      {session.unread > 0 && <span className="unread">{session.unread}</span>}
                      <button className="btn tiny ghost" onClick={() => void onArchiveSession(session.id)}>{t("archive")}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="section queue-card">
              <div className="section-head">
                <div>
                  <div className="section-kicker">{t("taskQueue")}</div>
                  <h3>{t("dispatchBoard")}</h3>
                </div>
                <label className="toggle">
                  <input type="checkbox" checked={queueSession.autoFeed} onChange={onToggleAutoFeed} disabled={isArchiveView} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                  <span>{t("autoFeed")}</span>
                </label>
              </div>
              <div className="queue-controls">
                <input value={queueInput} onChange={(e) => setQueueInput(e.target.value)} placeholder={t("queuePlaceholder")} disabled={isArchiveView} data-testid="queue-input" />
                <button className="btn tiny" onClick={() => void onQueueAdd()} disabled={isArchiveView} data-testid="queue-add">{t("add")}</button>
                <button className="btn tiny ghost" onClick={onQueueRun} disabled={isArchiveView || Boolean(activeTaskForSession(activeSession))} data-testid="queue-run">{t("runNext")}</button>
              </div>
              <div className="current-task-banner">
                <span>{t("liveTask")}</span>
                <strong>{activeTask?.text ?? t("noTaskInProgress")}</strong>
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

            <div className="section ecosystem-card">
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
                      <div className="muted">{tree.status}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mini-section">
                <div className="section-kicker">{t("archiveLog")}</div>
                <div className="archive-log">
                  {activeTab.archive.length === 0 && <div className="empty">{t("noArchiveYet")}</div>}
                  {activeTab.archive.map((entry) => (
                    <button key={entry.id} className="archive-item" onClick={() => onSelectArchive(entry.id)}>
                      <div>{entry.time}</div>
                      <div>{displaySessionTitle(entry.snapshot.title)}</div>
                      <div className="muted">{modeLabel(entry.mode, t)}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="section grow repo-card">
              <div className="section-head">
                <div>
                  <div className="section-kicker">{t("repositoryNavigator")}</div>
                  <h3>{t("projectStructure")}</h3>
                </div>
                <div className="mode-toggle">
                  <button className={`btn tiny mode ${repoTreeMode === "files" ? "active" : ""}`} onClick={() => void onRepoTreeModeChange("files")}>{t("files")}</button>
                  <button className={`btn tiny mode ${repoTreeMode === "changes" ? "active" : ""}`} onClick={() => void onRepoTreeModeChange("changes")}>{t("changes")}</button>
                </div>
              </div>
              {repoTreeNodes.length === 0 && <div className="tree-empty">{repoTreeMode === "files" ? t("selectProjectToLoadFiles") : t("noChangesDetected")}</div>}
              <TreeView
                nodes={repoTreeNodes}
                onSelect={onFileSelect}
                collapsedPaths={repoCollapsedPaths}
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
          </div>
        </section>

        <div className="v-resizer" data-resize="left" onPointerDown={onResizeStart("left")} />

        <section className="panel center-panel">
          <div className="panel-inner studio-panel">
            <div className="studio-header">
              <div className="studio-copy">
                <div className="section-kicker">{t("liveSession")}</div>
                <h1>{displaySessionTitle(sessionForView.title)}</h1>
                <p>{activeTask?.text ?? t("liveSessionDescription")}</p>
              </div>
              <div className="studio-side">
                <div className={`status-pill ${sessionForView.status}`}>{sessionStatusLabel(sessionForView.status, t)}</div>
                <div className="status-pill neutral">{modeLabel(sessionForView.mode, t)}</div>
                <div className="status-pill neutral">{t("completePercent", { percent: completionRatio })}</div>
              </div>
            </div>

            <div className="studio-toolbar">
              <div className="interaction-note">
                <div className="section-kicker">{t("inputConsole")}</div>
                <div className="hint">{t("inputConsoleHint")}</div>
              </div>
              <div className="agent-progress wide">
                <div className="bar" style={{ width: `${completionRatio}%` }} />
              </div>
            </div>

            {isArchiveView && (
              <div className="archive-banner">
                <div>
                  {t("viewingArchivedSession")}
                  <div className="hint">{t("exitArchiveHint")}</div>
                </div>
                <button className="btn tiny" onClick={onExitArchive}>{t("exit")}</button>
              </div>
            )}

            <div className="stage-card">
              <div className="stage-header">
                <div>
                  <div className="section-kicker">{t("agentOutput")}</div>
                  <h3>{activeTask?.text ?? t("interactiveCommandStream")}</h3>
                </div>
                <div className="stage-meta">
                  <span>{activeTask ? t("executing") : t("listening")}</span>
                  <span>{activeTab.agent.provider}</span>
                </div>
              </div>
              <div
                className="agent-terminal"
                ref={agentTerminalRef}
                onClick={() => agentInputRef.current?.focus()}
                data-testid="agent-terminal"
              >
                {isArchiveView && (
                  <div className="terminal-empty">{t("archiveViewReadonly")}</div>
                )}
              </div>
              <div className="agent-input">
                <input
                  ref={agentInputRef}
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  placeholder={t("agentInputPlaceholder")}
                  disabled={isArchiveView}
                  data-testid="agent-input"
                  onKeyDown={onAgentInputKeyDown}
                />
                <div className="agent-input-actions">
                  <div className="special-key-row">
                    {agentSpecialKeys.map((item) => (
                      <button
                        key={item.key}
                        className="btn tiny ghost special-key"
                        onClick={() => void onSendSpecialAgentKey(item.sequence)}
                        disabled={isArchiveView}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => void onSendAgent()} disabled={isArchiveView} data-testid="agent-send">{t("send")}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="v-resizer" data-resize="right" onPointerDown={onResizeStart("right")} />

        <section className="panel right">
          <div className="panel-inner inspector-panel">
            <div className="inspector-card file-preview">
              <div className="section-head">
                <div>
                  <div className="section-kicker">{t("repositoryInspector")}</div>
                  <h3>{hasPreviewFile ? activeTab.filePreview.path : t("selectFileFromNavigator")}</h3>
                </div>
                {previewMode === "preview" && hasPreviewFile && (
                  <div className="section-actions">
                    <span className={`pill ${activeTab.filePreview.dirty ? "warning" : ""}`}>
                      {activeTab.filePreview.dirty ? t("unsavedChanges") : t("editorReady")}
                    </span>
                    <button
                      className="btn tiny"
                      type="button"
                      onClick={() => void onSavePreview()}
                      disabled={!activeTab.filePreview.dirty}
                      data-testid="preview-save"
                    >
                      {t("save")}
                    </button>
                  </div>
                )}
              </div>
              <div className="file-tabs">
                <div className={`t-tab ${previewMode === "preview" ? "active" : ""}`} onClick={() => void onPreviewMode("preview")}>{t("preview")}</div>
                <div className={`t-tab ${previewMode === "diff" ? "active" : ""}`} onClick={() => void onPreviewMode("diff")}>{t("diff")}</div>
              </div>
              {previewMode === "preview" && hasPreviewFile && (
                <div className="editor-banner">
                  <span>{t("editorHint")}</span>
                </div>
              )}
              {previewMode === "diff" && hasPreviewFile && (
                <div className="diff-toolbar">
                  <div className="diff-stats">
                    {t("filesStat", {
                      count: activeTab.filePreview.diffStats?.files ?? 0,
                      additions: activeTab.filePreview.diffStats?.additions ?? 0,
                      deletions: activeTab.filePreview.diffStats?.deletions ?? 0
                    })}
                  </div>
                  <div className="diff-files">
                    {(activeTab.filePreview.diffFiles ?? fileTabs.map((file) => file.path)).slice(0, 5).map((file) => (
                      <span key={file} className="chip">{file}</span>
                    ))}
                  </div>
                </div>
              )}
              {previewMode === "preview" ? (
                hasPreviewFile ? (
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
                        fontFamily: "IBM Plex Mono, JetBrains Mono, monospace",
                        fontSize: 13,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        padding: { top: 14, bottom: 14 },
                        lineNumbersMinChars: 3,
                        renderWhitespace: "selection"
                      }}
                    />
                  </div>
                ) : (
                  <div className="preview-empty">{t("selectFileFromNavigator")}</div>
                )
              ) : (
                hasPreviewFile
                  ? <pre className="diff code-surface">{activeTab.filePreview.diff || t("noDiffAvailable")}</pre>
                  : <div className="preview-empty">{t("selectFileFromNavigator")}</div>
              )}
            </div>
            <div className="h-resizer" data-resize="right-top" onPointerDown={onResizeStart("right-top")} />
            <div className="inspector-card terminal-card">
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
                    {displayTerminalTitle(term.title)}
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
          </div>
        </section>
      </main>

      <div className="toast-container">
        {toasts.map((toast) => (
          <button key={toast.id} className="toast" onClick={() => onSwitchSession(toast.sessionId)}>
            {toast.text}
          </button>
        ))}
      </div>

      {settingsOpen && (
        <div className="modal-overlay">
          <div className="modal-card settings-modal" data-testid="settings-modal">
            <div className="modal-header">
              <div>
                <div className="section-kicker">{t("globalSettings")}</div>
                <h3>{t("settings")}</h3>
                <div className="hint">{t("settingsDescription")}</div>
              </div>
              <button className="btn tiny" type="button" onClick={onCloseSettings}>{t("close")}</button>
            </div>
            <div className="settings-summary">
              <span className="pill">{t("appliesToAllWorkspaces")}</span>
              <span className="pill">{t("changesAffectNextLaunch")}</span>
            </div>
            <div className="settings-grid">
              <section className="settings-section">
                <div className="section-kicker">{t("agentDefaults")}</div>
                <h4>{t("agentConfiguration")}</h4>
                <p className="hint">{t("agentDefaultsHint")}</p>
                <div className="form-row">
                  <label>{t("provider")}</label>
                  <select
                    value={settingsDraft.agentProvider}
                    onChange={(e) => onUpdateSettings({ agentProvider: e.target.value as "claude" | "codex" })}
                    data-testid="settings-agent-provider"
                  >
                    <option value="claude">Claude</option>
                    <option value="codex">Codex</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>{t("launchCommand")}</label>
                  <input
                    value={settingsDraft.agentCommand}
                    onChange={(e) => onUpdateSettings({ agentCommand: e.target.value })}
                    placeholder={t("launchCommandPlaceholder")}
                    data-testid="settings-agent-command"
                  />
                </div>
              </section>
              <section className="settings-section">
                <div className="section-kicker">{t("suspendStrategy")}</div>
                <h4>{t("autoSuspend")}</h4>
                <p className="hint">{t("suspendStrategyHint")}</p>
                <div className="session-policy">
                  <div className="policy-row">
                    <span>{t("autoSuspend")}</span>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={settingsDraft.idlePolicy.enabled}
                        onChange={() => onUpdateSettingsIdlePolicy({ enabled: !settingsDraft.idlePolicy.enabled })}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                  </div>
                  <div className="policy-row">
                    <span>{t("idleAfter")}</span>
                    <div>
                      <input
                        type="number"
                        min={1}
                        value={settingsDraft.idlePolicy.idleMinutes}
                        onChange={(e) => onUpdateSettingsIdlePolicy({ idleMinutes: Number(e.target.value) })}
                        data-testid="settings-idle-minutes"
                      />
                      <span>{t("minutesShort")}</span>
                    </div>
                  </div>
                  <div className="policy-row">
                    <span>{t("maxActive")}</span>
                    <div>
                      <input
                        type="number"
                        min={1}
                        value={settingsDraft.idlePolicy.maxActive}
                        onChange={(e) => onUpdateSettingsIdlePolicy({ maxActive: Number(e.target.value) })}
                        data-testid="settings-max-active"
                      />
                      <span>{t("sessionsWord")}</span>
                    </div>
                  </div>
                  <div className="policy-row">
                    <span>{t("memoryPressure")}</span>
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
              </section>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={onCloseSettings}>{t("cancel")}</button>
              <button className="btn primary" type="button" onClick={onApplySettings} data-testid="settings-apply">{t("applySettings")}</button>
            </div>
          </div>
        </div>
      )}

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

      {!state.overlay.visible && activeTab.status === "init" && (
        <button className="reopen-overlay" onClick={() => openOverlayForTab(activeTab.id)}>
          {t("initializeWorkspace")}
        </button>
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
};

const TreeView = ({ nodes, depth = 0, onSelect, collapsedPaths, onToggleCollapse }: TreeProps) => {
  if (!nodes?.length) return null;
  return (
    <div className="tree tree-list">
      {nodes.map((node) => (
        <div key={node.path}>
          <div
            className={`tree-line indent-${depth} ${node.kind === "file" ? "file" : ""} ${node.status ? "changed" : ""}`}
            onClick={() => {
              if (node.kind === "dir") {
                onToggleCollapse?.(node.path);
                return;
              }
              onSelect?.(node);
            }}
          >
            {node.kind === "dir" && (
              <span className="tree-disclosure">{collapsedPaths?.has(node.path) ? "▸" : "▾"}</span>
            )}
            <span className="tree-label">{node.name}{node.kind === "dir" ? "/" : ""}</span>
            {node.status && <span className="status">{node.status}</span>}
          </div>
          {node.children?.length && !collapsedPaths?.has(node.path) ? (
            <TreeView
              nodes={node.children}
              depth={depth + 1}
              onSelect={onSelect}
              collapsedPaths={collapsedPaths}
              onToggleCollapse={onToggleCollapse}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
};
