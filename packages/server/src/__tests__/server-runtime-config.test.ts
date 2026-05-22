import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRuntimePath, readRuntimeConfig } from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
