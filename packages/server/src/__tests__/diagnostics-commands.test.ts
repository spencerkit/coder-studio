import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LspToolRuntimeStatusEntry, ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { describe, expect, it } from "vitest";
import type { EventBus } from "../bus/event-bus.js";
import type { AutoFetchRuntime } from "../git/auto-fetch.js";
import type { SessionManager } from "../session/manager.js";
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
  const { providerRuntimeDeps, ...restOverrides } = overrides;

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
    providerRegistry: providerRegistry as ProviderDefinition[],
    fencingMgr: {} as FencingManager,
    supervisorMgr: {} as SupervisorManager,
    autoFetch: {} as AutoFetchRuntime,
    activationMgr: {} as ActivationManager,
    providerConfigRepo: {
      get: () => undefined,
      getAll: () => ({}),
    },
    providerRuntimeDeps: {
      commandExists: async () => true,
      runCommand: async (file: string) => {
        if (file === "git") {
          return { stdout: "git version 0.0-test\n", stderr: "" };
        }
        if (file === "node") {
          return { stdout: "v0.0.0-test\n", stderr: "" };
        }
        throw new Error(`unexpected command: ${file}`);
      },
      ...providerRuntimeDeps,
    },
    lspMgr: {
      getRuntimeMode: () => "auto",
    } as never,
    lspToolMgr: {
      runtimeStatus: async ({ serverKind }: { serverKind: string }) =>
        ({
          serverKind,
          displayName: `${serverKind} language server`,
          available: serverKind === "typescript",
          autoInstallSupported: serverKind !== "typescript",
          installReadiness:
            serverKind === "python"
              ? "missing_prerequisite"
              : serverKind === "rust"
                ? "unsupported_platform"
                : "ready",
          missingCommands:
            serverKind === "python"
              ? ["pylsp"]
              : serverKind === "go"
                ? ["gopls"]
                : serverKind === "vue"
                  ? ["vue-language-server"]
                  : [],
          missingPrerequisites: serverKind === "python" ? ["python3"] : [],
        }) satisfies LspToolRuntimeStatusEntry,
    } as never,
    lspToolInstallMgr: {
      getLatestFailure: () => undefined,
    } as never,
    ...restOverrides,
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
          code: "git_ready",
          status: "ready",
          version: "git version 0.0-test",
        }),
        expect.objectContaining({
          code: "nodejs_ready",
          status: "ready",
          version: "v0.0.0-test",
        }),
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
    expect(
      (
        result.data as {
          lspServices: Array<{ serverKind: string; status: string }>;
          metadata: {
            lspRuntimeContext?: {
              targetRuntime: "native" | "wsl";
              managedInstallSupported: boolean;
            };
          };
        }
      ).lspServices
    ).toEqual([
      expect.objectContaining({ serverKind: "typescript", status: "installed" }),
      expect.objectContaining({ serverKind: "python", status: "prerequisite_missing" }),
      expect.objectContaining({ serverKind: "go", status: "not_installed" }),
      expect.objectContaining({ serverKind: "rust", status: "not_installed" }),
      expect.objectContaining({ serverKind: "vue", status: "not_installed" }),
    ]);
    expect(
      (
        result.data as {
          metadata: {
            lspRuntimeContext?: {
              targetRuntime: "native" | "wsl";
              managedInstallSupported: boolean;
            };
          };
        }
      ).metadata.lspRuntimeContext
    ).toBeUndefined();
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

  it("surfaces latest failed LSP install state without affecting canContinue", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "diagnostics-lsp-runtime-"));
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-lsp-install-failed",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-1",
          providerId: "claude",
        },
      },
      createContext({
        workspaceMgr: {
          get: (workspaceId: string) =>
            workspaceId === "ws-1" ? { id: "ws-1", path: workspaceDir } : undefined,
          list: () => [],
        } as unknown as WorkspaceManager,
        lspToolMgr: {
          runtimeStatus: async ({ serverKind }: { serverKind: string }) =>
            ({
              serverKind,
              displayName: `${serverKind} language server`,
              available: false,
              autoInstallSupported: true,
              installReadiness: "ready",
              missingCommands: [serverKind],
              missingPrerequisites: [],
            }) satisfies LspToolRuntimeStatusEntry,
        } as never,
        lspToolInstallMgr: {
          getLatestFailure: (serverKind: string) =>
            serverKind === "go"
              ? {
                  jobId: "job-go-failed",
                  serverKind: "go",
                  status: "failed",
                  steps: [],
                  failure: {
                    code: "command_failed",
                    serverKind: "go",
                    message: "install failed",
                    failedStepId: "install-go-lsp",
                    command: "go",
                    args: ["install"],
                    missingCommands: [],
                  },
                }
              : undefined,
        } as never,
      })
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      context: "session_start",
      canContinue: true,
      metadata: {
        workspaceId: "ws-1",
        workspacePath: workspaceDir,
        providerId: "claude",
        lspRuntimeContext: {
          targetRuntime: "native",
          managedInstallSupported: true,
        },
      },
    });
    expect(
      (result.data as { lspServices: Array<{ serverKind: string; status: string }> }).lspServices
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverKind: "go", status: "install_failed" }),
      ])
    );
    expect((result.data as { checks: Array<{ code: string }> }).checks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "lsp_install_failed" })])
    );
  });

  it("reports runtime_off only when the global LSP runtime mode is off", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-session-lsp-runtime-off",
        op: "diagnostics.get",
        args: {
          context: "session_start",
          workspaceId: "ws-1",
          providerId: "claude",
        },
      },
      createContext({
        lspMgr: {
          getRuntimeMode: () => "off",
        } as never,
      })
    );

    expect(result.ok).toBe(true);
    expect(
      (result.data as { lspServices: Array<{ serverKind: string; status: string }> }).lspServices
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverKind: "typescript", status: "runtime_off" }),
        expect.objectContaining({ serverKind: "python", status: "runtime_off" }),
        expect.objectContaining({ serverKind: "go", status: "runtime_off" }),
        expect.objectContaining({ serverKind: "rust", status: "runtime_off" }),
        expect.objectContaining({ serverKind: "vue", status: "runtime_off" }),
      ])
    );
  });

  it("blocks session start when node is missing but keeps workspace-open non-blocking", async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "diagnostics-base-runtime-"));
    const nodeMissingContext = createContext({
      workspaceMgr: {
        get: (workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: workspaceDir } : undefined,
        list: () => [],
      } as unknown as WorkspaceManager,
      providerRuntimeDeps: {
        commandExists: async (command: string) =>
          command === "brew" || command === "claude" || command === "git",
        runCommand: async (file: string) => {
          if (file === "git") {
            return { stdout: "git version 2.49.0\n", stderr: "" };
          }
          if (file === "node") {
            throw Object.assign(new Error("missing node"), { exitCode: 127 });
          }
          return { stdout: "", stderr: "" };
        },
        platform: "darwin",
      },
    });

    const sessionResult = await dispatch(
      {
        kind: "command",
        id: "diag-session-node-missing",
        op: "diagnostics.get",
        args: { context: "session_start", workspaceId: "ws-1", providerId: "claude" },
      },
      nodeMissingContext
    );

    expect(sessionResult.ok).toBe(true);
    expect(sessionResult.data).toMatchObject({ context: "session_start", canContinue: false });
    expect((sessionResult.data as { checks: Array<{ code: string }> }).checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "nodejs_missing" })])
    );

    const workspaceResult = await dispatch(
      {
        kind: "command",
        id: "diag-workspace-node-missing",
        op: "diagnostics.get",
        args: { context: "workspace_open", workspacePath: workspaceDir },
      },
      nodeMissingContext
    );

    expect(workspaceResult.ok).toBe(true);
    expect(workspaceResult.data).toMatchObject({ context: "workspace_open", canContinue: true });
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
          runCommand: async (file: string) => {
            if (file === "git") {
              return { stdout: "git version 2.49.0\n", stderr: "" };
            }

            if (file === "node") {
              return { stdout: "v24.1.0\n", stderr: "" };
            }

            throw new Error(`Unexpected command: ${file}`);
          },
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

  it("uses git and nodejs checks instead of workspace checks in manual diagnostics and includes versions when available", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "diag-manual-runtime-versions",
        op: "diagnostics.get",
        args: {
          context: "manual_check",
          workspaceId: "ws-1",
        },
      },
      createContext({
        providerRuntimeDeps: {
          commandExists: async () => true,
          runCommand: async (file: string) => {
            if (file === "git") {
              return { stdout: "git version 2.49.0\n", stderr: "" };
            }

            if (file === "node") {
              return { stdout: "v24.1.0\n", stderr: "" };
            }

            throw new Error(`Unexpected command: ${file}`);
          },
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
    const checks = (result.data as { checks: Array<{ code: string; version?: string }> }).checks;

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "git_ready",
          version: expect.any(String),
        }),
        expect.objectContaining({
          code: "nodejs_ready",
          version: expect.any(String),
        }),
      ])
    );

    expect(checks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "session_workspace_ready",
        }),
        expect.objectContaining({
          code: "workspace_path_ready",
        }),
      ])
    );
  });
});
