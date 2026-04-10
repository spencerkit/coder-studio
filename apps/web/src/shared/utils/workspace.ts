import { formatTerminalTitle, type Locale } from "../../i18n";
import {
  createWorkspaceControllerState,
  createWorkspaceControllerStateFromLease,
  type WorkspaceControllerState,
} from "../../features/workspace/workspace-controller";
import {
  createDefaultWorkbenchState,
  createEmptyPreview,
  createPaneLeaf,
  normalizeWorkbenchState,
  type FilePreview,
  type LayoutState,
  type Session,
  type SessionSupervisorState,
  type Tab,
  type Terminal,
  type WorkbenchState,
  type WorkspaceSupervisorCycle,
} from "../../state/workbench-core";
import type {
  AgentLifecycleHistoryEntry,
  AppSettings,
  BackendSession,
  WorkbenchBootstrap,
  WorkbenchLayout,
  WorkbenchUiState,
  WorkspaceRuntimeControllerEvent,
  WorkspaceRuntimeSnapshot,
  WorkspaceRuntimeStateEvent,
  WorkspaceSnapshot,
} from "../../types/app";
import {
  createDraftSessionPlaceholder,
  createSessionFromBackend,
  isDraftSession,
} from "./session";
import { applySessionRuntimeBindings } from "../../features/workspace/session-runtime-bindings";
import {
  rememberWorkspaceViewBaseline,
  rememberWorkspaceViewBaselines,
  shouldIgnoreIncomingWorkspaceViewPatch,
} from "../../features/workspace/workspace-view-persistence";
import { mergeMonotonicTextSnapshot } from "./stream-snapshot";
import {
  findPaneSessionId,
  remapPaneSession,
} from "./panes";
import {
  TERMINAL_STREAM_BUFFER_LIMIT,
} from "../app/constants";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const controllerIdentityKey = (controller: WorkspaceControllerState) => [
  controller.controllerDeviceId ?? "",
  controller.controllerClientId ?? "",
].join(":");

const mergeWorkspaceControllerState = (
  current: WorkspaceControllerState | undefined,
  incoming: WorkspaceControllerState,
): WorkspaceControllerState => {
  if (!current) {
    return incoming;
  }

  if (incoming.fencingToken !== current.fencingToken) {
    return incoming.fencingToken > current.fencingToken ? incoming : current;
  }

  if (current.takeoverPending && !incoming.takeoverPending) {
    return {
      ...incoming,
      takeoverPending: true,
      takeoverRequestedBySelf: current.takeoverRequestedBySelf,
      takeoverRequestId: current.takeoverRequestId,
      takeoverDeadlineAt: current.takeoverDeadlineAt,
    };
  }

  const incomingLeaseExpiresAt = incoming.leaseExpiresAt ?? 0;
  const currentLeaseExpiresAt = current.leaseExpiresAt ?? 0;
  if (incomingLeaseExpiresAt !== currentLeaseExpiresAt) {
    return incomingLeaseExpiresAt > currentLeaseExpiresAt ? incoming : current;
  }

  if (controllerIdentityKey(incoming) !== controllerIdentityKey(current)) {
    return incoming;
  }

  if (incoming.takeoverPending !== current.takeoverPending) {
    return incoming.takeoverPending ? incoming : current;
  }

  const incomingDeadlineAt = incoming.takeoverDeadlineAt ?? 0;
  const currentDeadlineAt = current.takeoverDeadlineAt ?? 0;
  if (incomingDeadlineAt !== currentDeadlineAt) {
    return incomingDeadlineAt > currentDeadlineAt ? incoming : current;
  }

  const incomingRequestId = incoming.takeoverRequestId ?? "";
  const currentRequestId = current.takeoverRequestId ?? "";
  if (incomingRequestId !== currentRequestId) {
    return incomingRequestId ? incoming : current;
  }

  return incoming;
};

const sameWorkspaceControllerState = (
  left: WorkspaceControllerState | undefined,
  right: WorkspaceControllerState | undefined,
) => (
  left?.role === right?.role
  && left?.deviceId === right?.deviceId
  && left?.clientId === right?.clientId
  && left?.controllerDeviceId === right?.controllerDeviceId
  && left?.controllerClientId === right?.controllerClientId
  && left?.fencingToken === right?.fencingToken
  && left?.takeoverPending === right?.takeoverPending
  && left?.takeoverRequestedBySelf === right?.takeoverRequestedBySelf
  && left?.takeoverRequestId === right?.takeoverRequestId
  && left?.takeoverDeadlineAt === right?.takeoverDeadlineAt
  && left?.leaseExpiresAt === right?.leaseExpiresAt
);

const readResumeId = (data: string) => {
  try {
    const payload = JSON.parse(data) as { session_id?: string };
    return typeof payload.session_id === "string" && payload.session_id.trim()
      ? payload.session_id.trim()
      : null;
  } catch {
    return null;
  }
};

const lifecycleStatusForReplay = (
  kind: AgentLifecycleHistoryEntry["kind"],
) => {
  if (kind === "turn_completed") {
    return "idle" as const;
  }
  return null;
};

const applyLifecycleReplayToState = (
  current: WorkbenchState,
  lifecycleEvents: AgentLifecycleHistoryEntry[],
): WorkbenchState => lifecycleEvents.reduce((state, event) => ({
      ...state,
      tabs: state.tabs.map((tab) => {
        if (tab.id !== event.workspace_id) return tab;
        return {
          ...tab,
          sessions: tab.sessions.map((session) => {
            if (session.id !== event.session_id) return session;
            const nextStatus = lifecycleStatusForReplay(event.kind);
            const resumeId = readResumeId(event.data);
            return {
              ...session,
              status: (
                session.status === "interrupted" || !nextStatus
                  ? session.status
                  : nextStatus
              ),
              resumeId: resumeId ?? session.resumeId,
            };
          }),
        };
      }),
}), current);

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

const mapTerminals = (
  terminals: WorkspaceSnapshot["terminals"],
  locale: Locale,
  requestedActiveTerminalId: string | undefined,
  existing?: Tab,
): { terminals: Terminal[]; activeTerminalId: string } => {
  if (!terminals.length) {
    const nextTerminals = existing?.terminals ?? [];
    const nextActiveTerminalId = nextTerminals.some((terminal) => terminal.id === requestedActiveTerminalId)
      ? requestedActiveTerminalId ?? ""
      : nextTerminals.some((terminal) => terminal.id === existing?.activeTerminalId)
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
      output: mergeMonotonicTextSnapshot(
        existingTerminal?.output ?? "",
        terminal.output ?? existingTerminal?.output ?? "",
        TERMINAL_STREAM_BUFFER_LIMIT,
      ),
      recoverable: terminal.recoverable ?? existingTerminal?.recoverable ?? false,
    };
  });
  const nextActiveTerminalId = nextTerminals.some((terminal) => terminal.id === requestedActiveTerminalId)
    ? requestedActiveTerminalId ?? ""
    : nextTerminals.some((terminal) => terminal.id === existing?.activeTerminalId)
      ? existing?.activeTerminalId ?? ""
    : (nextTerminals[0]?.id ?? "");
  return { terminals: nextTerminals, activeTerminalId: nextActiveTerminalId };
};

const normalizePaneLayout = (
  value: unknown,
  fallbackSessionId: string,
): Tab["paneLayout"] => {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
  if (!candidate) {
    return createPaneLeaf(fallbackSessionId);
  }

  if (candidate.type === "leaf") {
    const sessionId = typeof candidate.sessionId === "string"
      ? candidate.sessionId
      : (typeof candidate.session_id === "string" ? candidate.session_id : fallbackSessionId);
    return {
      type: "leaf",
      id: typeof candidate.id === "string" ? candidate.id : `pane-${sessionId}`,
      sessionId,
    };
  }

  if (candidate.type === "split") {
    return {
      type: "split",
      id: typeof candidate.id === "string" ? candidate.id : "split",
      axis: candidate.axis === "horizontal" ? "horizontal" : "vertical",
      ratio: typeof candidate.ratio === "number" ? candidate.ratio : 0.5,
      first: normalizePaneLayout(candidate.first, fallbackSessionId),
      second: normalizePaneLayout(candidate.second, fallbackSessionId),
    };
  }

  return createPaneLeaf(fallbackSessionId);
};

const mapBackendSupervisorCycle = (
  cycle: WorkspaceSnapshot["view_state"]["supervisor"]["cycles"][number],
): WorkspaceSupervisorCycle => ({
  cycleId: cycle.cycle_id,
  sessionId: cycle.session_id,
  sourceTurnId: cycle.source_turn_id,
  objectiveVersion: cycle.objective_version,
  supervisorInput: cycle.supervisor_input,
  supervisorReply: cycle.supervisor_reply ?? undefined,
  injectionMessageId: cycle.injection_message_id ?? undefined,
  status: cycle.status,
  error: cycle.error ?? undefined,
  startedAt: cycle.started_at,
  finishedAt: cycle.finished_at ?? undefined,
});

const attachSupervisorState = (
  session: Session,
  viewState: WorkspaceSnapshot["view_state"] | WorkspaceRuntimeStateEvent["view_state"],
): Session => {
  const binding = viewState.supervisor.bindings.find((item) => item.session_id === session.id);
  if (!binding) {
    if (!session.supervisor) return session;
    return {
      ...session,
      supervisor: undefined,
    };
  }
  const latestCycle = [...viewState.supervisor.cycles]
    .filter((cycle) => cycle.session_id === session.id)
    .sort((a, b) => b.started_at - a.started_at)[0];
  const supervisor: SessionSupervisorState = {
    provider: binding.provider,
    status: binding.status,
    objectiveText: binding.objective_text,
    objectivePrompt: binding.objective_prompt,
    objectiveVersion: binding.objective_version,
    autoInjectEnabled: binding.auto_inject_enabled,
    pendingObjectiveText: binding.pending_objective_text ?? undefined,
    pendingObjectiveVersion: binding.pending_objective_version ?? undefined,
    latestCycle: latestCycle ? mapBackendSupervisorCycle(latestCycle) : undefined,
  };
  return {
    ...session,
    supervisor,
  };
};

const samePaneLayout = (
  left: Tab["paneLayout"],
  right: Tab["paneLayout"],
): boolean => {
  if (left.type !== right.type || left.id !== right.id) {
    return false;
  }
  if (left.type === "leaf" && right.type === "leaf") {
    return left.sessionId === right.sessionId;
  }
  if (left.type === "split" && right.type === "split") {
    return left.axis === right.axis
      && left.ratio === right.ratio
      && samePaneLayout(left.first, right.first)
      && samePaneLayout(left.second, right.second);
  }
  return false;
};

const sameFilePreview = (
  left: FilePreview,
  right: FilePreview,
) => (
  left.path === right.path
  && left.content === right.content
  && left.mode === right.mode
  && left.diff === right.diff
  && left.originalContent === right.originalContent
  && left.modifiedContent === right.modifiedContent
  && left.dirty === right.dirty
  && left.source === right.source
  && left.statusLabel === right.statusLabel
  && left.parentPath === right.parentPath
  && left.section === right.section
);

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
    return attachSupervisorState(
      createSessionFromBackend(session, locale, current),
      snapshot.view_state,
    );
  });

  const existingDraftSessions = existing?.sessions.filter((session) => isDraftSession(session)) ?? [];
  const existingSessions = existing?.sessions ?? [];
  const emptySnapshotDraftSessionId = typeof snapshot.view_state.active_session_id === "string"
    && snapshot.view_state.active_session_id.trim()
    ? snapshot.view_state.active_session_id.trim()
    : "1";
  const sessions = backendSessions.length > 0
    ? [...existingDraftSessions, ...backendSessions]
    : (
      existingSessions.length > 0
        ? existingSessions
        : [
            createDraftSessionPlaceholder({
              locale,
              workspacePath: snapshot.workspace.project_path,
              branch: existing?.git.branch,
              provider: appSettings.agentDefaults.provider,
              existing: {
                id: emptySnapshotDraftSessionId,
              } as Session,
            }),
          ]
    );

  const fallbackSessionId = sessions[0]?.id ?? existing?.activeSessionId ?? "1";
  const nextActiveSessionId = sessions.some((session) => session.id === snapshot.view_state.active_session_id)
    ? snapshot.view_state.active_session_id
    : sessions.some((session) => session.id === existing?.activeSessionId)
      ? existing?.activeSessionId ?? fallbackSessionId
      : fallbackSessionId;
  const terminalState = mapTerminals(
    snapshot.terminals,
    locale,
    snapshot.view_state.active_terminal_id,
    existing,
  );
  const candidate: Tab = {
    id: snapshot.workspace.workspace_id,
    title: snapshot.workspace.title,
    status: "ready",
    controller: existing?.controller ?? createWorkspaceControllerState({ role: "observer" }),
    project: {
      kind: snapshot.workspace.source_kind,
      path: snapshot.workspace.project_path,
      gitUrl: snapshot.workspace.git_url ?? undefined,
      target: snapshot.workspace.target,
    },
    git: existing?.git ?? { branch: "—", changes: 0, lastCommit: "—" },
    gitChanges: existing?.gitChanges ?? [],
    worktrees: existing?.worktrees ?? [],
    sessions,
    activeSessionId: nextActiveSessionId,
    terminals: terminalState.terminals,
    activeTerminalId: terminalState.activeTerminalId,
    fileTree: existing?.fileTree ?? [],
    changesTree: existing?.changesTree ?? [],
    filePreview: normalizeFilePreview(snapshot.view_state.file_preview, existing?.filePreview),
    paneLayout: normalizePaneLayout(snapshot.view_state.pane_layout, nextActiveSessionId),
    activePaneId: snapshot.view_state.active_pane_id || existing?.activePaneId || "",
    idlePolicy: {
      enabled: snapshot.workspace.idle_policy.enabled,
      idleMinutes: snapshot.workspace.idle_policy.idle_minutes,
      maxActive: snapshot.workspace.idle_policy.max_active,
      pressure: snapshot.workspace.idle_policy.pressure,
    },
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

  const nextState = {
    tabs,
    activeTabId: resolveActiveWorkspaceId(tabs, bootstrap.ui_state.active_workspace_id),
    layout: workbenchLayoutFromBackend(bootstrap.ui_state.layout),
    overlay: {
      ...current.overlay,
      visible: false,
      input: tabs.length === 0 ? current.overlay.input : "",
    },
  };
  rememberWorkspaceViewBaselines(nextState.tabs);
  return nextState;
};

export const applyWorkspaceBootstrapResult = (
  current: WorkbenchState,
  bootstrap: WorkbenchBootstrap,
  locale: Locale,
  appSettings: AppSettings,
  routeRuntime?: {
    deviceId: string;
    clientId: string;
    uiState?: WorkbenchUiState | null;
    runtimeSnapshot?: WorkspaceRuntimeSnapshot | null;
  },
): WorkbenchState => {
  const nextState = buildWorkbenchStateFromBootstrap(current, bootstrap, locale, appSettings);
  if (!routeRuntime) {
    return nextState;
  }
  if (routeRuntime.uiState && routeRuntime.runtimeSnapshot) {
    return applyWorkspaceRuntimeSnapshot(
      nextState,
      routeRuntime.runtimeSnapshot,
      locale,
      appSettings,
      routeRuntime.deviceId,
      routeRuntime.clientId,
      routeRuntime.uiState,
    );
  }
  if (routeRuntime.uiState) {
    return applyWorkbenchUiState(nextState, routeRuntime.uiState);
  }
  return nextState;
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

  const nextState = {
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
  rememberWorkspaceViewBaseline(nextTab);
  return nextState;
};

export const applyWorkspaceRuntimeSnapshot = (
  current: WorkbenchState,
  runtimeSnapshot: WorkspaceRuntimeSnapshot,
  locale: Locale,
  appSettings: AppSettings,
  deviceId: string,
  clientId: string,
  uiState?: WorkbenchUiState | null,
): WorkbenchState => {
  const next = applyLifecycleReplayToState(
    upsertWorkspaceSnapshot(current, runtimeSnapshot.snapshot, locale, appSettings, uiState),
    runtimeSnapshot.lifecycle_events ?? [],
  );
  const incomingController = createWorkspaceControllerStateFromLease(
    runtimeSnapshot.controller,
    deviceId,
    clientId,
  );
  return {
    ...next,
    tabs: next.tabs.map((tab) => {
      if (tab.id !== runtimeSnapshot.snapshot.workspace.workspace_id) {
        return tab;
      }
      const boundSessions = applySessionRuntimeBindings(
        tab.sessions,
        runtimeSnapshot.session_runtime_bindings ?? [],
      );
      const activeBinding = runtimeSnapshot.session_runtime_bindings?.find((binding) => (
        binding.session_id === runtimeSnapshot.snapshot.view_state.active_session_id
      ));
      const bindingTerminalId = activeBinding?.workspace_terminal_id;
      const activePaneSessionId = findPaneSessionId(tab.paneLayout, tab.activePaneId);
      const nextActiveSessionId = runtimeSnapshot.snapshot.view_state.active_session_id;
      const remapSourceSessionId = (
        activePaneSessionId && tab.sessions.some((session) => session.id === activePaneSessionId)
      )
        ? activePaneSessionId
        : tab.activeSessionId;
      const shouldRemapDraftRuntimeBinding = (
        runtimeSnapshot.snapshot.sessions.length === 0
        && !!bindingTerminalId
        && !!remapSourceSessionId
        && remapSourceSessionId !== nextActiveSessionId
        && !tab.sessions.some((session) => session.id === nextActiveSessionId)
        && boundSessions.some((session) => session.id === remapSourceSessionId)
      );

      if (!shouldRemapDraftRuntimeBinding) {
        return {
          ...tab,
          controller: mergeWorkspaceControllerState(tab.controller, incomingController),
          sessions: boundSessions,
        };
      }

      const remappedSessions = boundSessions.map((session) => (
        session.id === remapSourceSessionId
          ? {
              ...session,
              id: nextActiveSessionId,
              isDraft: false,
              terminalId: bindingTerminalId ? `term-${bindingTerminalId}` : undefined,
              terminalRuntimeId: activeBinding?.terminal_runtime_id ?? session.terminalRuntimeId,
            }
          : session
      ));
      return {
        ...tab,
        controller: mergeWorkspaceControllerState(tab.controller, incomingController),
        sessions: remappedSessions,
        activeSessionId: nextActiveSessionId,
        activePaneId: runtimeSnapshot.snapshot.view_state.active_pane_id || tab.activePaneId,
        paneLayout: remapPaneSession(tab.paneLayout, remapSourceSessionId, nextActiveSessionId),
      };
    }),
  };
};


export const applyWorkspaceControllerEvent = (
  current: WorkbenchState,
  payload: WorkspaceRuntimeControllerEvent,
  deviceId: string,
  clientId: string,
): WorkbenchState => {
  const tabIndex = current.tabs.findIndex((tab) => tab.id === payload.workspace_id);
  if (tabIndex < 0) {
    return current;
  }

  const currentTab = current.tabs[tabIndex];
  const nextController = createWorkspaceControllerStateFromLease(payload.controller, deviceId, clientId);
  if (sameWorkspaceControllerState(currentTab.controller, nextController)) {
    return current;
  }

  const tabs = [...current.tabs];
  tabs[tabIndex] = {
    ...currentTab,
    controller: nextController,
  };
  return {
    ...current,
    tabs,
  };
};

export const applyWorkspaceRuntimeStateEvent = (
  current: WorkbenchState,
  payload: WorkspaceRuntimeStateEvent,
): WorkbenchState => {
  const tabIndex = current.tabs.findIndex((tab) => tab.id === payload.workspace_id);
  if (tabIndex < 0) {
    return current;
  }

  const currentTab = current.tabs[tabIndex];
  let nextTab = currentTab;

  const sessionState = payload.session_state;
  if (sessionState) {
    let sessionChanged = false;
    const nextSessions = nextTab.sessions.map((session) => {
      if (session.id !== sessionState.session_id) return session;
      sessionChanged = (
        session.status !== sessionState.status
        || session.lastActiveAt !== sessionState.last_active_at
        || session.resumeId !== (sessionState.resume_id ?? session.resumeId)
        || session.runtimeLiveness !== (sessionState.runtime_liveness ?? session.runtimeLiveness)
      );
      if (!sessionChanged) {
        return session;
      }
      return {
        ...session,
        status: sessionState.status,
        lastActiveAt: sessionState.last_active_at,
        resumeId: sessionState.resume_id ?? session.resumeId,
        runtimeLiveness: sessionState.runtime_liveness ?? session.runtimeLiveness,
      };
    });
    if (sessionChanged) {
      nextTab = {
        ...nextTab,
        sessions: nextSessions,
      };
    }
  }

  const viewState = payload.view_state;
  if (!viewState) {
    if (nextTab === currentTab) {
      return current;
    }
    const tabs = [...current.tabs];
    tabs[tabIndex] = nextTab;
    return {
      ...current,
      tabs,
    };
  }

  const sessionsWithSupervisor = nextTab.sessions.map((session) => attachSupervisorState(session, viewState));
  const sessionsChanged = sessionsWithSupervisor.some((session, index) => session !== nextTab.sessions[index]);
  if (sessionsChanged) {
    nextTab = {
      ...nextTab,
      sessions: sessionsWithSupervisor,
    };
  }

  if (shouldIgnoreIncomingWorkspaceViewPatch(nextTab, viewState)) {
    if (nextTab === currentTab) {
      return current;
    }
    const tabs = [...current.tabs];
    tabs[tabIndex] = nextTab;
    return {
      ...current,
      tabs,
    };
  }

  const nextActiveSessionId = nextTab.sessions.some((session) => session.id === viewState.active_session_id)
    ? viewState.active_session_id
    : nextTab.activeSessionId;
  const nextActiveTerminalId = nextTab.terminals.some((terminal) => terminal.id === viewState.active_terminal_id)
    ? viewState.active_terminal_id
    : nextTab.activeTerminalId;
  const nextActivePaneId = viewState.active_pane_id || nextTab.activePaneId;
  const nextPaneLayout = normalizePaneLayout(viewState.pane_layout, nextActiveSessionId);
  const nextFilePreview = normalizeFilePreview(viewState.file_preview, nextTab.filePreview);

  if (
    nextTab !== currentTab
    && nextActiveSessionId === nextTab.activeSessionId
    && nextActivePaneId === nextTab.activePaneId
    && nextActiveTerminalId === nextTab.activeTerminalId
    && samePaneLayout(nextTab.paneLayout, nextPaneLayout)
    && sameFilePreview(nextTab.filePreview, nextFilePreview)
  ) {
    const tabs = [...current.tabs];
    tabs[tabIndex] = nextTab;
    return {
      ...current,
      tabs,
    };
  }

  if (
    nextTab === currentTab
    && nextActiveSessionId === currentTab.activeSessionId
    && nextActivePaneId === currentTab.activePaneId
    && nextActiveTerminalId === currentTab.activeTerminalId
    && samePaneLayout(currentTab.paneLayout, nextPaneLayout)
    && sameFilePreview(currentTab.filePreview, nextFilePreview)
  ) {
    return current;
  }

  nextTab = {
    ...nextTab,
    activeSessionId: nextActiveSessionId,
    activePaneId: nextActivePaneId,
    activeTerminalId: nextActiveTerminalId,
    paneLayout: nextPaneLayout,
    filePreview: nextFilePreview,
  };
  const tabs = [...current.tabs];
  tabs[tabIndex] = nextTab;
  rememberWorkspaceViewBaseline(nextTab);
  return {
    ...current,
    tabs,
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
      visible: false,
    },
  };
};
