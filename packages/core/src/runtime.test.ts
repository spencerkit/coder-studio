import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteRestartIntent,
  deleteRuntimeConfig,
  getRestartIntentPath,
  getRuntimeDir,
  getRuntimePath,
  getTerminalBrokerRuntimePath,
  getTerminalBrokerSocketPath,
  type RuntimeConfig,
  readRestartIntent,
  readRuntimeConfig,
  writeRestartIntent,
  writeRuntimeConfig,
} from "./runtime.js";

describe("runtime config", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-runtime-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
  });

  afterEach(() => {
    const runtimePath = join(homedir(), ".coder-studio", "runtime.json");
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
  });

  it("prefers explicit runtime dir and path overrides", () => {
    const runtimeDir = join(testHomeDir, "custom-runtime");
    const runtimePath = join(runtimeDir, "alt-runtime.json");
    process.env.CODER_STUDIO_RUNTIME_DIR = runtimeDir;
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = runtimePath;

    expect(getRuntimeDir()).toBe(runtimeDir);
    expect(getRuntimePath()).toBe(runtimePath);

    delete process.env.CODER_STUDIO_RUNTIME_DIR;
    delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  });

  it("writes, reads, and deletes the runtime file", () => {
    const config: RuntimeConfig = {
      host: "127.0.0.1",
      port: 4173,
      pid: 1234,
      token: "token",
      serverInstanceId: "server-1",
      startedAt: 1,
    };

    expect(readRuntimeConfig()).toBeNull();
    writeRuntimeConfig(config);
    expect(readRuntimeConfig()).toEqual(config);
    expect(getRuntimePath()).toBe(join(homedir(), ".coder-studio", "runtime.json"));
    deleteRuntimeConfig();
    expect(readRuntimeConfig()).toBeNull();
  });

  it("writes, reads, and deletes restart intent", () => {
    const intent = {
      requestId: "restart-1",
      expectedServerInstanceId: "server-123",
      createdAt: 100,
      expiresAt: 200,
      mode: "preserve_terminals" as const,
    };

    writeRestartIntent(intent);
    expect(readRestartIntent()).toEqual(intent);

    deleteRestartIntent();
    expect(readRestartIntent()).toBeNull();
  });

  it("returns broker runtime and socket paths inside the runtime dir", () => {
    const runtimeDir = getRuntimeDir();
    expect(getRestartIntentPath()).toBe(join(runtimeDir, "restart-intent.json"));
    expect(getTerminalBrokerRuntimePath()).toBe(join(runtimeDir, "terminal-broker.json"));

    if (process.platform !== "win32") {
      expect(getTerminalBrokerSocketPath()).toBe(join(runtimeDir, "terminal-broker.sock"));
    }
  });

  it("defaults host to localhost when reading a legacy runtime file", () => {
    const runtimeDir = join(homedir(), ".coder-studio");
    if (!existsSync(runtimeDir)) {
      mkdirSync(runtimeDir, { recursive: true });
    }

    writeFileSync(
      getRuntimePath(),
      JSON.stringify({
        port: 4173,
        pid: 1234,
        token: "token",
        serverInstanceId: "server-1",
        startedAt: 1,
      }),
      "utf-8"
    );

    expect(readRuntimeConfig()).toEqual({
      host: "localhost",
      port: 4173,
      pid: 1234,
      token: "token",
      serverInstanceId: "server-1",
      startedAt: 1,
    });
  });
});
