import test from "node:test";
import assert from "node:assert/strict";
import {
  applyWorkspaceRuntimeStateEvent,
  buildWorkbenchStateFromBootstrap,
} from "../apps/web/src/shared/utils/workspace.ts";
import { createDefaultWorkbenchState } from "../apps/web/src/state/workbench-core.ts";
import {
  resetWorkspaceViewBaselines,
  shouldPersistWorkspaceView,
} from "../apps/web/src/features/workspace/workspace-view-persistence.ts";

const APP_SETTINGS = {
  agentProvider: "claude" as const,
  agentCommand: "claude",
  idlePolicy: {
    enabled: true,
    idleMinutes: 10,
    maxActive: 3,
    pressure: true,
  },
  completionNotifications: {
    enabled: true,
    onlyWhenBackground: true,
  },
  terminalCompatibilityMode: "standard" as const,
};

const createWorkspaceSnapshot = (activeSessionId: string) => ({
  workspace: {
    workspace_id: "ws-1",
    title: "Workspace 1",
    project_path: "/tmp/ws-1",
    source_kind: "local" as const,
    source_value: "/tmp/ws-1",
    git_url: null,
    target: { type: "native" as const },
    idle_policy: {
      enabled: true,
      idle_minutes: 10,
      max_active: 3,
      pressure: true,
    },
  },
  sessions: [
    {
      id: 1,
      title: "Session 1",
      status: "idle" as const,
      mode: "branch" as const,
      auto_feed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      last_active_at: 1,
      claude_session_id: null,
    },
    {
      id: 2,
      title: "Session 2",
      status: "waiting" as const,
      mode: "branch" as const,
      auto_feed: true,
      queue: [],
      messages: [],
      stream: "",
      unread: 0,
      last_active_at: 2,
      claude_session_id: null,
    },
  ],
  archive: [],
  view_state: {
    active_session_id: activeSessionId,
    active_pane_id: `pane-${activeSessionId}`,
    active_terminal_id: "",
    pane_layout: {
      type: "leaf" as const,
      id: `pane-${activeSessionId}`,
      sessionId: activeSessionId,
    },
    file_preview: {
      path: "",
      content: "",
      mode: "preview" as const,
      originalContent: "",
      modifiedContent: "",
      dirty: false,
    },
  },
  terminals: [],
});

test.afterEach(() => {
  resetWorkspaceViewBaselines();
});

test("buildWorkbenchStateFromBootstrap seeds workspace view persistence baselines for hydrated tabs", () => {
  const state = buildWorkbenchStateFromBootstrap(
    createDefaultWorkbenchState(),
    {
      ui_state: {
        open_workspace_ids: ["ws-1"],
        active_workspace_id: "ws-1",
        layout: {
          left_width: 320,
          right_width: 320,
          right_split: 64,
          show_code_panel: false,
          show_terminal_panel: false,
        },
      },
      workspaces: [createWorkspaceSnapshot("2")],
    },
    "en",
    APP_SETTINGS,
  );

  const tab = state.tabs[0];
  assert.equal(shouldPersistWorkspaceView(tab), false);
  assert.equal(shouldPersistWorkspaceView({ ...tab, activeSessionId: "1" }), true);
});

test("runtime state events refresh workspace view persistence baselines", () => {
  const initial = buildWorkbenchStateFromBootstrap(
    createDefaultWorkbenchState(),
    {
      ui_state: {
        open_workspace_ids: ["ws-1"],
        active_workspace_id: "ws-1",
        layout: {
          left_width: 320,
          right_width: 320,
          right_split: 64,
          show_code_panel: false,
          show_terminal_panel: false,
        },
      },
      workspaces: [createWorkspaceSnapshot("2")],
    },
    "en",
    APP_SETTINGS,
  );

  const next = applyWorkspaceRuntimeStateEvent(initial, {
    workspace_id: "ws-1",
    view_state: {
      active_session_id: "1",
      active_pane_id: "pane-1",
      active_terminal_id: "",
      pane_layout: {
        type: "leaf",
        id: "pane-1",
        sessionId: "1",
      },
      file_preview: {
        path: "",
        content: "",
        mode: "preview",
        originalContent: "",
        modifiedContent: "",
        dirty: false,
      },
    },
  });

  const tab = next.tabs[0];
  assert.equal(shouldPersistWorkspaceView(tab), false);
  assert.equal(shouldPersistWorkspaceView({ ...tab, activePaneId: "pane-2" }), true);
});
