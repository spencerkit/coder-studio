import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { dispatch } from "../ws/dispatch.js";

describe("server workspace runtime orchestration", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "server-wsl-runtime-"));
  });

  afterEach(() => {
    vi.doUnmock("../runtime/wsl-runtime.js");
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("rehydrates persisted WSL workspaces with per-workspace runtime ids and preserves them on meta changes", async () => {
    const workspaceRepo = new WorkspaceRepo({
      filePath: join(stateDir, "state", "workspaces.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(stateDir, "state", "settings.json"),
    });
    const customProviderRepo = new CustomProviderRepo({
      filePath: join(stateDir, "state", "custom-providers.json"),
    });
    const workspace: Workspace = {
      id: "ws-wsl",
      path: "/home/spencer/workspace",
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 250,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    };
    workspaceRepo.create(workspace);
    settingsRepo.set("lsp.mode", "off");
    customProviderRepo.set({
      id: "custom-review",
      displayName: "Custom Review",
      command: "custom-review",
      args: ["--stdio"],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive" }],
      createdAt: 1,
      updatedAt: 1,
    });

    const syncSnapshot = vi.fn(async () => {});

    const createWslRuntime = vi.fn(
      async ({
        workspace,
        settingsSnapshot,
        customProviderConfigs,
      }: {
        workspace: Workspace;
        settingsSnapshot: Record<string, unknown>;
        customProviderConfigs: Array<{ id: string }>;
      }) => ({
        id: `wsl:${workspace.id}`,
        kind: "wsl" as const,
        summary: {
          scope: "workspace" as const,
          workspaceId: workspace.id,
          targetRuntime: "wsl" as const,
          wslDistro: workspace.wslDistro,
        },
        execute: vi.fn(async () => ({})),
        disposeWorkspace: vi.fn(async () => {}),
        syncSnapshot,
        health: async () => ({ ok: true as const }),
        stop: vi.fn(async () => {}),
        __snapshot: {
          settingsSnapshot,
          customProviderConfigs,
        },
      })
    );

    vi.doMock("../runtime/wsl-runtime.js", () => ({
      createWslRuntime,
    }));

    const { createServer } = await import("../server.js");
    const server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    try {
      const bindings = server.__test__!.hostContext.runtimeBindings;
      expect(bindings.getRuntimeIdForWorkspace("ws-wsl")).toBe("wsl:ws-wsl");
      expect(createWslRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: expect.objectContaining({
            id: "ws-wsl",
            targetRuntime: "wsl",
            wslDistro: "Ubuntu-24.04",
          }),
          settingsSnapshot: expect.objectContaining({
            "lsp.mode": "off",
          }),
          customProviderConfigs: [
            expect.objectContaining({
              id: "custom-review",
            }),
          ],
        })
      );

      server.__test__!.commandContext.workspaceMgr.updateUiState("ws-wsl", {
        leftPanelWidth: 320,
        bottomPanelHeight: 220,
        focusMode: true,
      });

      expect(bindings.getRuntimeIdForWorkspace("ws-wsl")).toBe("wsl:ws-wsl");
      await expect
        .poll(() => syncSnapshot.mock.calls.length, { timeout: 5_000 })
        .toBeGreaterThanOrEqual(1);

      const settingsUpdate = await dispatch(
        {
          kind: "command",
          id: "settings-update-wsl-runtime",
          op: "settings.update",
          args: {
            settings: {
              lsp: {
                mode: "auto",
              },
            },
          },
        },
        server.__test__!.commandContext
      );
      expect(settingsUpdate.ok).toBe(true);
      await expect
        .poll(
          () =>
            syncSnapshot.mock.calls.findLast(
              ([snapshot]) => snapshot.settings?.["lsp.mode"] === "auto"
            )?.[0],
          { timeout: 5_000 }
        )
        .toEqual(
          expect.objectContaining({
            settings: expect.objectContaining({
              "lsp.mode": "auto",
            }),
          })
        );

      const customProviderCreate = await dispatch(
        {
          kind: "command",
          id: "custom-provider-create-wsl-runtime",
          op: "customProvider.create",
          args: {
            id: "review-bot",
            displayName: "Review Bot",
            command: "review-bot",
            args: ["--stdio"],
            env: {},
            cwdMode: "workspace_root",
            sessionMode: "interactive",
            capabilities: [
              { key: "interactive_session", supported: true, label: "Interactive session" },
              { key: "review", supported: true, label: "Review" },
            ],
          },
        },
        server.__test__!.commandContext
      );
      expect(customProviderCreate.ok).toBe(true);
      await expect
        .poll(
          () =>
            syncSnapshot.mock.calls.findLast(([snapshot]) =>
              snapshot.customProviders?.some?.(
                (provider: { id: string }) => provider.id === "review-bot"
              )
            )?.[0],
          { timeout: 5_000 }
        )
        .toEqual(
          expect.objectContaining({
            customProviders: expect.arrayContaining([
              expect.objectContaining({
                id: "review-bot",
              }),
            ]),
          })
        );
    } finally {
      await server.stop();
    }
  });
});
