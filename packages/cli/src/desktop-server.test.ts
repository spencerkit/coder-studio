import { afterEach, describe, expect, it, vi } from "vitest";

const { startServer } = vi.hoisted(() => ({
  startServer: vi.fn(),
}));

const { resolveCliPackageRoot } = vi.hoisted(() => ({
  resolveCliPackageRoot: vi.fn(() => "/repo/packages/cli"),
}));

const { buildWslRuntimeSource } = vi.hoisted(() => ({
  buildWslRuntimeSource: vi.fn(({ runtimeVersion, packageRoot, entryRelativePath }) => ({
    runtimeVersion,
    packageRoot,
    entryPath: `${packageRoot}/${entryRelativePath ?? "dist/wsl-runtime-entry.mjs"}`,
  })),
}));

const wslRuntimeSourceMatcher = {
  source: expect.objectContaining({
    runtimeVersion: expect.any(String),
    entryPath: expect.stringContaining("wsl-runtime-entry"),
  }),
};

vi.mock("@coder-studio/runtime", () => ({
  buildWslRuntimeSource,
}));

vi.mock("./server-runner.js", () => ({
  startServer,
  resolveCliPackageRoot,
}));

import { main, parseDesktopServerEnv } from "./desktop-server.js";

describe("desktop-server", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("parses desktop-specific host, port, state-dir, and runtime-json overrides", () => {
    expect(
      parseDesktopServerEnv({
        CODER_STUDIO_DESKTOP_HOST: "0.0.0.0",
        CODER_STUDIO_DESKTOP_PORT: "0",
        CODER_STUDIO_DESKTOP_STATE_DIR: "/tmp/cs-state",
        CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
        CODER_STUDIO_DESKTOP_PASSWORD: "sekrit",
      })
    ).toEqual({
      host: "0.0.0.0",
      port: 0,
      stateDir: "/tmp/cs-state",
      runtimeJsonPath: "/tmp/runtime.json",
      password: "sekrit",
    });
  });

  it("starts the server with explicit runtime-config writing enabled", async () => {
    startServer.mockResolvedValue({ stop: vi.fn() });

    await main({
      CODER_STUDIO_DESKTOP_PORT: "0",
      CODER_STUDIO_DESKTOP_RUNTIME_JSON_PATH: "/tmp/runtime.json",
    });

    expect(startServer).toHaveBeenCalledWith({
      serverConfig: {
        port: 0,
        wslRuntime: wslRuntimeSourceMatcher,
      },
      writeRuntimeConfig: true,
      runtimeJsonPath: "/tmp/runtime.json",
    });
  });
});
