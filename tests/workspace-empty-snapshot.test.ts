import test from "node:test";
import assert from "node:assert/strict";
import { createTabFromWorkspaceSnapshot } from "../apps/web/src/shared/utils/workspace";
import { findPaneSessionId } from "../apps/web/src/shared/utils/panes";
import { defaultAppSettings } from "../apps/web/src/shared/app/settings-storage";

test("createTabFromWorkspaceSnapshot remaps empty backend sessions to a draft pane session id", () => {
  const snapshot = {
    workspace: {
      workspace_id: "ws-empty",
      title: "Empty Workspace",
      project_path: "/tmp/ws-empty",
      source_kind: "local" as const,
      source_value: "/tmp/ws-empty",
      git_url: null,
      target: { type: "native" as const },
      idle_policy: {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
      },
    },
    sessions: [],
    view_state: {
      active_session_id: "1",
      active_pane_id: "pane-1",
      active_terminal_id: "",
      pane_layout: {
        type: "leaf" as const,
        id: "pane-1",
        session_id: "1",
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
  };

  const tab = createTabFromWorkspaceSnapshot(
    snapshot,
    "en",
    defaultAppSettings(),
  );

  const draftSession = tab.sessions[0];
  assert.equal(draftSession.id, "1");
  assert.equal(draftSession.isDraft, true);
  assert.equal(tab.activeSessionId, draftSession.id);
  assert.equal(findPaneSessionId(tab.paneLayout, tab.activePaneId), draftSession.id);
});

test("createTabFromWorkspaceSnapshot preserves backend slot ids for empty draft workspaces", () => {
  const snapshot = {
    workspace: {
      workspace_id: "ws-empty-slot",
      title: "Empty Workspace",
      project_path: "/tmp/ws-empty-slot",
      source_kind: "local" as const,
      source_value: "/tmp/ws-empty-slot",
      git_url: null,
      target: { type: "native" as const },
      idle_policy: {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
      },
    },
    sessions: [],
    view_state: {
      active_session_id: "slot-primary",
      active_pane_id: "pane-slot-primary",
      active_terminal_id: "",
      pane_layout: {
        type: "leaf" as const,
        id: "pane-slot-primary",
        session_id: "slot-primary",
      },
      file_preview: {
        path: "",
        content: "",
        mode: "preview" as const,
        originalContent: "",
        modifiedContent: "",
        dirty: false,
      },
      supervisor: {
        bindings: [],
        cycles: [],
      },
    },
    terminals: [],
  };

  const tab = createTabFromWorkspaceSnapshot(
    snapshot,
    "en",
    defaultAppSettings(),
  );

  const draftSession = tab.sessions[0];
  assert.equal(draftSession.id, "slot-primary");
  assert.equal(draftSession.isDraft, true);
  assert.equal(tab.activeSessionId, "slot-primary");
  assert.equal(findPaneSessionId(tab.paneLayout, tab.activePaneId), "slot-primary");
});

test("createTabFromWorkspaceSnapshot remaps stale pane session ids to the generated draft session", () => {
  const snapshot = {
    workspace: {
      workspace_id: "ws-empty-stale-pane",
      title: "Empty Workspace",
      project_path: "/tmp/ws-empty-stale-pane",
      source_kind: "local" as const,
      source_value: "/tmp/ws-empty-stale-pane",
      git_url: null,
      target: { type: "native" as const },
      idle_policy: {
        enabled: true,
        idle_minutes: 10,
        max_active: 3,
        pressure: true,
      },
    },
    sessions: [],
    view_state: {
      active_session_id: "slot-primary",
      active_pane_id: "pane-slot-primary",
      active_terminal_id: "",
      pane_layout: {
        type: "leaf" as const,
        id: "pane-slot-primary",
        session_id: "slot-primary",
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
  };

  const tab = createTabFromWorkspaceSnapshot(
    snapshot,
    "en",
    defaultAppSettings(),
  );

  const draftSession = tab.sessions[0];
  assert.equal(draftSession.isDraft, true);
  assert.equal(tab.activeSessionId, draftSession.id);
  assert.equal(findPaneSessionId(tab.paneLayout, tab.activePaneId), draftSession.id);
});
