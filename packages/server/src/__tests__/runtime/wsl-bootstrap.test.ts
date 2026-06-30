import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { SessionTokenRepo } from "../../auth/session-token-repo.js";
import {
  issueRemoteSessionBootstrap,
  probeWslDistroIp,
  resolveWslHostApiUrl,
  resolveWslRuntimeConnectHost,
  resolveWslRuntimeEntryPath,
  resolveWslRuntimeLaunchSpec,
  resolveWslRuntimeStateRoot,
  serializeWslRuntimeBootstrap,
} from "../../runtime/wsl-bootstrap.js";

describe("resolveWslHostApiUrl", () => {
  it("prefers an explicit override before probing WSL", async () => {
    const runCommand = vi.fn();

    const result = await resolveWslHostApiUrl({
      configuredUrl: "http://10.0.0.5:9000/",
      boundHost: "127.0.0.1",
      port: 4173,
      wslDistro: "Ubuntu",
      runCommand,
    });

    expect(result).toBe("http://10.0.0.5:9000");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reuses a non-loopback bound host when one is already configured", async () => {
    const runCommand = vi.fn();

    const result = await resolveWslHostApiUrl({
      boundHost: "192.168.1.50",
      port: 4173,
      wslDistro: "Ubuntu",
      runCommand,
    });

    expect(result).toBe("http://192.168.1.50:4173");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("probes the distro for a reachable Windows host IP when only loopback is bound", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "172.29.224.1\n",
      stderr: "",
    }));

    const result = await resolveWslHostApiUrl({
      boundHost: "localhost",
      port: 4173,
      wslDistro: "Ubuntu",
      runCommand,
    });

    expect(runCommand).toHaveBeenCalledWith(
      "wsl.exe",
      [
        "-d",
        "Ubuntu",
        "--cd",
        "/",
        "-e",
        "sh",
        "-c",
        expect.stringContaining("ip route show default"),
      ],
      expect.objectContaining({ windowsHide: true, cwd: process.cwd() })
    );
    expect(result).toBe("http://172.29.224.1:4173");
  });

  it("probes WSL from a host-safe cwd when the server is started from a WSL share path", async () => {
    const originalCwd = process.cwd;
    const runCommand = vi.fn(async () => ({
      stdout: "172.29.224.1\n",
      stderr: "",
    }));
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\spencer\\AppData\\Local");
    process.cwd = () => "\\\\wsl$\\Ubuntu-24.04\\home\\spencer\\workspace\\coder-studio";

    try {
      const result = await resolveWslHostApiUrl({
        boundHost: "localhost",
        port: 4173,
        wslDistro: "Ubuntu",
        runCommand,
      });

      expect(runCommand).toHaveBeenCalledWith(
        "wsl.exe",
        [
          "-d",
          "Ubuntu",
          "--cd",
          "/",
          "-e",
          "sh",
          "-c",
          expect.stringContaining("ip route show default"),
        ],
        expect.objectContaining({
          windowsHide: true,
          cwd: "C:\\Users\\spencer\\AppData\\Local\\Temp",
        })
      );
      expect(result).toBe("http://172.29.224.1:4173");
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("issues remote-runtime session bootstrap records with runtime-scoped tokens", () => {
    const sessionTokenRepo = new SessionTokenRepo();

    const bootstrap = issueRemoteSessionBootstrap({
      sessionTokenRepo,
      workspaceId: "ws-1",
      providerId: "claude",
      runtimeId: "wsl:ws-1",
      callbackApiUrl: "http://172.29.224.1:4173",
      sessionIdFactory: () => "sess_bootstrap",
      ttlMs: 60_000,
    });

    expect(bootstrap).toEqual({
      sessionId: "sess_bootstrap",
      sessionToken: expect.stringMatching(/^[a-f0-9]{64}$/),
      apiUrl: "http://172.29.224.1:4173",
    });
    expect(sessionTokenRepo.get(bootstrap.sessionToken)).toMatchObject({
      sessionId: "sess_bootstrap",
      workspaceId: "ws-1",
      providerId: "claude",
      mode: "remote_runtime",
      runtimeId: "wsl:ws-1",
    });
  });
});

describe("resolveWslRuntimeConnectHost", () => {
  it("returns the ready host unchanged on non-Windows platforms", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });

    try {
      const runCommand = vi.fn();
      await expect(
        resolveWslRuntimeConnectHost("127.0.0.1", "Ubuntu-24.04", runCommand)
      ).resolves.toBe("127.0.0.1");
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("probes the distro IP on Windows when the ready host is loopback", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    const runCommand = vi.fn(async () => ({
      stdout: "172.17.21.22\n",
      stderr: "",
    }));

    try {
      await expect(
        resolveWslRuntimeConnectHost("127.0.0.1", "Ubuntu-24.04", runCommand)
      ).resolves.toBe("172.17.21.22");
      expect(runCommand).toHaveBeenCalledWith(
        "wsl.exe",
        ["-d", "Ubuntu-24.04", "-e", "hostname", "-I"],
        expect.objectContaining({ windowsHide: true })
      );
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("falls back to the ready host when the distro IP probe fails", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    const runCommand = vi.fn(async () => ({
      stdout: "",
      stderr: "",
    }));

    try {
      await expect(
        resolveWslRuntimeConnectHost("localhost", "Ubuntu-24.04", runCommand)
      ).resolves.toBe("localhost");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

describe("probeWslDistroIp", () => {
  it("returns the first address from hostname -I", async () => {
    const runCommand = vi.fn(async () => ({
      stdout: "172.17.21.22 fe80::1\n",
      stderr: "",
    }));

    await expect(probeWslDistroIp("Ubuntu-24.04", runCommand)).resolves.toBe("172.17.21.22");
  });
});

describe("WSL runtime bootstrap", () => {
  it("stores runtime-owned state inside the distro home and serializes bootstrap payloads", () => {
    expect(resolveWslRuntimeStateRoot("wsl:ws-1")).toBe("~/.coder-studio/runtimes/wsl_ws-1");

    const serialized = serializeWslRuntimeBootstrap({
      runtimeId: "wsl:ws-1",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
      },
      stateRoot: "~/.coder-studio/runtimes/wsl_ws-1",
      settings: { "lsp.mode": "off" },
      workspaces: [{ id: "ws-1", path: "/home/me/app", targetRuntime: "wsl", wslDistro: "Ubuntu" }],
      customProviders: [],
    });

    expect(JSON.parse(serialized)).toMatchObject({
      runtimeId: "wsl:ws-1",
      workspace: { id: "ws-1", path: "/home/me/app" },
      settings: { "lsp.mode": "off" },
    });
  });

  it("builds a WSL launch spec for the bundled runtime entry", async () => {
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-test");
    mkdirSync(join(tempRoot, "packages", "cli", "dist", "esm"), { recursive: true });
    const entryPath = join(tempRoot, "packages", "cli", "dist", "esm", "wsl-runtime-entry.mjs");
    writeFileSync(entryPath, "export {};\n");

    const spec = await resolveWslRuntimeLaunchSpec({
      runtimeId: "wsl:ws-1",
      stateRoot: join(tempRoot, "state-root"),
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      settingsSnapshot: {
        "lsp.mode": "off",
      },
      workspaceSnapshot: [
        {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
      customProviderConfigs: [],
      runtimeEntryPathResolver: () => entryPath,
      hostApiUrl: "http://172.29.224.1:4173",
    });

    expect(spec.command).toBe("wsl.exe");
    expect(spec.args).toEqual([
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/home/me/app",
      "-e",
      "sh",
      "-c",
      expect.stringContaining('exec "$NODE" "$ENTRY"'),
      "sh",
      expect.stringContaining("wsl-runtime-entry.mjs"),
    ]);
    expect(spec.cwd).toBe(process.cwd());
    expect(spec.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP).toBeTypeOf("string");
    expect(spec.env.WSLENV).toContain("CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP/u");
    expect(spec.bootstrap.hostApiUrl).toBe("http://172.29.224.1:4173");
  });

  it("uses the managed node path when the broker provides one", async () => {
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-managed-node-test");
    mkdirSync(join(tempRoot, "packages", "cli", "dist", "esm"), { recursive: true });
    const entryPath = join(tempRoot, "packages", "cli", "dist", "esm", "wsl-runtime-entry.mjs");
    writeFileSync(entryPath, "export {};\n");

    const spec = await resolveWslRuntimeLaunchSpec({
      runtimeId: "wsl:distro:Ubuntu-24.04",
      stateRoot: join(tempRoot, "state-root"),
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      settingsSnapshot: {},
      workspaceSnapshot: [],
      customProviderConfigs: [],
      runtimeEntryPathResolver: () => entryPath,
      nodePath: "/home/me/.coder-studio/node/20.11.1/bin/node",
    });

    expect(spec.args).toEqual([
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/home/me/app",
      "-e",
      "sh",
      "-c",
      expect.stringContaining('exec "/home/me/.coder-studio/node/20.11.1/bin/node" "$ENTRY"'),
      "sh",
      expect.stringContaining("wsl-runtime-entry.mjs"),
    ]);
  });

  it("passes WSL-local node-pty staging hints to the child runtime", async () => {
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-native-deps-test");
    mkdirSync(join(tempRoot, "packages", "cli", "dist", "esm"), { recursive: true });
    const entryPath = join(tempRoot, "packages", "cli", "dist", "esm", "wsl-runtime-entry.mjs");
    writeFileSync(entryPath, "export {};\n");

    const spec = await resolveWslRuntimeLaunchSpec({
      runtimeId: "wsl:ws-1",
      stateRoot: join(tempRoot, "state-root"),
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      settingsSnapshot: {},
      workspaceSnapshot: [],
      customProviderConfigs: [],
      runtimeEntryPathResolver: () => entryPath,
    });

    expect(spec.env.CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON).toContain(
      "node-pty/package.json"
    );
    expect(spec.env.CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON).toContain(
      "node-addon-api/package.json"
    );
    expect(spec.env.CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT).toBe(
      "~/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty"
    );
    expect(spec.env.WSLENV).toContain("CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON/u");
    expect(spec.env.WSLENV).toContain("CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON/u");
    expect(spec.env.WSLENV).toContain("CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT/u");
  });

  it("launches wsl.exe from a safe Windows cwd instead of inheriting the workspace path", async () => {
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-safe-cwd-test");
    mkdirSync(join(tempRoot, "packages", "cli", "dist", "esm"), { recursive: true });
    const entryPath = join(tempRoot, "packages", "cli", "dist", "esm", "wsl-runtime-entry.mjs");
    writeFileSync(entryPath, "export {};\n");

    const spec = await resolveWslRuntimeLaunchSpec({
      runtimeId: "wsl:ws-1",
      stateRoot: join(tempRoot, "state-root"),
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      settingsSnapshot: {},
      workspaceSnapshot: [],
      customProviderConfigs: [],
      runtimeEntryPathResolver: () => entryPath,
    });

    expect(spec.args).toEqual([
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/home/me/app",
      "-e",
      "sh",
      "-c",
      expect.stringContaining('exec "$NODE" "$ENTRY"'),
      "sh",
      expect.stringContaining("wsl-runtime-entry.mjs"),
    ]);
    expect(spec.cwd).toBe(process.cwd());
    expect(spec.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP).toBeTypeOf("string");
  });

  it("falls back to a host-safe cwd when the server is started from a WSL path", async () => {
    const originalCwd = process.cwd;
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-host-cwd-test");
    mkdirSync(join(tempRoot, "packages", "cli", "dist", "esm"), { recursive: true });
    const entryPath = join(tempRoot, "packages", "cli", "dist", "esm", "wsl-runtime-entry.mjs");
    writeFileSync(entryPath, "export {};\n");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\spencer\\AppData\\Local");
    process.cwd = () => "\\\\wsl$\\Ubuntu-24.04\\home\\spencer\\workspace\\coder-studio";

    try {
      const spec = await resolveWslRuntimeLaunchSpec({
        runtimeId: "wsl:ws-1",
        stateRoot: join(tempRoot, "state-root"),
        workspace: {
          id: "ws-1",
          path: "/home/spencer/workspace/my app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: {
            leftPanelWidth: 250,
            bottomPanelHeight: 200,
            focusMode: false,
          },
        },
        settingsSnapshot: {},
        workspaceSnapshot: [],
        customProviderConfigs: [],
        runtimeEntryPathResolver: () => entryPath,
      });

      expect(spec.args).toEqual([
        "-d",
        "Ubuntu-24.04",
        "--cd",
        "/home/spencer/workspace/my app",
        "-e",
        "sh",
        "-c",
        expect.stringContaining('exec "$NODE" "$ENTRY"'),
        "sh",
        expect.stringContaining("wsl-runtime-entry.mjs"),
      ]);
      expect(spec.cwd).toBe("C:\\Users\\spencer\\AppData\\Local\\Temp");
    } finally {
      process.cwd = originalCwd;
    }
  });

  it("fails early when the WSL runtime entrypoint cannot be resolved", async () => {
    await expect(
      resolveWslRuntimeLaunchSpec({
        runtimeId: "wsl:ws-1",
        stateRoot: "/tmp/state-root",
        workspace: {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: {
            leftPanelWidth: 250,
            bottomPanelHeight: 200,
            focusMode: false,
          },
        },
        settingsSnapshot: {},
        workspaceSnapshot: [],
        customProviderConfigs: [],
        runtimeEntryPathResolver: () => "/tmp/missing-wsl-entry.mjs",
      })
    ).rejects.toThrow("Unable to resolve Coder Studio WSL runtime entry");

    expect(existsSync("/tmp/missing-wsl-entry.mjs")).toBe(false);
  });

  it("does not treat TypeScript source entries as launchable runtime entrypoints", () => {
    const tempRoot = join(process.cwd(), ".tmp-wsl-bootstrap-source-entry-test");
    mkdirSync(join(tempRoot, "packages", "cli", "src"), { recursive: true });
    const sourceEntryPath = join(tempRoot, "packages", "cli", "src", "wsl-runtime-entry.ts");
    writeFileSync(sourceEntryPath, "export {};\n");

    expect(() =>
      resolveWslRuntimeEntryPath(
        pathToFileURL(join(tempRoot, "packages", "server", "src", "runtime", "wsl-bootstrap.ts"))
          .href
      )
    ).toThrow("Unable to resolve Coder Studio WSL runtime entry");
  });
});
