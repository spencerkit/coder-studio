import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceMemoryEntry } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "../server.js";
import { dispatch } from "../ws/dispatch.js";

describe("createServer memory wiring", () => {
  let server: Server | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("assembles workspace memory storage into the command context", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "coder-studio-server-memory-"));
    const workspaceDir = join(tempDir, "workspace");
    server = await createServer({
      stateDir: join(tempDir, "state-root"),
      host: "127.0.0.1",
      port: 0,
    });
    const ctx = server.__test__!.commandContext;
    mkdirSync(workspaceDir, { recursive: true });
    const workspace = await ctx.workspaceMgr.open({ path: workspaceDir });

    const result = await dispatch(
      {
        kind: "command",
        id: "server-memory-create",
        op: "memory.create",
        args: {
          workspaceId: workspace.id,
          type: "project",
          content: "Memory commands use the server-assembled MemoryRepo.",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      workspaceId: workspace.id,
      type: "wiki",
      content: "Memory commands use the server-assembled MemoryRepo.",
    } satisfies Partial<WorkspaceMemoryEntry>);
    expect(ctx.memoryRepo?.list({ workspaceId: workspace.id })).toHaveLength(1);
  }, 20_000);
});
