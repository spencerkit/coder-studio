import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCliVersion } from "./package-manifest.js";

const { createServer, parseServerConfig, readCliConfig, hasWebAssets, getStaticAssetsDir } =
  vi.hoisted(() => ({
    createServer: vi.fn(),
    parseServerConfig: vi.fn(),
    readCliConfig: vi.fn(),
    hasWebAssets: vi.fn(),
    getStaticAssetsDir: vi.fn(),
  }));

vi.mock("@coder-studio/server", () => ({
  createServer,
  parseServerConfig,
}));

vi.mock("./config-store.js", () => ({
  readCliConfig,
}));

vi.mock("./embed.js", () => ({
  hasWebAssets,
  getStaticAssetsDir,
}));

import {
  buildServerConfig,
  prepareLocalStateStorage,
  runServerEntrypoint,
  startServer,
} from "./server-runner";

describe("server-runner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("includes the CLI package version in the server config", () => {
    readCliConfig.mockReturnValue(null);
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");

    expect(buildServerConfig()).toMatchObject({
      appVersion: getCliVersion(import.meta.url),
      webRoot: "/tmp/web",
    });
  });

  it("ignores ephemeral port zero from saved cli config", () => {
    readCliConfig.mockReturnValue({
      host: "127.0.0.1",
      port: 0,
      dataDir: "/tmp/cs-data/coder-studio.db",
      password: "sekrit",
    });
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");

    expect(buildServerConfig()).toEqual({
      appVersion: getCliVersion(import.meta.url),
      host: "127.0.0.1",
      dataDir: "/tmp/cs-data/coder-studio.db",
      auth: {
        enabled: true,
        password: "sekrit",
      },
      webRoot: "/tmp/web",
    });
  });

  it("starts the server and wires shutdown handlers", async () => {
    readCliConfig.mockReturnValue({
      host: "127.0.0.1",
      port: 4173,
    });
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");

    const stop = vi.fn().mockResolvedValue(undefined);
    createServer.mockResolvedValue({ stop });

    const processOnSpy = vi.spyOn(process, "on");
    const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const runningServer = await startServer();

    expect(createServer).toHaveBeenCalledWith({
      appVersion: getCliVersion(import.meta.url),
      host: "127.0.0.1",
      port: 4173,
      webRoot: "/tmp/web",
    });
    expect(runningServer).toEqual({ stop: expect.any(Function) });
    expect(processOnSpy).toHaveBeenCalledTimes(2);
    expect(processOnSpy).toHaveBeenNthCalledWith(1, "SIGINT", expect.any(Function));
    expect(processOnSpy).toHaveBeenNthCalledWith(2, "SIGTERM", expect.any(Function));

    const shutdown = processOnSpy.mock.calls[0]?.[1] as () => Promise<void>;
    await shutdown();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("prepares local state storage using the resolved server config", () => {
    readCliConfig.mockReturnValue({
      dataDir: "/tmp/cs-data/coder-studio.db",
    });
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");
    parseServerConfig.mockReturnValue({
      dataDir: "/tmp/cs-data/coder-studio.db",
    });

    prepareLocalStateStorage();

    expect(parseServerConfig).toHaveBeenCalledWith({
      appVersion: getCliVersion(import.meta.url),
      dataDir: "/tmp/cs-data/coder-studio.db",
      webRoot: "/tmp/web",
    });
  });

  it("starts the server when executed as the entrypoint", async () => {
    readCliConfig.mockReturnValue(null);
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");
    const stop = vi.fn().mockResolvedValue(undefined);
    createServer.mockResolvedValue({ stop });

    const processOnSpy = vi.spyOn(process, "on");
    const argvSpy = vi
      .spyOn(process, "argv", "get")
      .mockReturnValue(["node", fileURLToPath(import.meta.url)]);

    try {
      await runServerEntrypoint(import.meta.url, fileURLToPath(import.meta.url));
      expect(createServer).toHaveBeenCalledTimes(1);
      expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(processOnSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    } finally {
      argvSpy.mockRestore();
    }
  });

  it("starts the server when pm2 runs the bundle through ProcessContainerFork", async () => {
    readCliConfig.mockReturnValue(null);
    hasWebAssets.mockReturnValue(true);
    getStaticAssetsDir.mockReturnValue("/tmp/web");
    const stop = vi.fn().mockResolvedValue(undefined);
    createServer.mockResolvedValue({ stop });

    await runServerEntrypoint(
      import.meta.url,
      "/repo/node_modules/.pnpm/pm2@6.0.14/node_modules/pm2/lib/ProcessContainerFork.js"
    );

    expect(createServer).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported Node.js versions before creating the server", async () => {
    const originalVersions = process.versions;
    Object.defineProperty(process, "versions", {
      configurable: true,
      value: { ...process.versions, node: "22.4.0" },
    });

    try {
      await expect(
        runServerEntrypoint(import.meta.url, fileURLToPath(import.meta.url))
      ).rejects.toThrow(/requires Node\.js >=24\.0\.0/);
      expect(createServer).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "versions", {
        configurable: true,
        value: originalVersions,
      });
    }
  });
});
