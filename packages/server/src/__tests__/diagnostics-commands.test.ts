import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { describe, expect, it } from "vitest";
import type { EventBus } from "../bus/event-bus.js";
import type { AutoFetchRuntime } from "../git/auto-fetch.js";
import type { SessionManager } from "../session/manager.js";
import type { Database } from "../storage/database.js";
import type { SupervisorManager } from "../supervisor/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { ActivationManager } from "../ws/activation.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";
import type { FencingManager } from "../ws/fencing.js";
import type { Broadcaster } from "../ws/hub.js";

import "../commands/diagnostics.js";
import "../commands/workspace.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {
      get: (workspaceId: string) =>
        workspaceId === "ws-1" ? { id: "ws-1", path: "/tmp/project" } : undefined,
      list: () => [],
    } as unknown as WorkspaceManager,
    sessionMgr: {} as SessionManager,
    terminalMgr: {} as TerminalManager,
    eventBus: {} as EventBus,
    broadcaster: {
      broadcast: () => {},
      sendToClient: () => true,
      sendBinaryToClient: () => true,
    } as unknown as Broadcaster,
    db: {} as Database,
    providerRegistry: providerRegistry as ProviderDefinition[],
    fencingMgr: {} as FencingManager,
    supervisorMgr: {} as SupervisorManager,
    autoFetch: {} as AutoFetchRuntime,
    activationMgr: {} as ActivationManager,
    providerConfigRepo: {
      get: () => undefined,
      getAll: () => ({}),
    },
    ...overrides,
  };
}

describe("diagnostics commands", () => {
  it("returns a blocking workspace check when no workspace path is available", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-workspace-missing-path",
        op: "diagnostics.get",
        args: {
          context: "workspace_open",
        },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "workspace_open",
      canContinue: true,
      metadata: {},
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_runtime_ready",
          status: "ready",
        }),
        expect.objectContaining({
          code: "mobile_host_local_only",
          status: "needs_attention",
        }),
      ])
    );
  });

  it("surfaces missing provider CLI checks for session start diagnostics", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-provider-missing",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-1",
          providerId: "claude",
        },
      },
      createContext({
        providerRuntimeDeps: {
          commandExists: async (command: string) => command !== "claude",
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "session_start",
      canContinue: false,
      metadata: {
        workspaceId: "ws-1",
        workspacePath: "/tmp/project",
        providerId: "claude",
      },
    });
    expect(
      (result.data as { checks: Array<{ code: string; missingCommands?: string[] }> }).checks
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_cli_missing",
          missingCommands: ["claude"],
        }),
      ])
    );
  });

  it("returns workspace_path_not_found when the selected workspace path no longer exists", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-workspace-path-missing",
        op: "diagnostics.get",
        args: {
          context: "workspace_open",
          workspacePath: "/definitely/missing/path",
        },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "workspace_open",
      canContinue: false,
      metadata: {
        workspacePath: "/definitely/missing/path",
      },
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workspace_path_not_found",
          status: "needs_attention",
        }),
      ])
    );
  });

  it("uses the same workspace validation semantics as workspace.open", async () => {
    const workspaceFileDir = await mkdtemp(join(tmpdir(), "diagnostics-workspace-file-"));
    const workspaceFilePath = join(workspaceFileDir, "not-a-directory.txt");
    await writeFile(workspaceFilePath, "hello");

    const result = await dispatch(
      {
        kind: "command",
        id: "diag-workspace-file-path",
        op: "diagnostics.get",
        args: {
          context: "workspace_open",
          workspacePath: workspaceFilePath,
        },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "workspace_path_unreadable",
          status: "needs_attention",
        }),
      ])
    );
  });

  it("reports a missing workspace target for session diagnostics", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-workspace-missing",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-missing",
          providerId: "claude",
        },
      },
      createContext({
        providerRuntimeDeps: {
          commandExists: async () => true,
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "session_start",
      canContinue: false,
      metadata: {
        workspaceId: "ws-missing",
        providerId: "claude",
      },
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "session_workspace_missing",
          status: "needs_attention",
        }),
        expect.objectContaining({
          code: "provider_runtime_ready",
          status: "ready",
        }),
      ])
    );
  });

  it("reports an unknown provider for session diagnostics", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-provider-unknown",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-1",
          providerId: "ghost",
        },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "session_start",
      canContinue: false,
      metadata: {
        workspaceId: "ws-1",
        workspacePath: "/tmp/project",
        providerId: "ghost",
      },
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_unknown",
          status: "needs_attention",
        }),
      ])
    );
  });

  it("surfaces missing prerequisites separately from missing provider commands", async () => {
    const providerWithPrerequisiteRepair = providerRegistry.find(
      (provider) => provider.id === "codex"
    );
    if (!providerWithPrerequisiteRepair) {
      throw new Error("Expected codex provider to exist");
    }

    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-provider-prerequisite-missing",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-1",
          providerId: "codex",
        },
      },
      createContext({
        providerRegistry: [providerWithPrerequisiteRepair as ProviderDefinition],
        providerRuntimeDeps: {
          platform: "darwin",
          commandExists: async (command: string) => command === "brew",
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(
      (result.data as { checks: Array<{ code: string; missingPrerequisites?: string[] }> }).checks
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_prerequisite_missing",
          missingPrerequisites: ["npm"],
        }),
      ])
    );
  });

  it("returns blocking mobile diagnostics when host exposure or auth is not ready", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-mobile-blocked",
        op: "diagnostics.get",
        args: {
          context: "mobile_continue",
        },
      },
      createContext({
        config: {
          host: "127.0.0.1",
          auth: {
            enabled: false,
          },
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "mobile_continue",
      canContinue: false,
      metadata: {
        authEnabled: false,
        host: "127.0.0.1",
      },
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mobile_host_local_only",
          status: "needs_attention",
        }),
        expect.objectContaining({
          code: "mobile_auth_disabled",
          status: "needs_attention",
        }),
      ])
    );
  });

  it("treats 0.0.0.0 as local-only for mobile continuation diagnostics", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-mobile-unspecified-host",
        op: "diagnostics.get",
        args: {
          context: "mobile_continue",
          workspaceId: "ws-1",
        },
      },
      createContext({
        config: {
          host: "0.0.0.0",
          auth: {
            enabled: true,
          },
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "mobile_continue",
      canContinue: false,
      metadata: {
        authEnabled: true,
        host: "0.0.0.0",
        workspaceId: "ws-1",
      },
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "mobile_host_local_only",
          status: "needs_attention",
        }),
        expect.objectContaining({
          code: "server_auth_ready",
          status: "ready",
        }),
      ])
    );
  });

  it("rechecks manual diagnostics and returns a ready result when providers are available", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-manual-recheck",
        op: "diagnostics.recheck",
        args: {
          context: "manual_check",
        },
      },
      createContext({
        providerRuntimeDeps: {
          commandExists: async () => true,
        },
        config: {
          host: "192.168.1.10",
          auth: {
            enabled: true,
            password: "secret",
          },
        },
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "manual_check",
      canContinue: true,
    });
    expect((result.data as { checks: Array<{ code: string; status: string }> }).checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "provider_runtime_ready",
          status: "ready",
        }),
        expect.objectContaining({
          code: "server_auth_ready",
          status: "ready",
        }),
      ])
    );
  });
});
