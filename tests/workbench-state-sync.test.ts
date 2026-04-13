import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultWorkbenchState,
  createEmptyPreview,
  createPaneLeaf,
  type Session,
  type Tab,
  type WorkbenchState,
} from "../apps/web/src/state/workbench-core";
import {
  createWorkspaceControllerState,
} from "../apps/web/src/features/workspace/workspace-controller";
import {
  createTabFromWorkspaceSnapshot,
  applyWorkspaceRuntimeStateEvent,
} from "../apps/web/src/shared/utils/workspace";
import {
  defaultAppSettings,
} from "../apps/web/src/shared/app/settings-storage";
import {
  getWorkbenchStateSnapshot,
  syncWorkbenchStateSnapshot,
  updateWorkbenchStateSnapshot,
} from "../apps/web/src/shared/utils/workbench-state-snapshot";

const createSession = (
  id: string,
  provider: string,
  isDraft: boolean,
): Session => ({
  id,
  title: isDraft ? "Draft" : `Session ${id}`,
  status: "idle",
  mode: "branch",
  provider,
  autoFeed: true,
  isDraft,
  queue: [],
  messages: [],
  unread: 0,
  lastActiveAt: Date.now(),
});

const createTab = (
  workspaceId: string,
  session: Session,
): Tab => ({
  id: workspaceId,
  title: workspaceId,
  status: "ready",
  controller: createWorkspaceControllerState({
    role: "controller",
    deviceId: "device-1",
    clientId: "client-1",
    controllerDeviceId: "device-1",
    controllerClientId: "client-1",
    fencingToken: 1,
  }),
  project: {
    kind: "local",
    path: "/tmp/coder-studio",
    target: { type: "native" },
  },
  git: {
    branch: "main",
    changes: 0,
    lastCommit: "HEAD",
  },
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
  paneLayout: createPaneLeaf(session.id),
  activePaneId: `pane-${session.id}`,
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
});

const createWorkbenchState = (workspaceId: string, session: Session): WorkbenchState => ({
  ...createDefaultWorkbenchState(),
  tabs: [createTab(workspaceId, session)],
  activeTabId: workspaceId,
});

test("shared workbench snapshot keeps runtime view patches on the latest materialized session", () => {
  const workspaceId = "workspace-sync";
  const draftSession = createSession("session-draft", "codex", true);
  const materializedSession = createSession("29", "codex", false);
  const draftState = createWorkbenchState(workspaceId, draftSession);
  const materializedState = createWorkbenchState(workspaceId, materializedSession);

  syncWorkbenchStateSnapshot(draftState);
  syncWorkbenchStateSnapshot(materializedState);

  const next = updateWorkbenchStateSnapshot((current) => applyWorkspaceRuntimeStateEvent(current, {
    workspace_id: workspaceId,
    view_state: {
      active_session_id: "29",
      active_pane_id: "pane-29",
      active_terminal_id: "",
      pane_layout: {
        type: "leaf",
        id: "pane-29",
        sessionId: "29",
      },
      file_preview: createEmptyPreview(),
      supervisor: {
        bindings: [],
        cycles: [],
      },
    },
  }));

  assert.equal(next.tabs[0]?.activeSessionId, "29");
  assert.equal(next.tabs[0]?.sessions[0]?.id, "29");
  assert.equal(next.tabs[0]?.sessions[0]?.isDraft, false);
  assert.equal(next.tabs[0]?.paneLayout.type, "leaf");
  assert.equal(
    next.tabs[0]?.paneLayout.type === "leaf" ? next.tabs[0].paneLayout.sessionId : "",
    "29",
  );
  assert.equal(getWorkbenchStateSnapshot().tabs[0]?.activeSessionId, "29");
});

test("runtime snapshots without sessions preserve existing local sessions", () => {
  const workspaceId = "workspace-empty-attach";
  const materializedSession = createSession("29", "codex", false);
  const existingTab = createTab(workspaceId, materializedSession);

  const nextTab = createTabFromWorkspaceSnapshot(
    {
      workspace: {
        workspace_id: workspaceId,
        title: workspaceId,
        source_kind: "local",
        project_path: "/tmp/coder-studio",
        git_url: null,
        target: { type: "native" },
        idle_policy: {
          enabled: true,
          idle_minutes: 10,
          max_active: 3,
          pressure: true,
        },
      },
      sessions: [],
      archive: [],
      view_state: {
        active_session_id: "29",
        active_pane_id: "pane-29",
        active_terminal_id: "",
        pane_layout: createPaneLeaf("29"),
        file_preview: createEmptyPreview(),
      },
      terminals: [],
    },
    "en",
    defaultAppSettings(),
    existingTab,
  );

  assert.equal(nextTab.sessions.length, 1);
  assert.equal(nextTab.sessions[0]?.id, "29");
  assert.equal(nextTab.sessions[0]?.provider, "codex");
  assert.equal(nextTab.activeSessionId, "29");
  assert.equal(nextTab.paneLayout.type, "leaf");
  assert.equal(nextTab.paneLayout.type === "leaf" ? nextTab.paneLayout.sessionId : "", "29");
});

test("background runtime snapshot keeps the current active workspace when ui state is absent", async () => {
  const activeSession = createSession("11", "claude", false);
  const backgroundSession = createSession("22", "codex", false);
  const activeWorkspaceId = "workspace-active";
  const backgroundWorkspaceId = "workspace-background";
  const currentState: WorkbenchState = {
    ...createDefaultWorkbenchState(),
    tabs: [
      createTab(activeWorkspaceId, activeSession),
      createTab(backgroundWorkspaceId, backgroundSession),
    ],
    activeTabId: activeWorkspaceId,
  };

  const { applyWorkspaceRuntimeSnapshot } = await import("../apps/web/src/shared/utils/workspace");

  const next = applyWorkspaceRuntimeSnapshot(
    currentState,
    {
      snapshot: {
        workspace: {
          workspace_id: backgroundWorkspaceId,
          title: backgroundWorkspaceId,
          source_kind: "local",
          project_path: "/tmp/coder-studio-background",
          git_url: null,
          target: { type: "native" },
          idle_policy: {
            enabled: true,
            idle_minutes: 10,
            max_active: 3,
            pressure: true,
          },
        },
        sessions: [
          {
            id: backgroundSession.id,
            title: backgroundSession.title,
            status: backgroundSession.status,
            mode: backgroundSession.mode,
            provider: backgroundSession.provider,
            auto_feed: backgroundSession.autoFeed,
            queue: [],
            messages: [],
            unread: 0,
            last_active_at: backgroundSession.lastActiveAt,
            resume_id: null,
            unavailable_reason: null,
            runtime_liveness: null,
          },
        ],
        archive: [],
        view_state: {
          active_session_id: backgroundSession.id,
          active_pane_id: `pane-${backgroundSession.id}`,
          active_terminal_id: "",
          pane_layout: createPaneLeaf(backgroundSession.id),
          file_preview: createEmptyPreview(),
          supervisor: {
            bindings: [],
            cycles: [],
          },
        },
        terminals: [],
      },
      controller: {
        role: "controller",
        holder: {
          device_id: "device-1",
          client_id: "client-1",
        },
        fencing_token: 1,
        lease_expires_at: null,
        takeover_pending: false,
        takeover_request_id: null,
        takeover_deadline_at: null,
      },
      session_runtime_bindings: [],
      lifecycle_events: [],
    },
    "en",
    defaultAppSettings(),
    "device-1",
    "client-1",
  );

  assert.equal(next.activeTabId, activeWorkspaceId);
});
