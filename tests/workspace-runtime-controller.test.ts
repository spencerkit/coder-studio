import test from "node:test";
import assert from "node:assert/strict";
import {
  canMutateWorkspace,
  collectControlledWorkspaceReleasePayloads,
  createWorkspaceControllerMutationPayload,
  createWorkspaceControllerRpcPayload,
  createWorkspaceControllerState,
  createWorkspaceControllerStateFromLease,
} from "../apps/web/src/features/workspace/workspace-controller.ts";
import { applyWorkspaceRuntimeSnapshot } from "../apps/web/src/shared/utils/workspace.ts";
import { createDefaultWorkbenchState } from "../apps/web/src/state/workbench-core.ts";

test("observer role blocks session switches and shell input", () => {
  const controller = createWorkspaceControllerState({ role: "observer", fencingToken: 1 });

  assert.equal(canMutateWorkspace(controller, "switch_session"), false);
  assert.equal(canMutateWorkspace(controller, "shell_input"), false);
});

test("controller role allows session and terminal mutations", () => {
  const controller = createWorkspaceControllerState({ role: "controller", fencingToken: 2 });

  assert.equal(canMutateWorkspace(controller, "switch_session"), true);
  assert.equal(canMutateWorkspace(controller, "close_terminal"), true);
});

test("same device with a different client stays observer", () => {
  const controller = createWorkspaceControllerStateFromLease({
    workspace_id: "ws-1",
    controller_device_id: "device-a",
    controller_client_id: "client-a",
    lease_expires_at: Date.now() + 30_000,
    fencing_token: 1,
    takeover_request_id: null,
    takeover_requested_by_device_id: null,
    takeover_requested_by_client_id: null,
    takeover_deadline_at: null,
  }, "device-a", "client-b");

  assert.equal(controller.role, "observer");
});

test("controller mutation payload carries device, client, and fencing token", () => {
  const controller = createWorkspaceControllerState({
    role: "controller",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 7,
  });

  assert.deepEqual(createWorkspaceControllerMutationPayload(controller), {
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 7,
  });
});

test("controller rpc payload merges workspace id and extra fields", () => {
  const controller = createWorkspaceControllerState({
    role: "controller",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 7,
  });

  assert.deepEqual(
    createWorkspaceControllerRpcPayload("ws-1", controller, {
      path: "/tmp/project",
      target: { type: "native" },
    }),
    {
      workspaceId: "ws-1",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 7,
      path: "/tmp/project",
      target: { type: "native" },
    },
  );
});

test("release payloads only include ready controller workspaces", () => {
  const payloads = collectControlledWorkspaceReleasePayloads([
    {
      id: "ws-1",
      status: "ready",
      controller: createWorkspaceControllerState({
        role: "controller",
        deviceId: "device-a",
        clientId: "client-a",
        fencingToken: 3,
      }),
    },
    {
      id: "ws-2",
      status: "ready",
      controller: createWorkspaceControllerState({
        role: "observer",
        deviceId: "device-b",
        clientId: "client-b",
        fencingToken: 4,
      }),
    },
    {
      id: "ws-3",
      status: "loading",
      controller: createWorkspaceControllerState({
        role: "controller",
        deviceId: "device-c",
        clientId: "client-c",
        fencingToken: 5,
      }),
    },
  ]);

  assert.deepEqual(payloads, [
    {
      workspaceId: "ws-1",
      deviceId: "device-a",
      clientId: "client-a",
      fencingToken: 3,
    },
  ]);
});

test("runtime snapshot lifecycle replay restores running session state", () => {
  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    {
      snapshot: {
        workspace: {
          workspace_id: "ws-1",
          title: "Workspace 1",
          project_path: "/tmp/ws-1",
          source_kind: "local",
          source_value: "/tmp/ws-1",
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
            id: 1,
            title: "Session 1",
            status: "waiting",
            mode: "branch",
            auto_feed: true,
            queue: [],
            messages: [],
            stream: "",
            unread: 0,
            last_active_at: 1,
            claude_session_id: null,
          },
        ],
        archive: [],
        view_state: {
          active_session_id: "1",
          active_pane_id: "pane-1",
          active_terminal_id: "",
          pane_layout: {
            type: "leaf",
            id: "pane-1",
            session_id: "1",
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
        terminals: [],
      },
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: Date.now() + 30_000,
        fencing_token: 1,
        takeover_request_id: null,
        takeover_requested_by_device_id: null,
        takeover_requested_by_client_id: null,
        takeover_deadline_at: null,
      },
      lifecycle_events: [
        {
          workspace_id: "ws-1",
          session_id: "1",
          seq: 1,
          kind: "tool_started",
          source_event: "PreToolUse",
          data: "{\"session_id\":\"claude-replay\"}",
        },
      ],
    },
    "en",
    {
      agentProvider: "claude",
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
      terminalCompatibilityMode: "standard",
    },
    "device-a",
    "client-a",
  );

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.status, "running");
  assert.equal(session?.claudeSessionId, "claude-replay");
  assert.equal(next.tabs[0]?.paneLayout.type, "leaf");
  if (next.tabs[0]?.paneLayout.type === "leaf") {
    assert.equal(next.tabs[0].paneLayout.sessionId, "1");
  }
});
