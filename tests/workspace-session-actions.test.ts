import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTabFromWorkspaceSnapshot } from "../apps/web/src/shared/utils/workspace";

const appSettingsFixture = () => ({
  general: {
    locale: "en",
    terminalCompatibilityMode: "standard",
    completionNotifications: { enabled: true, onlyWhenBackground: true },
    idlePolicy: { enabled: true, idleMinutes: 10, maxActive: 3, pressure: true },
  },
  agentDefaults: { provider: "claude" },
  providers: {},
});

test("workspace snapshot maps supervisor binding onto the active session", () => {
  const tab = createTabFromWorkspaceSnapshot({
    workspace: {
      workspace_id: "ws-1",
      title: "Workspace 1",
      project_path: "/tmp/ws-1",
      source_kind: "local",
      source_value: "/tmp/ws-1",
      git_url: null,
      target: { type: "native" },
      idle_policy: { enabled: true, idle_minutes: 10, max_active: 3, pressure: true },
    },
    sessions: [{
      id: "slot-primary",
      title: "Session 1",
      status: "idle",
      mode: "branch",
      provider: "claude",
      auto_feed: true,
      queue: [],
      messages: [],
      unread: 0,
      last_active_at: 1,
      resume_id: null,
      unavailable_reason: null,
    }],
    view_state: {
      active_session_id: "slot-primary",
      active_pane_id: "pane-slot-primary",
      active_terminal_id: "",
      pane_layout: { type: "leaf", id: "pane-slot-primary", sessionId: "slot-primary" },
      file_preview: { path: "", content: "", mode: "preview", originalContent: "", modifiedContent: "", dirty: false },
      session_bindings: [],
      supervisor: {
        bindings: [{
          session_id: "slot-primary",
          provider: "claude",
          objective_text: "Keep using xterm",
          objective_prompt: "You are the supervisor",
          objective_version: 1,
          status: "idle",
          auto_inject_enabled: true,
          pending_objective_text: null,
          pending_objective_prompt: null,
          pending_objective_version: null,
          created_at: 1,
          updated_at: 2,
        }],
        cycles: [{
          cycle_id: "cycle-1",
          session_id: "slot-primary",
          source_turn_id: "turn-1",
          objective_version: 1,
          supervisor_input: "prompt",
          supervisor_reply: "next message",
          injection_message_id: "msg-1",
          status: "injected",
          error: null,
          started_at: 1,
          finished_at: 2,
        }],
      },
    },
    terminals: [],
  }, "en", appSettingsFixture(), undefined);

  assert.equal(tab.sessions[0]?.supervisor?.status, "idle");
  assert.equal(tab.sessions[0]?.supervisor?.objectiveText, "Keep using xterm");
  assert.match(tab.sessions[0]?.supervisor?.latestCycle?.supervisorReply ?? "", /next message/);
});

test("workspace snapshot clears stale supervisor state when the binding is removed", () => {
  const existingTab = createTabFromWorkspaceSnapshot({
    workspace: {
      workspace_id: "ws-1",
      title: "Workspace 1",
      project_path: "/tmp/ws-1",
      source_kind: "local",
      source_value: "/tmp/ws-1",
      git_url: null,
      target: { type: "native" },
      idle_policy: { enabled: true, idle_minutes: 10, max_active: 3, pressure: true },
    },
    sessions: [{
      id: "slot-primary",
      title: "Session 1",
      status: "idle",
      mode: "branch",
      provider: "claude",
      auto_feed: true,
      queue: [],
      messages: [],
      unread: 0,
      last_active_at: 1,
      resume_id: null,
      unavailable_reason: null,
    }],
    view_state: {
      active_session_id: "slot-primary",
      active_pane_id: "pane-slot-primary",
      active_terminal_id: "",
      pane_layout: { type: "leaf", id: "pane-slot-primary", sessionId: "slot-primary" },
      file_preview: { path: "", content: "", mode: "preview", originalContent: "", modifiedContent: "", dirty: false },
      session_bindings: [],
      supervisor: {
        bindings: [{
          session_id: "slot-primary",
          provider: "claude",
          objective_text: "Keep using xterm",
          objective_prompt: "You are the supervisor",
          objective_version: 1,
          status: "idle",
          auto_inject_enabled: true,
          pending_objective_text: null,
          pending_objective_prompt: null,
          pending_objective_version: null,
          created_at: 1,
          updated_at: 2,
        }],
        cycles: [],
      },
    },
    terminals: [],
  }, "en", appSettingsFixture(), undefined);

  const refreshedTab = createTabFromWorkspaceSnapshot({
    workspace: {
      workspace_id: "ws-1",
      title: "Workspace 1",
      project_path: "/tmp/ws-1",
      source_kind: "local",
      source_value: "/tmp/ws-1",
      git_url: null,
      target: { type: "native" },
      idle_policy: { enabled: true, idle_minutes: 10, max_active: 3, pressure: true },
    },
    sessions: [{
      id: "slot-primary",
      title: "Session 1",
      status: "idle",
      mode: "branch",
      provider: "claude",
      auto_feed: true,
      queue: [],
      messages: [],
      unread: 0,
      last_active_at: 2,
      resume_id: null,
      unavailable_reason: null,
    }],
    view_state: {
      active_session_id: "slot-primary",
      active_pane_id: "pane-slot-primary",
      active_terminal_id: "",
      pane_layout: { type: "leaf", id: "pane-slot-primary", sessionId: "slot-primary" },
      file_preview: { path: "", content: "", mode: "preview", originalContent: "", modifiedContent: "", dirty: false },
      session_bindings: [],
      supervisor: {
        bindings: [],
        cycles: [],
      },
    },
    terminals: [],
  }, "en", appSettingsFixture(), existingTab);

  assert.equal(refreshedTab.sessions[0]?.supervisor, undefined);
});

test("materializing a draft session creates a backend session via createSessionRequest", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/session-actions.ts", import.meta.url),
    "utf8",
  );
  const materializeSessionSource = source.match(
    /const materializeSession = async[\s\S]*?const refreshTabFromBackend = async/,
  )?.[0] ?? "";

  assert.match(materializeSessionSource, /const materializeSession = async[\s\S]*?isDraft: false/);
  assert.match(materializeSessionSource, /createSessionRequest\(/);
  assert.doesNotMatch(materializeSessionSource, /advanceWorkspaceSyncVersion\(tabId\)/);
});
