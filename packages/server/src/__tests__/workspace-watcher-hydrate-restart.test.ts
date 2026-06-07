import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "../server.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";

describe("workspace watcher hydrate restart", () => {
  let server: Server | undefined;
  let stateDir: string;
  let workspaceDir: string;
  let watchSpy: ReturnType<typeof vi.spyOn<typeof chokidar, "watch">>;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "coder-studio-state-"));
    workspaceDir = mkdtempSync(join(tmpdir(), "coder-studio-workspace-"));
    mkdirSync(join(workspaceDir, ".git"), { recursive: true });
    writeFileSync(join(workspaceDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    watchSpy = vi.spyOn(chokidar, "watch").mockReturnValue({
      on() {
        return this;
      },
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as FSWatcher);
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
    watchSpy.mockRestore();
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("restores persisted workspace watchers after server restart", async () => {
    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    const firstCtx = server.__test__!.commandContext;

    const openResult = await dispatch(
      {
        kind: "command",
        id: "workspace-open",
        op: "workspace.open",
        args: { path: workspaceDir },
      },
      firstCtx
    );

    expect(openResult.ok).toBe(true);
    expect(watchSpy).toHaveBeenCalledTimes(1);

    await server.stop();
    server = undefined;
    watchSpy.mockClear();

    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    expect(watchSpy).toHaveBeenCalledTimes(1);
    expect(watchSpy).toHaveBeenCalledWith(
      workspaceDir,
      expect.objectContaining({
        ignoreInitial: true,
        persistent: true,
      })
    );
  });

  it("restores persisted workspace watchers from state metadata even when no legacy db path exists", async () => {
    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    const firstCtx = server.__test__!.commandContext;

    const openResult = await dispatch(
      {
        kind: "command",
        id: "workspace-open-file-backed",
        op: "workspace.open",
        args: { path: workspaceDir },
      },
      firstCtx
    );

    expect(openResult.ok).toBe(true);

    await server.stop();
    server = undefined;
    watchSpy.mockClear();

    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    expect(watchSpy).toHaveBeenCalledTimes(1);
    expect(watchSpy).toHaveBeenCalledWith(
      workspaceDir,
      expect.objectContaining({
        ignoreInitial: true,
        persistent: true,
      })
    );
  });
});
