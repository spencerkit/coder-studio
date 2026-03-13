import { state } from "@relax-state/react";
import {
  Locale,
  formatSessionReadyMessage,
  formatSessionTitle,
  formatWorkspaceTitle,
  getPreferredLocale
} from "../i18n";

export type SessionStatus = "idle" | "running" | "background" | "waiting" | "suspended" | "queued";
export type SessionMode = "branch" | "git_tree";
export type QueueTaskStatus = "queued" | "running" | "done";
export type AgentMessageRole = "system" | "user" | "agent";

export type ExecTarget =
  | { type: "native" }
  | { type: "wsl"; distro?: string };

export type IdlePolicy = {
  enabled: boolean;
  idleMinutes: number;
  maxActive: number;
  pressure: boolean;
};

export type QueueTask = {
  id: string;
  text: string;
  status: QueueTaskStatus;
};

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  content: string;
  time: string;
};

export type Session = {
  id: string;
  title: string;
  status: SessionStatus;
  mode: SessionMode;
  autoFeed: boolean;
  isDraft?: boolean;
  queue: QueueTask[];
  messages: AgentMessage[];
  stream: string;
  unread: number;
  lastActiveAt: number;
};

export type GitStatus = {
  branch: string;
  changes: number;
  lastCommit: string;
};

export type WorktreeInfo = {
  name: string;
  path: string;
  branch: string;
  status: string;
  diff?: string;
  tree?: TreeNode[];
  changes?: TreeNode[];
};

export type TreeNode = {
  name: string;
  path: string;
  kind: "dir" | "file";
  status?: string;
  children?: TreeNode[];
};

export type FilePreview = {
  path: string;
  content: string;
  mode: "preview" | "diff";
  diff?: string;
  diffStats?: { files: number; additions: number; deletions: number };
  diffFiles?: string[];
  dirty?: boolean;
};

export type Terminal = {
  id: string;
  title: string;
  output: string;
};

export type Project = {
  kind: "local" | "remote";
  path: string;
  gitUrl?: string;
  target: ExecTarget;
};

export type ArchiveEntry = {
  id: string;
  sessionId: string;
  time: string;
  mode: SessionMode;
  snapshot: Session;
};

export type Tab = {
  id: string;
  title: string;
  status: "init" | "ready";
  project?: Project;
  agent: {
    provider: "claude" | "codex";
    command: string;
    useWsl: boolean;
    distro?: string;
  };
  git: GitStatus;
  worktrees: WorktreeInfo[];
  sessions: Session[];
  activeSessionId: string;
  archive: ArchiveEntry[];
  terminals: Terminal[];
  activeTerminalId: string;
  fileTree: TreeNode[];
  changesTree: TreeNode[];
  filePreview: FilePreview;
  idlePolicy: IdlePolicy;
  viewingArchiveId?: string;
};

export type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  rightTopHeight: number;
};

export type WorkbenchState = {
  tabs: Tab[];
  activeTabId: string;
  layout: LayoutState;
  overlay: {
    visible: boolean;
    tabId?: string;
    mode: "remote" | "local";
    input: string;
    target: ExecTarget;
  };
};

const WORKBENCH_STORAGE_KEY = "coder-studio.workbench";

const nowLabel = () => {
  const date = new Date();
  const h = `${date.getHours()}`.padStart(2, "0");
  const m = `${date.getMinutes()}`.padStart(2, "0");
  return `${h}:${m}`;
};

export const createId = (prefix = "id") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createEmptyPreview = (): FilePreview => ({
  path: "",
  content: "",
  mode: "preview",
  dirty: false
});

export const createSession = (index: number, mode: SessionMode = "branch", locale: Locale = getPreferredLocale()): Session => ({
  id: createId("session"),
  title: formatSessionTitle(index, locale),
  status: "idle",
  mode,
  autoFeed: true,
  isDraft: false,
  queue: [],
  messages: [
    { id: createId("msg"), role: "system", content: formatSessionReadyMessage(index, locale), time: nowLabel() }
  ],
  stream: "",
  unread: 0,
  lastActiveAt: Date.now()
});

export const createTab = (index: number, locale: Locale = getPreferredLocale()): Tab => {
  const session = createSession(1, "branch", locale);

  return {
    id: createId("tab"),
    title: formatWorkspaceTitle(index, locale),
    status: "init",
    agent: {
      provider: "claude",
      command: "claude",
      useWsl: false
    },
    git: { branch: "—", changes: 0, lastCommit: "—" },
    worktrees: [],
    sessions: [session],
    activeSessionId: session.id,
    archive: [],
    terminals: [],
    activeTerminalId: "",
    fileTree: [],
    changesTree: [],
    filePreview: createEmptyPreview(),
    idlePolicy: {
      enabled: true,
      idleMinutes: 10,
      maxActive: 3,
      pressure: true
    }
  };
};

const createDefaultWorkbenchState = (): WorkbenchState => {
  const initialTab = createTab(1, getPreferredLocale());
  return {
    tabs: [initialTab],
    activeTabId: initialTab.id,
    layout: {
      leftWidth: 280,
      rightWidth: 360,
      rightTopHeight: 52
    },
    overlay: {
      visible: true,
      tabId: initialTab.id,
      mode: "remote",
      input: "",
      target: { type: "native" }
    }
  };
};

const sanitizeTabSessions = (tab: Tab, locale: Locale): Tab => {
  const sessions = (tab.sessions ?? []).filter((session) => session && !session.isDraft);
  const fallbackSessions = sessions.length ? sessions : [createSession(1, "branch", locale)];
  const activeSessionId = fallbackSessions.some((session) => session.id === tab.activeSessionId)
    ? tab.activeSessionId
    : fallbackSessions[0].id;

  return {
    ...tab,
    sessions: fallbackSessions,
    activeSessionId
  };
};

const normalizeWorkbenchState = (input: Partial<WorkbenchState> | null | undefined): WorkbenchState => {
  const fallback = createDefaultWorkbenchState();
  if (!input?.tabs?.length) return fallback;

  const locale = getPreferredLocale();
  const tabs = input.tabs.filter(Boolean).map((tab) => sanitizeTabSessions(tab, locale));
  if (!tabs.length) return fallback;

  const activeTabId = tabs.some((tab) => tab.id === input.activeTabId) ? input.activeTabId ?? tabs[0].id : tabs[0].id;
  const hasHistory = tabs.some((tab) =>
    tab.status === "ready"
    || (tab.sessions?.length ?? 0) > 1
    || Boolean(tab.sessions?.[0]?.stream)
    || (tab.archive?.length ?? 0) > 0
  );

  return {
    tabs,
    activeTabId,
    layout: {
      leftWidth: input.layout?.leftWidth ?? fallback.layout.leftWidth,
      rightWidth: input.layout?.rightWidth ?? fallback.layout.rightWidth,
      rightTopHeight: input.layout?.rightTopHeight ?? fallback.layout.rightTopHeight
    },
    overlay: {
      visible: hasHistory ? false : input.overlay?.visible ?? fallback.overlay.visible,
      tabId: input.overlay?.tabId ?? activeTabId,
      mode: input.overlay?.mode ?? fallback.overlay.mode,
      input: input.overlay?.input ?? fallback.overlay.input,
      target: input.overlay?.target ?? fallback.overlay.target
    }
  };
};

const readStoredWorkbenchState = (): WorkbenchState => {
  if (typeof window === "undefined") return createDefaultWorkbenchState();
  try {
    const raw = window.localStorage.getItem(WORKBENCH_STORAGE_KEY);
    if (!raw) return createDefaultWorkbenchState();
    return normalizeWorkbenchState(JSON.parse(raw) as Partial<WorkbenchState>);
  } catch {
    return createDefaultWorkbenchState();
  }
};

export const persistWorkbenchState = (next: WorkbenchState) => {
  if (typeof window === "undefined") return;
  try {
    const locale = getPreferredLocale();
    const sanitized: WorkbenchState = {
      ...next,
      tabs: next.tabs.map((tab) => sanitizeTabSessions(tab, locale))
    };
    window.localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage failures and keep state in memory.
  }
};

export const workbenchStorageKey = WORKBENCH_STORAGE_KEY;

export const workbenchState = state<WorkbenchState>({
  ...readStoredWorkbenchState()
});
