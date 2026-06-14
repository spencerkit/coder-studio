/**
 * Tests for Command Dispatch
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CommandContext } from "../ws/dispatch.js";
import "../commands/workspace-activity.js";
import "../commands/ui-actions.js";
import { dispatch, getRegisteredCommands, registerCommand } from "../ws/dispatch.js";

describe("Command Dispatch", () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      workspaceMgr: {},
      sessionMgr: {},
      terminalMgr: {},
      eventBus: {},
      broadcaster: {},
      autoFetch: {
        registerViewer: vi.fn(),
        unregisterViewer: vi.fn(),
      },
    } as CommandContext;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("registerCommand", () => {
    it("should register a command handler", () => {
      registerCommand("test.command", z.object({ value: z.number() }), async (args) => ({
        doubled: args.value * 2,
      }));

      const commands = getRegisteredCommands();
      expect(commands).toContain("test.command");
    });

    it("should dispatch to registered handler", async () => {
      registerCommand("test.echo", z.object({ message: z.string() }), async (args) => ({
        echoed: args.message,
      }));

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-1",
          op: "test.echo",
          args: { message: "hello" },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ echoed: "hello" });
    });

    it("should return error for unknown command", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-2",
          op: "unknown.command",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("unknown_op");
    });

    it("should validate args with schema", async () => {
      registerCommand("test.validated", z.object({ count: z.number().min(0) }), async (args) => ({
        count: args.count,
      }));

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-3",
          op: "test.validated",
          args: { count: -1 },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("validation_error");
    });

    it("should handle handler errors", async () => {
      registerCommand("test.error", z.object({}), async () => {
        throw new Error("Handler error");
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-4",
          op: "test.error",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("internal_error");
      expect(result.error?.message).toBe("Handler error");
    });

    it("should handle custom error codes", async () => {
      registerCommand("test.custom_error", z.object({}), async () => {
        throw { code: "custom_error", message: "Custom error occurred" };
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-5",
          op: "test.custom_error",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("custom_error");
      expect(result.error?.message).toBe("Custom error occurred");
    });

    it("dispatches each git.status request independently without coalescing", async () => {
      const handler = vi
        .fn()
        .mockResolvedValueOnce({ branch: "main" })
        .mockResolvedValueOnce({ branch: "feature/next" });
      registerCommand("git.status", z.object({ workspaceId: z.string() }), handler);

      const resolvedIds: string[] = [];
      const first = dispatch(
        {
          kind: "command",
          id: "git-status-1",
          op: "git.status",
          args: { workspaceId: "ws-test" },
        },
        ctx
      ).then((result) => {
        resolvedIds.push(result.id);
        return result;
      });
      const second = dispatch(
        {
          kind: "command",
          id: "git-status-2",
          op: "git.status",
          args: { workspaceId: "ws-test" },
        },
        ctx
      ).then((result) => {
        resolvedIds.push(result.id);
        return result;
      });

      await expect(first).resolves.toMatchObject({ ok: true, data: { branch: "main" } });
      await expect(second).resolves.toMatchObject({ ok: true, data: { branch: "feature/next" } });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(resolvedIds).toEqual(["git-status-1", "git-status-2"]);
    });

    it("registers the active workspace with autoFetch on workspace.activate", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-activate-1",
          op: "workspace.activate",
          args: { workspaceId: "ws-test" },
        },
        ctx,
        "client-1"
      );

      expect(result.ok).toBe(true);
      expect(ctx.autoFetch.registerViewer).toHaveBeenCalledWith("client-1", "ws-test");
    });

    it("unregisters the active workspace from autoFetch on workspace.deactivate", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-deactivate-1",
          op: "workspace.deactivate",
          args: {},
        },
        ctx,
        "client-1"
      );

      expect(result.ok).toBe(true);
      expect(ctx.autoFetch.unregisterViewer).toHaveBeenCalledWith("client-1");
    });

    it("allows UI action dispatch from command clients without an active browser lease", async () => {
      const broadcast = vi.fn();
      ctx = {
        ...ctx,
        broadcaster: {
          broadcast,
          getRequestMetadata: () => ({ url: "/ws" }),
        } as never,
        activationMgr: { getLease: () => undefined } as never,
      };

      const result = await dispatch(
        {
          kind: "command",
          id: "ui-action-allowlist-1",
          op: "uiAction.dispatch",
          args: {
            workspaceId: "ws-1",
            requestId: "req-1",
            intent: { type: "panel.show", panel: "terminal" },
          },
        },
        ctx,
        "cli-client"
      );

      expect(result.ok).toBe(true);
      expect(broadcast).toHaveBeenCalled();
    });
  });
});
