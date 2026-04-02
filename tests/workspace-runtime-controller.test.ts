import test from "node:test";
import assert from "node:assert/strict";
import {
  canMutateWorkspace,
  collectControlledWorkspaceReleasePayloads,
  createWorkspaceControllerMutationPayload,
  createWorkspaceControllerRpcPayload,
  createWorkspaceControllerState,
  createWorkspaceControllerStateFromLease,
  shouldRecoverWorkspaceController,
} from "../apps/web/src/features/workspace/workspace-controller.ts";
import {
  applyWorkspaceControllerEvent,
  applyWorkspaceBootstrapResult,
  applyWorkspaceRuntimeSnapshot,
} from "../apps/web/src/shared/utils/workspace.ts";
import { createDefaultWorkbenchState } from "../apps/web/src/state/workbench-core.ts";

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

const createRuntimeSnapshot = (controller: {
  workspace_id: string;
  controller_device_id?: string | null;
  controller_client_id?: string | null;
  lease_expires_at: number;
  fencing_token: number;
  takeover_request_id?: string | null;
  takeover_requested_by_device_id?: string | null;
  takeover_requested_by_client_id?: string | null;
  takeover_deadline_at?: number | null;
}) => ({
  snapshot: {
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
        status: "waiting" as const,
        mode: "branch" as const,
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
  },
  controller,
  lifecycle_events: [],
});

const createOutputSnapshot = ({
  sessionStream,
  terminalOutput = "",
}: {
  sessionStream: string;
  terminalOutput?: string;
}) => {
  const runtime = createRuntimeSnapshot({
    workspace_id: "ws-1",
    controller_device_id: "device-a",
    controller_client_id: "client-a",
    lease_expires_at: Date.now() + 30_000,
    fencing_token: 1,
    takeover_request_id: null,
    takeover_requested_by_device_id: null,
    takeover_requested_by_client_id: null,
    takeover_deadline_at: null,
  });
  runtime.snapshot.sessions[0].stream = sessionStream;
  runtime.snapshot.terminals = terminalOutput
    ? [{ id: 7, output: terminalOutput, recoverable: true }]
    : [];
  runtime.snapshot.view_state.active_terminal_id = terminalOutput ? "term-7" : "";
  return runtime;
};

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

test("observer controllers remain recoverable while takeover is not pending", () => {
  const controller = createWorkspaceControllerState({
    role: "observer",
    deviceId: "device-a",
    clientId: "client-b",
    controllerDeviceId: "device-a",
    controllerClientId: "client-a",
    fencingToken: 1,
    takeoverPending: false,
  });

  assert.equal(shouldRecoverWorkspaceController(controller), true);
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
      ...createRuntimeSnapshot({
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: Date.now() + 30_000,
        fencing_token: 1,
        takeover_request_id: null,
        takeover_requested_by_device_id: null,
        takeover_requested_by_client_id: null,
        takeover_deadline_at: null,
      }),
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
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.status, "running");
  assert.equal(session?.resumeId, "claude-replay");
  assert.equal(next.tabs[0]?.paneLayout.type, "leaf");
  if (next.tabs[0]?.paneLayout.type === "leaf") {
    assert.equal(next.tabs[0].paneLayout.sessionId, "1");
  }
});

test("runtime snapshot hydrates session terminal bindings from runtime payload", () => {
  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    {
      ...createRuntimeSnapshot({
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: Date.now() + 30_000,
        fencing_token: 1,
        takeover_request_id: null,
        takeover_requested_by_device_id: null,
        takeover_requested_by_client_id: null,
        takeover_deadline_at: null,
      }),
      snapshot: {
        ...createRuntimeSnapshot({
          workspace_id: "ws-1",
          controller_device_id: "device-a",
          controller_client_id: "client-a",
          lease_expires_at: Date.now() + 30_000,
          fencing_token: 1,
          takeover_request_id: null,
          takeover_requested_by_device_id: null,
          takeover_requested_by_client_id: null,
          takeover_deadline_at: null,
        }).snapshot,
        terminals: [{ id: 7, output: "live terminal output", recoverable: true }],
      },
      session_runtime_bindings: [{ session_id: "1", terminal_id: "7" }],
    },
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(next.tabs[0]?.sessions[0]?.terminalId, "term-7");
});

test("runtime snapshot keeps newer takeover state from controller events on the same lease", () => {
  const staleSnapshot = createRuntimeSnapshot({
    workspace_id: "ws-1",
    controller_device_id: "device-a",
    controller_client_id: "client-a",
    lease_expires_at: 100,
    fencing_token: 1,
    takeover_request_id: null,
    takeover_requested_by_device_id: null,
    takeover_requested_by_client_id: null,
    takeover_deadline_at: null,
  });

  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    staleSnapshot,
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const afterControllerEvent = applyWorkspaceControllerEvent(
    attached,
    {
      workspace_id: "ws-1",
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: 100,
        fencing_token: 1,
        takeover_request_id: "takeover-1",
        takeover_requested_by_device_id: "device-b",
        takeover_requested_by_client_id: "client-b",
        takeover_deadline_at: 140,
      },
    },
    "device-b",
    "client-b",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    afterControllerEvent,
    staleSnapshot,
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  assert.equal(merged.tabs[0]?.controller.role, "observer");
  assert.equal(merged.tabs[0]?.controller.takeoverPending, true);
  assert.equal(merged.tabs[0]?.controller.takeoverRequestedBySelf, true);
  assert.equal(merged.tabs[0]?.controller.takeoverRequestId, "takeover-1");
  assert.equal(merged.tabs[0]?.controller.takeoverDeadlineAt, 140);
});

test("runtime snapshot keeps takeover state while a newer attach races the controller event", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createRuntimeSnapshot({
      workspace_id: "ws-1",
      controller_device_id: "device-a",
      controller_client_id: "client-a",
      lease_expires_at: 100,
      fencing_token: 1,
      takeover_request_id: null,
      takeover_requested_by_device_id: null,
      takeover_requested_by_client_id: null,
      takeover_deadline_at: null,
    }),
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const afterControllerEvent = applyWorkspaceControllerEvent(
    attached,
    {
      workspace_id: "ws-1",
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: 100,
        fencing_token: 1,
        takeover_request_id: "takeover-1",
        takeover_requested_by_device_id: "device-b",
        takeover_requested_by_client_id: "client-b",
        takeover_deadline_at: 140,
      },
    },
    "device-b",
    "client-b",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    afterControllerEvent,
    createRuntimeSnapshot({
      workspace_id: "ws-1",
      controller_device_id: "device-a",
      controller_client_id: "client-a",
      lease_expires_at: 120,
      fencing_token: 1,
      takeover_request_id: null,
      takeover_requested_by_device_id: null,
      takeover_requested_by_client_id: null,
      takeover_deadline_at: null,
    }),
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  assert.equal(merged.tabs[0]?.controller.takeoverPending, true);
  assert.equal(merged.tabs[0]?.controller.takeoverRequestId, "takeover-1");
});

test("controller events can clear takeover state after a preserved runtime merge", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createRuntimeSnapshot({
      workspace_id: "ws-1",
      controller_device_id: "device-a",
      controller_client_id: "client-a",
      lease_expires_at: 100,
      fencing_token: 1,
      takeover_request_id: null,
      takeover_requested_by_device_id: null,
      takeover_requested_by_client_id: null,
      takeover_deadline_at: null,
    }),
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const afterControllerEvent = applyWorkspaceControllerEvent(
    attached,
    {
      workspace_id: "ws-1",
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: 100,
        fencing_token: 1,
        takeover_request_id: "takeover-1",
        takeover_requested_by_device_id: "device-b",
        takeover_requested_by_client_id: "client-b",
        takeover_deadline_at: 140,
      },
    },
    "device-b",
    "client-b",
  );

  const preserved = applyWorkspaceRuntimeSnapshot(
    afterControllerEvent,
    createRuntimeSnapshot({
      workspace_id: "ws-1",
      controller_device_id: "device-a",
      controller_client_id: "client-a",
      lease_expires_at: 120,
      fencing_token: 1,
      takeover_request_id: null,
      takeover_requested_by_device_id: null,
      takeover_requested_by_client_id: null,
      takeover_deadline_at: null,
    }),
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const cleared = applyWorkspaceControllerEvent(
    preserved,
    {
      workspace_id: "ws-1",
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: 121,
        fencing_token: 1,
        takeover_request_id: null,
        takeover_requested_by_device_id: null,
        takeover_requested_by_client_id: null,
        takeover_deadline_at: null,
      },
    },
    "device-b",
    "client-b",
  );

  assert.equal(cleared.tabs[0]?.controller.takeoverPending, false);
  assert.equal(cleared.tabs[0]?.controller.takeoverRequestId, undefined);
});

test("controller events reuse the current state when the effective controller is unchanged", () => {
  const current = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createRuntimeSnapshot({
      workspace_id: "ws-1",
      controller_device_id: "device-a",
      controller_client_id: "client-a",
      lease_expires_at: 100,
      fencing_token: 1,
      takeover_request_id: null,
      takeover_requested_by_device_id: null,
      takeover_requested_by_client_id: null,
      takeover_deadline_at: null,
    }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const next = applyWorkspaceControllerEvent(
    current,
    {
      workspace_id: "ws-1",
      controller: {
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-a",
        lease_expires_at: 100,
        fencing_token: 1,
        takeover_request_id: null,
        takeover_requested_by_device_id: null,
        takeover_requested_by_client_id: null,
        takeover_deadline_at: null,
      },
    },
    "device-a",
    "client-a",
  );

  assert.equal(next, current);
});

test("runtime snapshot does not overwrite a newer live session stream with a shorter replay", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot({ sessionStream: "abcdef", terminalOutput: "terminal-output" }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    attached,
    createOutputSnapshot({ sessionStream: "abc", terminalOutput: "term" }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(merged.tabs[0]?.sessions[0]?.stream, "abcdef");
  assert.equal(merged.tabs[0]?.terminals[0]?.output, "terminal-output");
});

test("runtime snapshot bridges truncated-head replays with newer appended output", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot({ sessionStream: "abcdef", terminalOutput: "123456" }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    attached,
    createOutputSnapshot({ sessionStream: "cdefgh", terminalOutput: "345678" }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(merged.tabs[0]?.sessions[0]?.stream, "abcdefgh");
  assert.equal(merged.tabs[0]?.terminals[0]?.output, "12345678");
});

test("bootstrap replay merges against the latest store state instead of replacing newer streams", () => {
  const current = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot({ sessionStream: "abcdef", terminalOutput: "123456" }),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const next = applyWorkspaceBootstrapResult(
    current,
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
      workspaces: [
        {
          ...createOutputSnapshot({ sessionStream: "abc", terminalOutput: "123" }).snapshot,
        },
      ],
    },
    "en",
    APP_SETTINGS,
    {
      deviceId: "device-a",
      clientId: "client-a",
      uiState: {
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
      runtimeSnapshot: createOutputSnapshot({ sessionStream: "abc", terminalOutput: "123" }),
    },
  );

  assert.equal(next.tabs[0]?.sessions[0]?.stream, "abcdef");
  assert.equal(next.tabs[0]?.terminals[0]?.output, "123456");
});
