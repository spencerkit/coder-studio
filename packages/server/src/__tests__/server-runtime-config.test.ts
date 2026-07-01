import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getRuntimePath, readRuntimeConfig } from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../config.js";
import { createServer, type Server, type ServerRuntimeOptions } from "../server.js";

describe("server runtime config", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
  const originalRuntimePath = process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  let testHomeDir: string;
  let runtimePath: string;
  let server: Server | undefined;

  const createRuntimeServer = async (
    overrides: Partial<ServerConfig> & ServerRuntimeOptions
  ): Promise<Server> => createServer(overrides);

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-server-runtime-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    runtimePath = join(testHomeDir, ".coder-studio", "runtime.json");
    delete process.env.CODER_STUDIO_RUNTIME_DIR;
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = runtimePath;
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    vi.doUnmock("../agent-instructions/publisher.js");
    vi.resetModules();

    if (existsSync(runtimePath)) {
      rmSync(runtimePath);
    }

    rmSync(testHomeDir, { recursive: true, force: true });

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalRuntimeDir === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_DIR;
    } else {
      process.env.CODER_STUDIO_RUNTIME_DIR = originalRuntimeDir;
    }

    if (originalRuntimePath === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
    } else {
      process.env.CODER_STUDIO_RUNTIME_JSON_PATH = originalRuntimePath;
    }
  });

  it("writes runtime config on startup and clears it on stop", async () => {
    server = await createRuntimeServer({
      stateDir: join(testHomeDir, "server-state"),
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: true,
    });

    expect(readRuntimeConfig()).toEqual(
      expect.objectContaining({
        host: "127.0.0.1",
        pid: process.pid,
      })
    );
    expect(getRuntimePath()).toBe(runtimePath);

    await server.stop();
    server = undefined;

    expect(readRuntimeConfig()).toBeNull();
  });

  it("writes runtime config before post-listen workspace sync completes", async () => {
    const syncGate = Promise.withResolvers<void>();
    vi.resetModules();
    vi.doMock("../agent-instructions/publisher.js", async () => {
      const actual = await vi.importActual<typeof import("../agent-instructions/publisher.js")>(
        "../agent-instructions/publisher.js"
      );

      class DeferredPublisher extends actual.AgentInstructionsPublisher {
        override async syncAllOpenWorkspaces() {
          await syncGate.promise;
          return [];
        }
      }

      return {
        ...actual,
        AgentInstructionsPublisher: DeferredPublisher,
      };
    });

    const { createServer: createDeferredServer } = await import("../server.js");

    const pendingServer = createDeferredServer({
      stateDir: join(testHomeDir, "server-state-deferred"),
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: true,
    });

    await expect
      .poll(() => readRuntimeConfig(), {
        timeout: 5_000,
      })
      .not.toBeNull();

    syncGate.resolve();
    server = await pendingServer;
    const { createServer: restoredCreateServer } = await import("../server.js");
    expect(restoredCreateServer).toBeDefined();
  });

  it("resolves the packaged WSL runtime entry alongside the runtime bundle", async () => {
    const runtimeDistDir = join(testHomeDir, "dist", "esm");
    mkdirSync(runtimeDistDir, { recursive: true });
    writeFileSync(join(runtimeDistDir, "server.js"), "export {};\n");
    writeFileSync(join(runtimeDistDir, "wsl-runtime-entry.mjs"), "export {};\n");

    const { resolveWslRuntimeEntryPath } = await import("../runtime/wsl-bootstrap.js");
    const resolved = resolveWslRuntimeEntryPath(
      pathToFileURL(join(runtimeDistDir, "server.js")).href
    );

    expect(resolved).toBe(join(runtimeDistDir, "wsl-runtime-entry.mjs"));
  });
});
