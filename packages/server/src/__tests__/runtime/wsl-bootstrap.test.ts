import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SessionTokenRepo } from "../../auth/session-token-repo.js";
import {
  issueRemoteSessionBootstrap,
  resolveWslHostApiUrl,
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
      ["-d", "Ubuntu", "--", "sh", "-lc", expect.stringContaining("ip route show default")],
      expect.objectContaining({ windowsHide: true })
    );
    expect(result).toBe("http://172.29.224.1:4173");
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
      "--",
      "node",
      expect.stringContaining("wsl-runtime-entry.mjs"),
    ]);
    expect(spec.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP).toBeTypeOf("string");
    expect(spec.bootstrap.hostApiUrl).toBe("http://172.29.224.1:4173");
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
});
