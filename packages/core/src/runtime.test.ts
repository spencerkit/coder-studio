import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRestartIntent,
  deleteRuntimeConfig,
  deleteTerminalBrokerRuntime,
  getRestartIntentPath,
  getRuntimeDir,
  getRuntimePath,
  getTerminalBrokerRuntimePath,
  getTerminalBrokerSocketPath,
  type RuntimeConfig,
  readRestartIntent,
  readRuntimeConfig,
  readTerminalBrokerRuntime,
  writeRestartIntent,
  writeRuntimeConfig,
  writeTerminalBrokerRuntime,
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
    delete process.env.CODER_STUDIO_RUNTIME_DIR;
    delete process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
    vi.restoreAllMocks();

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

  it("returns null for invalid restart intent and broker runtime files", () => {
    mkdirSync(getRuntimeDir(), { recursive: true });
    writeFileSync(
      getRestartIntentPath(),
      JSON.stringify({
        requestId: "restart-1",
        expectedServerInstanceId: "server-123",
        createdAt: 100,
      }),
      "utf-8"
    );
    writeFileSync(
      getTerminalBrokerRuntimePath(),
      JSON.stringify({
        endpoint: "ws://127.0.0.1:9999",
        pid: "1234",
        startedAt: 100,
      }),
      "utf-8"
    );

    expect(readRestartIntent()).toBeNull();
    expect(readTerminalBrokerRuntime()).toBeNull();
  });

  it("writes, reads, and deletes broker runtime config", () => {
    const config = {
      endpoint: "ws://127.0.0.1:9999",
      pid: 1234,
      startedAt: 100,
    };

    writeTerminalBrokerRuntime(config);
    expect(readTerminalBrokerRuntime()).toEqual(config);

    deleteTerminalBrokerRuntime();
    expect(readTerminalBrokerRuntime()).toBeNull();
  });

  it("derives a runtime-specific Windows pipe path from the runtime dir", () => {
    const runtimeDir = join(testHomeDir, "custom runtime", "nested");
    process.env.CODER_STUDIO_RUNTIME_DIR = runtimeDir;
    const expectedHash = createHash("sha256").update(runtimeDir).digest("hex");
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      expect(getTerminalBrokerSocketPath()).toBe(
        `\\\\.\\pipe\\coder-studio-terminal-broker-${expectedHash}`
      );
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(process, "platform", platformDescriptor);
      }
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
