import { formatTerminalTitle, type Locale } from "../../i18n";
import {
  createDefaultWorkbenchState,
  createEmptyPreview,
  createPaneLeaf,
  normalizeWorkbenchState,
  type FilePreview,
  type LayoutState,
  type Tab,
  type Terminal,
  type WorkbenchState,
} from "../../state/workbench";
import type {
  AppSettings,
  BackendArchiveEntry,
  BackendSession,
  WorkbenchBootstrap,
  WorkbenchLayout,
  WorkbenchUiState,
  WorkspaceSnapshot,
} from "../../types/app";
import { createDraftSessionPlaceholder, createSessionFromBackend, isDraftSession } from "./session";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const normalizeFilePreview = (
  value: unknown,
  existing?: FilePreview,
): FilePreview => {
  const candidate = (value && typeof value === "object") ? value as Partial<FilePreview> : {};
  return {
    ...createEmptyPreview(),
    ...existing,
    ...candidate,
    path: typeof candidate.path === "string" ? candidate.path : (existing?.path ?? ""),
    content: typeof candidate.content === "string" ? candidate.content : (existing?.content ?? ""),
    mode: candidate.mode === "diff" ? "diff" : "preview",
    diff: typeof candidate.diff === "string" ? candidate.diff : (existing?.diff ?? ""),
    originalContent: typeof candidate.originalContent === "string" ? candidate.originalContent : (existing?.originalContent ?? ""),
    modifiedContent: typeof candidate.modifiedContent === "string" ? candidate.modifiedContent : (existing?.modifiedContent ?? ""),
    dirty: candidate.dirty ?? existing?.dirty ?? false,
    source: candidate.source ?? existing?.source,
    statusLabel: typeof candidate.statusLabel === "string" ? candidate.statusLabel : existing?.statusLabel,
    parentPath: typeof candidate.parentPath === "string" ? candidate.parentPath : existing?.parentPath,
    section: candidate.section ?? existing?.section,
  };
};

const mapArchiveEntry = (
  entry: BackendArchiveEntry & { snapshot: BackendSession },
  locale: Locale,
) => ({
  id: String(entry.id),
  sessionId: String(entry.session_id),
  time: entry.time,
  mode: entry.mode,
  snapshot: createSessionFromBackend(entry.snapshot, locale),
});

const mapTerminals = (
  terminals: WorkspaceSnapshot["terminals"],
  locale: Locale,
  existing?: Tab,
): { terminals: Terminal[]; activeTerminalId: string } => {
  if (!terminals.length) {
    const nextTerminals = existing?.terminals ?? [];
    const nextActiveTerminalId = nextTerminals.some((terminal) => terminal.id === existing?.activeTerminalId)
      ? existing?.activeTerminalId ?? ""
      : (nextTerminals[0]?.id ?? "");
    return { terminals: nextTerminals, activeTerminalId: nextActiveTerminalId };
  }

  const nextTerminals = terminals.map((terminal, index) => {
    const id = `term-${terminal.id}`;
    const existingTerminal = existing?.terminals.find((item) => item.id === id);
    return {
      id,
      title: existingTerminal?.title ?? formatTerminalTitle(index + 1, locale),
      output: terminal.output ?? existingTerminal?.output ?? "",
    };
  });
  const nextActiveTerminalId = nextTerminals.some((terminal) => terminal.id === existing?.activeTerminalId)
    ? existing?.activeTerminalId ?? ""
    : (nextTerminals[0]?.id ?? "");
  return { terminals: nextTerminals, activeTerminalId: nextActiveTerminalId };
};

export const workbenchLayoutFromBackend = (layout: WorkbenchLayout): LayoutState => ({
  leftWidth: layout.left_width,
  rightWidth: layout.right_width,
  rightSplit: layout.right_split,
  showCodePanel: layout.show_code_panel,
  showTerminalPanel: layout.show_terminal_panel,
});

export const workbenchLayoutToBackend = (layout: LayoutState): WorkbenchLayout => ({
  left_width: layout.leftWidth,
  right_width: layout.rightWidth,
  right_split: layout.rightSplit,
  show_code_panel: layout.showCodePanel,
  show_terminal_panel: layout.showTerminalPanel,
});

export const createTabFromWorkspaceSnapshot = (
  snapshot: WorkspaceSnapshot,
  locale: Locale,
  appSettings: AppSettings,
  existing?: Tab,
): Tab => {
  const backendSessions = snapshot.sessions.map((session) => {
    const current = existing?.sessions.find((item) => item.id === String(session.id));
    return createSessionFromBackend(session, locale, current);
  });

  const existingDraftSessions = existing?.sessions.filter((session) => isDraftSession(session)) ?? [];
  const sessions = backendSessions.length > 0
    ? [...existingDraftSessions, ...backendSessions]
    : (
      existingDraftSessions.length > 0
        ? existingDraftSessions
        : [
            createDraftSessionPlaceholder({
              locale,
              workspacePath: snapshot.workspace.project_path,
              branch: existing?.git.branch,
            }),
          ]
    );

  const fallbackSessionId = sessions[0]?.id ?? existing?.activeSessionId ?? "1";
  const nextActiveSessionId = sessions.some((session) => session.id === snapshot.view_state.active_session_id)
    ? snapshot.view_state.active_session_id
    : sessions.some((session) => session.id === existing?.activeSessionId)
      ? existing?.activeSessionId ?? fallbackSessionId
    : fallbackSessionId;
  const terminalState = mapTerminals(snapshot.terminals, locale, existing);
  const candidate: Tab = {
    id: snapshot.workspace.workspace_id,
    title: snapshot.workspace.title,
    status: "ready",
    project: {
      kind: snapshot.workspace.source_kind,
      path: snapshot.workspace.project_path,
      gitUrl: snapshot.workspace.git_url ?? undefined,
      target: snapshot.workspace.target,
    },
    agent: {
      provider: appSettings.agentProvider,
      command: appSettings.agentCommand,
      useWsl: snapshot.workspace.target.type === "wsl",
      distro: snapshot.workspace.target.type === "wsl" ? snapshot.workspace.target.distro : undefined,
    },
    git: existing?.git ?? { branch: "—", changes: 0, lastCommit: "—" },
    gitChanges: existing?.gitChanges ?? [],
    worktrees: existing?.worktrees ?? [],
    sessions,
    activeSessionId: nextActiveSessionId,
    archive: snapshot.archive.map((entry) => mapArchiveEntry(entry, locale)),
    terminals: terminalState.terminals,
    activeTerminalId: terminalState.activeTerminalId,
    fileTree: existing?.fileTree ?? [],
    changesTree: existing?.changesTree ?? [],
    filePreview: normalizeFilePreview(snapshot.view_state.file_preview, existing?.filePreview),
    paneLayout: (snapshot.view_state.pane_layout as Tab["paneLayout"]) ?? createPaneLeaf(nextActiveSessionId),
    activePaneId: snapshot.view_state.active_pane_id || existing?.activePaneId || "",
    idlePolicy: {
      enabled: snapshot.workspace.idle_policy.enabled,
      idleMinutes: snapshot.workspace.idle_policy.idle_minutes,
      maxActive: snapshot.workspace.idle_policy.max_active,
      pressure: snapshot.workspace.idle_policy.pressure,
    },
    viewingArchiveId: undefined,
  };

  return normalizeWorkbenchState({
    tabs: [candidate],
    activeTabId: candidate.id,
    layout: createDefaultWorkbenchState().layout,
    overlay: {
      visible: false,
      mode: "remote",
      input: "",
      target: { type: "native" },
    },
  }).tabs[0];
};

const orderTabsByUiState = (
  tabs: Tab[],
  openWorkspaceIds: string[],
): Tab[] => {
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab]));
  return unique(openWorkspaceIds)
    .map((workspaceId) => tabMap.get(workspaceId))
    .filter((tab): tab is Tab => Boolean(tab));
};

const resolveActiveWorkspaceId = (
  tabs: Tab[],
  activeWorkspaceId?: string | null,
) => {
  if (activeWorkspaceId && tabs.some((tab) => tab.id === activeWorkspaceId)) {
    return activeWorkspaceId;
  }
  return tabs[0]?.id ?? "";
};

export const buildWorkbenchStateFromBootstrap = (
  current: WorkbenchState,
  bootstrap: WorkbenchBootstrap,
  locale: Locale,
  appSettings: AppSettings,
): WorkbenchState => {
  const currentTabs = new Map(current.tabs.map((tab) => [tab.id, tab]));
  const snapshotMap = new Map(bootstrap.workspaces.map((snapshot) => [snapshot.workspace.workspace_id, snapshot]));
  const tabs = unique(bootstrap.ui_state.open_workspace_ids)
    .map((workspaceId) => {
      const snapshot = snapshotMap.get(workspaceId);
      if (!snapshot) return null;
      return createTabFromWorkspaceSnapshot(snapshot, locale, appSettings, currentTabs.get(workspaceId));
    })
    .filter((tab): tab is Tab => Boolean(tab));

  return {
    tabs,
    activeTabId: resolveActiveWorkspaceId(tabs, bootstrap.ui_state.active_workspace_id),
    layout: workbenchLayoutFromBackend(bootstrap.ui_state.layout),
    overlay: {
      ...current.overlay,
      visible: tabs.length === 0,
      input: tabs.length === 0 ? current.overlay.input : "",
    },
  };
};

export const upsertWorkspaceSnapshot = (
  current: WorkbenchState,
  snapshot: WorkspaceSnapshot,
  locale: Locale,
  appSettings: AppSettings,
  uiState?: WorkbenchUiState | null,
): WorkbenchState => {
  const existing = current.tabs.find((tab) => tab.id === snapshot.workspace.workspace_id);
  const nextTab = createTabFromWorkspaceSnapshot(snapshot, locale, appSettings, existing);
  const tabMap = new Map(current.tabs.map((tab) => [tab.id, tab]));
  tabMap.set(nextTab.id, nextTab);
  const openWorkspaceIds = unique(uiState?.open_workspace_ids ?? [...current.tabs.map((tab) => tab.id), nextTab.id]);
  if (!openWorkspaceIds.includes(nextTab.id)) {
    openWorkspaceIds.push(nextTab.id);
  }
  const tabs = orderTabsByUiState(Array.from(tabMap.values()), openWorkspaceIds);

  return {
    ...current,
    tabs,
    activeTabId: resolveActiveWorkspaceId(tabs, uiState?.active_workspace_id ?? nextTab.id),
    layout: uiState ? workbenchLayoutFromBackend(uiState.layout) : current.layout,
    overlay: {
      ...current.overlay,
      visible: false,
      input: "",
    },
  };
};

export const applyWorkbenchUiState = (
  current: WorkbenchState,
  uiState: WorkbenchUiState,
): WorkbenchState => {
  const tabs = orderTabsByUiState(current.tabs, uiState.open_workspace_ids);
  return {
    ...current,
    tabs,
    activeTabId: resolveActiveWorkspaceId(tabs, uiState.active_workspace_id),
    layout: workbenchLayoutFromBackend(uiState.layout),
    overlay: {
      ...current.overlay,
      visible: tabs.length === 0,
    },
  };
};
