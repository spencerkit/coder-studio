import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canMutateWorkspace,
  collectControlledWorkspaceReleasePayloads,
  createWorkspaceControllerMutationPayload,
  createWorkspaceControllerRpcPayload,
  createWorkspaceControllerState,
  createWorkspaceControllerStateFromLease,
  shouldRecoverWorkspaceController,
} from "../apps/web/src/features/workspace/workspace-controller";
import {
  applyWorkspaceControllerEvent,
  applyWorkspaceBootstrapResult,
  applyWorkspaceRuntimeSnapshot,
  applyWorkspaceRuntimeStateEvent,
} from "../apps/web/src/shared/utils/workspace";
import { createDefaultWorkbenchState } from "../apps/web/src/state/workbench-core";
import { defaultAppSettings } from "../apps/web/src/shared/app/settings-storage";

const APP_SETTINGS = defaultAppSettings();

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
        status: "idle" as const,
        mode: "branch" as const,
        auto_feed: true,
        queue: [],
        messages: [],
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
      supervisor: {
        bindings: [],
        cycles: [],
      },
    },
    terminals: [],
  },
  controller,
  lifecycle_events: [],
});

const createOutputSnapshot = (terminalOutput = "") => {
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

test("runtime snapshot lifecycle replay preserves running session state and restores resume id", () => {
  const snapshot = createRuntimeSnapshot({
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
  snapshot.snapshot.sessions[0].status = "running";

  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    {
      ...snapshot,
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
          kind: "session_started",
          source_event: "SessionStart",
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

test("runtime snapshot lifecycle replay does not override interrupted session state", () => {
  const snapshot = createRuntimeSnapshot({
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
  snapshot.snapshot.sessions[0].status = "interrupted";
  snapshot.lifecycle_events = [
    {
      workspace_id: "ws-1",
      session_id: "1",
      seq: 1,
      kind: "turn_completed",
      source_event: "Stop",
      data: "{\"session_id\":\"claude-replay\"}",
    },
  ];

  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    snapshot,
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.status, "interrupted");
  assert.equal(session?.resumeId, "claude-replay");
});

test("runtime snapshot hydrates session runtime bindings without promoting legacy terminal ids when only runtime identity is available", () => {
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
      session_runtime_bindings: [{
        session_id: "1",
        terminal_id: "runtime-7",
        terminal_runtime_id: "runtime-7",
      }],
    },
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(next.tabs[0]?.sessions[0]?.terminalId, undefined);
  assert.equal(next.tabs[0]?.sessions[0]?.terminalRuntimeId, "runtime-7");
});

test("runtime snapshot still records compatibility terminal ids when workspace terminal ids are supplied", () => {
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
      session_runtime_bindings: [{
        session_id: "1",
        terminal_id: "runtime-7",
        terminal_runtime_id: "runtime-7",
        workspace_terminal_id: "7",
      }],
    },
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(next.tabs[0]?.sessions[0]?.terminalId, "term-7");
  assert.equal(next.tabs[0]?.sessions[0]?.terminalRuntimeId, "runtime-7");
});

test("runtime start stores terminal runtime id on the session when backend returns it", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const terminalRuntimeId = result\.terminal_runtime_id \?\? session\.terminalRuntimeId[\s\S]*?terminalRuntimeId: terminalRuntimeId/,
  );
});

test("runtime start keeps legacy terminal ids as fallback only when no runtime id is returned", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const terminalId = result\.terminal_runtime_id[\s\S]*?\? undefined[\s\S]*?: `term-\$\{result\.terminal_id\}`/,
  );
});

test("runtime start no longer performs client boot_input terminal writes", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );
  const runtimeStartSection = source.slice(
    source.indexOf("const result = await invokeAgent(() => startSessionRuntime({"),
    source.indexOf("const sendAgentRawChunk = async"),
  );

  assert.doesNotMatch(runtimeStartSection, /result\.boot_input/);
  assert.doesNotMatch(runtimeStartSection, /writeWorkspaceTerminalData\(/);
});

test("agent session input routes through terminal channel runtime ids with controller identity fields", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /sendTerminalChannelInput\(tab\.id, tab\.controller\.deviceId, tab\.controller\.clientId, tab\.controller\.fencingToken, session\.terminalRuntimeId, input\)/,
  );
  assert.match(source, /if \(!session\.terminalRuntimeId\) return false;/);
  assert.match(source, /const bufferedInput = agentTerminalInputBufferRef\.current\.get\(paneId\) \?\? "";/);
  assert.match(source, /clearAgentTerminalInputFlushTimer\(paneId\);/);
  assert.match(source, /consumeTerminalChannelInputFragment\(bufferedInput, data\)/);
  assert.match(source, /if \(pending === "\\u001b"\) \{[\s\S]*?scheduleAgentTerminalEscapeFlush\(paneId\);/);
  assert.match(source, /void forwardAgentTerminalInput\(paneId, pending\);/);
  assert.match(source, /await forwardAgentTerminalInput\(paneId, forwarded\);/);
  assert.doesNotMatch(source, /if \(!session\.terminalId \|\| !session\.terminalRuntimeId\) return false;/);
  assert.doesNotMatch(source, /if \(result\.boot_input\)[\s\S]*?writeWorkspaceTerminalData\(/);
  assert.doesNotMatch(source, /sanitizeTerminalChannelInput\(data\)/);
  assert.doesNotMatch(source, /\^\\x1B\\\[\[0-9;\]\*\[R\?AHFGSTIcJJKMSXh\]/);
});

test("agent pane session readiness starts runtimes from runtime identity instead of legacy terminal ids", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(!sessionSnapshot\.terminalRuntimeId\) \{/);
  assert.doesNotMatch(source, /if \(!sessionSnapshot\.terminalId\) \{/);
});

test("runtime snapshot remaps draft session ids without treating terminal runtime ids as workspace terminal ids", () => {
  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    {
      ...createRuntimeSnapshot({
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-b",
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
          controller_client_id: "client-b",
          lease_expires_at: Date.now() + 30_000,
          fencing_token: 1,
          takeover_request_id: null,
          takeover_requested_by_device_id: null,
          takeover_requested_by_client_id: null,
          takeover_deadline_at: null,
        }).snapshot,
        sessions: [],
        view_state: {
          active_session_id: "draft-remote",
          active_pane_id: "pane-draft-remote",
          active_terminal_id: "",
          pane_layout: {
            type: "leaf",
            id: "pane-draft-remote",
            session_id: "draft-remote",
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
        terminals: [{ id: 7, output: "live terminal output", recoverable: true }],
      },
      session_runtime_bindings: [{
        session_id: "draft-remote",
        terminal_id: "runtime-7",
        terminal_runtime_id: "runtime-7",
        workspace_terminal_id: "7",
      }],
    },
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const draftSession = next.tabs[0]?.sessions[0];
  assert.equal(draftSession?.id, "draft-remote");
  assert.equal(draftSession?.isDraft, true);
  assert.equal(next.tabs[0]?.activeSessionId, "draft-remote");
  assert.equal(next.tabs[0]?.activePaneId, "pane-draft-remote");
  assert.equal(draftSession?.terminalId, "term-7");
  assert.equal(draftSession?.terminalRuntimeId, "runtime-7");
});

test("runtime snapshot remap keeps workspace terminal ids when active binding only exposes terminal runtime id", () => {
  const next = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    {
      ...createRuntimeSnapshot({
        workspace_id: "ws-1",
        controller_device_id: "device-a",
        controller_client_id: "client-b",
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
          controller_client_id: "client-b",
          lease_expires_at: Date.now() + 30_000,
          fencing_token: 1,
          takeover_request_id: null,
          takeover_requested_by_device_id: null,
          takeover_requested_by_client_id: null,
          takeover_deadline_at: null,
        }).snapshot,
        sessions: [],
        view_state: {
          active_session_id: "remote-session",
          active_pane_id: "pane-1",
          active_terminal_id: "",
          pane_layout: {
            type: "leaf",
            id: "pane-1",
            session_id: "remote-session",
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
        terminals: [{ id: 7, output: "live terminal output", recoverable: true }],
      },
      session_runtime_bindings: [{
        session_id: "remote-session",
        terminal_id: "runtime-7",
        terminal_runtime_id: "runtime-7",
        workspace_terminal_id: "7",
      }],
    },
    "en",
    APP_SETTINGS,
    "device-b",
    "client-b",
  );

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.id, "remote-session");
  assert.equal(session?.terminalId, "term-7");
  assert.equal(session?.terminalRuntimeId, "runtime-7");
  assert.notEqual(session?.terminalId, "term-runtime-7");
});

test("runtime state event applies session status patches without requiring a view patch", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createRuntimeSnapshot({
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
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const next = applyWorkspaceRuntimeStateEvent(attached, {
    workspace_id: "ws-1",
    session_state: {
      session_id: "1",
      status: "interrupted",
      last_active_at: 42,
      resume_id: "resume-99",
    },
  } as never);

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.status, "interrupted");
  assert.equal(session?.lastActiveAt, 42);
  assert.equal(session?.resumeId, "resume-99");
  assert.equal(next.tabs[0]?.activeSessionId, "1");
});

test("runtime snapshot and state events preserve session runtime liveness", () => {
  const snapshot = createRuntimeSnapshot({
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
  snapshot.snapshot.sessions[0] = {
    ...snapshot.snapshot.sessions[0],
    runtime_active: true,
    runtime_liveness: "attached",
  };

  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    snapshot as never,
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(attached.tabs[0]?.sessions[0]?.runtimeLiveness, "attached");

  const next = applyWorkspaceRuntimeStateEvent(attached, {
    workspace_id: "ws-1",
    session_state: {
      session_id: "1",
      status: "interrupted",
      last_active_at: 42,
      resume_id: "resume-99",
      runtime_liveness: "provider_exited",
    },
  } as never);

  const session = next.tabs[0]?.sessions[0];
  assert.equal(session?.runtimeLiveness, "provider_exited");
  assert.equal(session?.status, "interrupted");
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

test("runtime snapshot does not overwrite a newer live terminal snapshot with a shorter replay", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot("terminal-output"),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    attached,
    createOutputSnapshot("term"),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(merged.tabs[0]?.terminals[0]?.output, "terminal-output");
});

test("runtime snapshot bridges truncated-head terminal replays with newer appended output", () => {
  const attached = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot("123456"),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  const merged = applyWorkspaceRuntimeSnapshot(
    attached,
    createOutputSnapshot("345678"),
    "en",
    APP_SETTINGS,
    "device-a",
    "client-a",
  );

  assert.equal(merged.tabs[0]?.terminals[0]?.output, "12345678");
});

test("bootstrap replay merges against the latest store state instead of replacing newer terminal output", () => {
  const current = applyWorkspaceRuntimeSnapshot(
    createDefaultWorkbenchState(),
    createOutputSnapshot("123456"),
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
          ...createOutputSnapshot("123").snapshot,
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
      runtimeSnapshot: createOutputSnapshot("123"),
    },
  );

  assert.equal(next.tabs[0]?.terminals[0]?.output, "123456");
});
