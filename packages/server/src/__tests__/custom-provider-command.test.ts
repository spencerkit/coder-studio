import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { providerRegistry } from "@coder-studio/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/provider.js";
import "../commands/custom-provider.js";

describe("customProvider commands", () => {
  let tempDir: string;
  let ctx: CommandContext & { customProviderRepo: CustomProviderRepo };
  let registry: ProviderDefinition[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "custom-provider-command-"));
    registry = [...providerRegistry];
    ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: new EventBus(),
      broadcaster: { broadcast: vi.fn() } as never,
      db: {} as never,
      providerRegistry: registry,
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      customProviderRepo: new CustomProviderRepo({
        filePath: join(tempDir, "custom-providers.json"),
      }),
      setProviderRegistry: (providers) => {
        registry = providers;
        ctx.providerRegistry = providers;
      },
    };
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates, lists, updates, and deletes custom providers through dispatch", async () => {
    const created = await dispatch(
      {
        kind: "command",
        id: "custom-provider-create",
        op: "customProvider.create",
        args: {
          id: "review-bot",
          displayName: "Review Bot",
          command: "review-bot",
          args: ["--stdio"],
          env: { REVIEW_MODE: "strict" },
          cwdMode: "workspace_root",
          sessionMode: "interactive",
          startupPrompt: "Review the diff before answering.",
          capabilities: [
            { key: "interactive_session", supported: true, label: "Interactive session" },
            { key: "review", supported: true, label: "Review" },
          ],
        },
      },
      ctx
    );

    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({
      id: "review-bot",
      kind: "custom",
      requiredCommands: ["review-bot"],
    });

    const listed = await dispatch(
      {
        kind: "command",
        id: "provider-list-custom",
        op: "provider.list",
        args: {},
      },
      ctx
    );

    expect(listed.ok).toBe(true);
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review-bot",
          displayName: "Review Bot",
          kind: "custom",
          requiredCommands: ["review-bot"],
        }),
      ])
    );

    const customListed = await dispatch(
      {
        kind: "command",
        id: "custom-provider-list",
        op: "customProvider.list",
        args: {},
      },
      ctx
    );

    expect(customListed.ok).toBe(true);
    expect(customListed.data).toEqual([
      expect.objectContaining({
        id: "review-bot",
        kind: "custom",
      }),
    ]);

    const updated = await dispatch(
      {
        kind: "command",
        id: "custom-provider-update",
        op: "customProvider.update",
        args: {
          id: "review-bot",
          displayName: "Review Bot 2",
          command: "review-bot",
          args: ["--stdio", "--model", "fast"],
          env: { REVIEW_MODE: "fast" },
          cwdMode: "workspace_root",
          sessionMode: "interactive",
          startupPrompt: "Use the fast model.",
          capabilities: [
            { key: "interactive_session", supported: true, label: "Interactive session" },
            { key: "review", supported: true, label: "Review" },
          ],
        },
      },
      ctx
    );

    expect(updated.ok).toBe(true);
    expect(updated.data).toMatchObject({
      id: "review-bot",
      displayName: "Review Bot 2",
    });
    expect(ctx.customProviderRepo.get("review-bot")).toMatchObject({
      displayName: "Review Bot 2",
      args: ["--stdio", "--model", "fast"],
    });

    const removed = await dispatch(
      {
        kind: "command",
        id: "custom-provider-delete",
        op: "customProvider.delete",
        args: {
          id: "review-bot",
        },
      },
      ctx
    );

    expect(removed.ok).toBe(true);
    expect(ctx.customProviderRepo.get("review-bot")).toBeUndefined();
    expect(ctx.providerRegistry.find((provider) => provider.id === "review-bot")).toBeUndefined();
  });

  it("rejects an empty command", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "custom-provider-invalid",
        op: "customProvider.create",
        args: {
          id: "invalid-provider",
          displayName: "Invalid",
          command: "   ",
          args: [],
          env: {},
          cwdMode: "workspace_root",
          sessionMode: "interactive",
          capabilities: [
            { key: "interactive_session", supported: true, label: "Interactive session" },
          ],
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });
});
