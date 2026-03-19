import { state } from "@relax-state/react";
import {
  Locale,
  formatSessionReadyMessage,
  formatSessionTitle,
  formatWorkspaceTitle,
  getPreferredLocale
} from "../i18n";

export type SessionStatus = "idle" | "running" | "background" | "waiting" | "suspended" | "queued" | "interrupted";
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
  claudeSessionId?: string;
};

export type GitStatus = {
  branch: string;
  changes: number;
  lastCommit: string;
};

export type GitChange = {
  path: string;
  name: string;
  parent: string;
  section: "staged" | "changes" | "untracked";
  status: string;
  code: string;
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
  originalContent?: string;
  modifiedContent?: string;
  diffStats?: { files: number; additions: number; deletions: number };
  diffFiles?: string[];
  dirty?: boolean;
  source?: "tree" | "git";
  statusLabel?: string;
  parentPath?: string;
  section?: "staged" | "changes" | "untracked";
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

export type SessionPaneLeaf = {
  type: "leaf";
  id: string;
  sessionId: string;
};

export type SessionPaneSplit = {
  type: "split";
  id: string;
  axis: "horizontal" | "vertical";
  ratio: number;
  first: SessionPaneNode;
  second: SessionPaneNode;
};

export type SessionPaneNode = SessionPaneLeaf | SessionPaneSplit;

export type Tab = {
  id: string;
  title: string;
  status: "init" | "ready";
  project?: Project;
  agent: {
    provider: "claude";
    command: string;
    useWsl: boolean;
    distro?: string;
  };
  git: GitStatus;
  gitChanges: GitChange[];
  worktrees: WorktreeInfo[];
  sessions: Session[];
  activeSessionId: string;
  archive: ArchiveEntry[];
  terminals: Terminal[];
  activeTerminalId: string;
  fileTree: TreeNode[];
  changesTree: TreeNode[];
  filePreview: FilePreview;
  paneLayout: SessionPaneNode;
  activePaneId: string;
  idlePolicy: IdlePolicy;
  viewingArchiveId?: string;
};

export type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  rightSplit: number;
  showCodePanel: boolean;
  showTerminalPanel: boolean;
};

export type WorkbenchState = {
  tabs: Tab[];
  activeTabId: string;
  layout: LayoutState;
  overlay: {
    visible: boolean;
    mode: "remote" | "local";
    input: string;
    target: ExecTarget;
  };
};

const clampLayoutLeftWidth = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 320;
  return Math.max(0, Number(value));
};

const clampLayoutRightWidth = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 320;
  return Math.max(0, Number(value));
};

const clampLayoutRightSplit = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 64;
  return Math.min(100, Math.max(0, Number(value)));
};

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
  originalContent: "",
  modifiedContent: "",
  dirty: false
});

export const createPaneLeaf = (sessionId: string): SessionPaneLeaf => ({
  type: "leaf",
  id: createId("pane"),
  sessionId
});

export const createPaneLayout = (sessionId: string): SessionPaneNode => createPaneLeaf(sessionId);

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
  const paneLayout = createPaneLayout(session.id);

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
    gitChanges: [],
    worktrees: [],
    sessions: [session],
    activeSessionId: session.id,
    archive: [],
    terminals: [],
    activeTerminalId: "",
    fileTree: [],
    changesTree: [],
    filePreview: createEmptyPreview(),
    paneLayout,
    activePaneId: paneLayout.id,
    idlePolicy: {
      enabled: true,
      idleMinutes: 10,
      maxActive: 3,
      pressure: true
    }
  };
};

export const createDefaultWorkbenchState = (): WorkbenchState => {
  return {
    tabs: [],
    activeTabId: "",
    layout: {
      leftWidth: 320,
      rightWidth: 320,
      rightSplit: 64,
      showCodePanel: false,
      showTerminalPanel: false
    },
    overlay: {
      visible: true,
      mode: "local",
      input: "",
      target: { type: "native" }
    }
  };
};

const collectLeafPaneIds = (node: SessionPaneNode | undefined | null): string[] => {
  if (!node) return [];
  if (node.type === "leaf") return [node.id];
  return [...collectLeafPaneIds(node.first), ...collectLeafPaneIds(node.second)];
};

const sanitizePaneLayout = (
  node: SessionPaneNode | undefined | null,
  fallbackSessionId: string
): SessionPaneNode => {
  if (!node) {
    return createPaneLayout(fallbackSessionId);
  }

  if (node.type === "leaf") {
    return {
      type: "leaf",
      id: node.id || createId("pane"),
      sessionId: node.sessionId || fallbackSessionId
    };
  }

  return {
    type: "split",
    id: node.id || createId("pane"),
    axis: node.axis === "vertical" ? "vertical" : "horizontal",
    ratio: Number.isFinite(node.ratio) ? Math.min(1, Math.max(0, node.ratio)) : 0.5,
    first: sanitizePaneLayout(node.first, fallbackSessionId),
    second: sanitizePaneLayout(node.second, fallbackSessionId)
  };
};

const sanitizeTabSessions = (tab: Tab, locale: Locale): Tab => {
  const allSessions = (tab.sessions ?? []).filter(Boolean);
  const persistedSessions = allSessions.filter((session) => !session.isDraft);
  const sessions = persistedSessions.length ? persistedSessions : allSessions;
  const fallbackSessions = sessions.length ? sessions : [createSession(1, "branch", locale)];
  const activeSessionId = fallbackSessions.some((session) => session.id === tab.activeSessionId)
    ? tab.activeSessionId
    : fallbackSessions[0].id;
  const validSessionIds = new Set(fallbackSessions.map((session) => session.id));
  const sanitizedLayout = sanitizePaneLayout(tab.paneLayout, activeSessionId);
  const normalizedLayout = (() => {
    const visit = (node: SessionPaneNode): SessionPaneNode => {
      if (node.type === "leaf") {
        return {
          ...node,
          sessionId: validSessionIds.has(node.sessionId) ? node.sessionId : activeSessionId
        };
      }
      return {
        ...node,
        first: visit(node.first),
        second: visit(node.second)
      };
    };
    return visit(sanitizedLayout);
  })();
  const leafIds = collectLeafPaneIds(normalizedLayout);
  const activePaneId = leafIds.includes(tab.activePaneId) ? tab.activePaneId : leafIds[0];

  return {
    ...tab,
    gitChanges: tab.gitChanges ?? [],
    sessions: fallbackSessions,
    activeSessionId,
    paneLayout: normalizedLayout,
    activePaneId
  };
};

export const normalizeWorkbenchState = (input: Partial<WorkbenchState> | null | undefined): WorkbenchState => {
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
  const legacyLayout = input.layout as (LayoutState & { rightTopHeight?: number; rightCollapsed?: boolean }) | undefined;

  return {
    tabs,
    activeTabId,
    layout: {
      leftWidth: clampLayoutLeftWidth(legacyLayout?.leftWidth ?? fallback.layout.leftWidth),
      rightWidth: clampLayoutRightWidth(legacyLayout?.rightWidth ?? fallback.layout.rightWidth),
      rightSplit: clampLayoutRightSplit(legacyLayout?.rightSplit ?? legacyLayout?.rightTopHeight ?? fallback.layout.rightSplit),
      showCodePanel: legacyLayout?.showCodePanel ?? (typeof legacyLayout?.rightCollapsed === "boolean" ? !legacyLayout.rightCollapsed : fallback.layout.showCodePanel),
      showTerminalPanel: legacyLayout?.showTerminalPanel ?? fallback.layout.showTerminalPanel
    },
    overlay: {
      visible: hasHistory ? false : input.overlay?.visible ?? fallback.overlay.visible,
      mode: input.overlay?.mode ?? fallback.overlay.mode,
      input: input.overlay?.input ?? fallback.overlay.input,
      target: input.overlay?.target ?? fallback.overlay.target
    }
  };
};

export const hydrateWorkbenchState = (input: Partial<WorkbenchState> | null | undefined): WorkbenchState => normalizeWorkbenchState(input);

export const persistWorkbenchState = (_next: WorkbenchState) => {
  // Workbench business state now lives in backend SQLite only.
};

export const workbenchState = state<WorkbenchState>({
  ...createDefaultWorkbenchState()
});
