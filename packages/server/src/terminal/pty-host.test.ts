/**
 * Tests for kill escalation helper
 *
 * Tests the polling-based SIGTERM -> SIGKILL escalation logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureNodePtySpawnHelperExecutable,
  ensureWslLocalNodePtyPackage,
  escalateKillWithPolling,
  killProcessGroup,
  NodePtyHost,
} from "./pty-host";

describe("kill escalation", () => {
  let mockProcessKill: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockProcessKill = vi.spyOn(process, "kill");
  });

  afterEach(() => {
    vi.useRealTimers();
    mockProcessKill.mockRestore();
  });

  describe("killProcessGroup", () => {
    it("should send signal to process group with negative PID", () => {
      mockProcessKill.mockReturnValue(true);

      const result = killProcessGroup(123, "SIGTERM");

      expect(result).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledWith(-123, "SIGTERM");
    });

    it("should fallback to regular kill if process group kill fails", () => {
      mockProcessKill.mockImplementationOnce(() => {
        throw new Error("Process group does not exist");
      });
      mockProcessKill.mockReturnValueOnce(true);

      const result = killProcessGroup(123, "SIGTERM");

      expect(result).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledTimes(2);
      expect(mockProcessKill).toHaveBeenNthCalledWith(1, -123, "SIGTERM");
      expect(mockProcessKill).toHaveBeenNthCalledWith(2, 123, "SIGTERM");
    });

    it("should return false if both process group and regular kill fail", () => {
      mockProcessKill.mockImplementation(() => {
        throw new Error("Process does not exist");
      });

      const result = killProcessGroup(123, "SIGTERM");

      expect(result).toBe(false);
      expect(mockProcessKill).toHaveBeenCalledTimes(2);
    });
  });

  describe("escalateKillWithPolling", () => {
    it("should immediately return if SIGTERM fails", async () => {
      mockProcessKill.mockImplementation(() => {
        throw new Error("Process does not exist");
      });

      const result = await escalateKillWithPolling(123, "SIGTERM");

      expect(result).toBe(false);
      expect(mockProcessKill).toHaveBeenCalledTimes(2);
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, "SIGTERM"],
        [123, "SIGTERM"],
      ]);
    });

    it("should stop if both process group and pid are already gone on immediate check", async () => {
      mockProcessKill
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group has exited");
        })
        .mockImplementationOnce(() => {
          throw new Error("Process has exited");
        });

      const result = await escalateKillWithPolling(123, "SIGTERM", {
        pollIntervalMs: 50,
        timeoutMs: 2000,
      });

      expect(result).toBe(true);
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, "SIGTERM"],
        [-123, 0],
        [123, 0],
      ]);
      expect(mockProcessKill).not.toHaveBeenCalledWith(-123, "SIGKILL");
      expect(mockProcessKill).not.toHaveBeenCalledWith(123, "SIGKILL");
    });

    it("should continue polling when process group is gone but pid is still alive", async () => {
      vi.useFakeTimers();

      mockProcessKill
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group does not exist");
        })
        .mockReturnValueOnce(true);

      const resultPromise = escalateKillWithPolling(123, "SIGTERM", {
        pollIntervalMs: 50,
        timeoutMs: 100,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe(true);
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, "SIGTERM"],
        [123, "SIGTERM"],
        [-123, 0],
        [123, 0],
        [-123, 0],
        [123, 0],
        [-123, 0],
        [123, 0],
        [-123, "SIGKILL"],
        [123, "SIGKILL"],
      ]);
    });

    it("should send SIGKILL if process survives timeout", async () => {
      vi.useFakeTimers();
      mockProcessKill.mockReturnValue(true);

      const resultPromise = escalateKillWithPolling(123, "SIGTERM", {
        pollIntervalMs: 50,
        timeoutMs: 250,
      });

      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledWith(-123, "SIGKILL");
    });

    it("should not escalate for non-SIGTERM signals", async () => {
      mockProcessKill.mockReturnValue(true);

      const result = await escalateKillWithPolling(123, "SIGKILL");

      expect(result).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledTimes(1);
      expect(mockProcessKill).toHaveBeenCalledWith(-123, "SIGKILL");
    });

    it("should use default polling parameters if not specified", async () => {
      mockProcessKill
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group exited");
        })
        .mockImplementationOnce(() => {
          throw new Error("Process exited");
        });

      const result = await escalateKillWithPolling(123, "SIGTERM");

      expect(result).toBe(true);
      expect(mockProcessKill).toHaveBeenCalledWith(-123, 0);
      expect(mockProcessKill).toHaveBeenCalledWith(123, 0);
    });

    it("should stop polling when process exits after one interval", async () => {
      vi.useFakeTimers();

      mockProcessKill
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockImplementationOnce(() => {
          throw new Error("Process group exited");
        })
        .mockImplementationOnce(() => {
          throw new Error("Process exited");
        });

      const resultPromise = escalateKillWithPolling(123, "SIGTERM", {
        pollIntervalMs: 50,
        timeoutMs: 2000,
      });

      await vi.advanceTimersByTimeAsync(50);
      const result = await resultPromise;

      expect(result).toBe(true);
      expect(mockProcessKill.mock.calls).toEqual([
        [-123, "SIGTERM"],
        [-123, 0],
        [-123, 0],
        [123, 0],
      ]);
      expect(mockProcessKill).not.toHaveBeenCalledWith(-123, "SIGKILL");
      expect(mockProcessKill).not.toHaveBeenCalledWith(123, "SIGKILL");
    });
  });
});

describe("ensureNodePtySpawnHelperExecutable", () => {
  it("adds execute permissions for the active darwin helper when needed", () => {
    const chmodSync = vi.fn();
    const resolve = vi.fn(() => "/tmp/node-pty/package.json");
    const existsSync = vi.fn((file: string) => file.includes("spawn-helper"));
    const statSync = vi.fn(() => ({ mode: 0o100644 }));

    ensureNodePtySpawnHelperExecutable({
      platform: "darwin",
      arch: "arm64",
      resolve,
      existsSync,
      statSync,
      chmodSync,
    });

    expect(chmodSync).toHaveBeenCalledTimes(1);
    expect(chmodSync).toHaveBeenCalledWith(
      "/tmp/node-pty/prebuilds/darwin-arm64/spawn-helper",
      0o100755
    );
  });

  it("does nothing outside darwin", () => {
    const chmodSync = vi.fn();

    ensureNodePtySpawnHelperExecutable({
      platform: "linux",
      resolve: vi.fn(),
      existsSync: vi.fn(),
      statSync: vi.fn(),
      chmodSync,
    });

    expect(chmodSync).not.toHaveBeenCalled();
  });

  it("does nothing when the active helper is already executable", () => {
    const chmodSync = vi.fn();

    ensureNodePtySpawnHelperExecutable({
      platform: "darwin",
      arch: "x64",
      resolve: vi.fn(() => "/tmp/node-pty/package.json"),
      existsSync: vi.fn(() => true),
      statSync: vi.fn(() => ({ mode: 0o100755 })),
      chmodSync,
    });

    expect(chmodSync).not.toHaveBeenCalled();
  });

  it("does nothing when the active helper is missing", () => {
    const chmodSync = vi.fn();

    expect(() =>
      ensureNodePtySpawnHelperExecutable({
        platform: "darwin",
        arch: "arm64",
        resolve: vi.fn(() => "/tmp/node-pty/package.json"),
        existsSync: vi.fn(() => false),
        statSync: vi.fn(),
        chmodSync,
      })
    ).not.toThrow();

    expect(chmodSync).not.toHaveBeenCalled();
  });

  it("swallows chmod failures so repair remains best-effort", () => {
    expect(() =>
      ensureNodePtySpawnHelperExecutable({
        platform: "darwin",
        arch: "arm64",
        resolve: vi.fn(() => "/tmp/node-pty/package.json"),
        existsSync: vi.fn(() => true),
        statSync: vi.fn(() => ({ mode: 0o100644 })),
        chmodSync: vi.fn(() => {
          throw Object.assign(new Error("read only"), { code: "EPERM" });
        }),
      })
    ).not.toThrow();
  });

  it("swallows stat races so repair does not block startup", () => {
    expect(() =>
      ensureNodePtySpawnHelperExecutable({
        platform: "darwin",
        arch: "arm64",
        resolve: vi.fn(() => "/tmp/node-pty/package.json"),
        existsSync: vi.fn(() => true),
        statSync: vi.fn(() => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }),
        chmodSync: vi.fn(),
      })
    ).not.toThrow();
  });
});

describe("ensureWslLocalNodePtyPackage", () => {
  const sourcePackageJsonPath = "/mnt/c/coder-studio/node_modules/node-pty/package.json";
  const addonPackageJsonPath = "/mnt/c/coder-studio/node_modules/node-addon-api/package.json";
  const stagingRoot = "/home/me/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty";
  const localPackageJsonPath = `${stagingRoot}/node_modules/node-pty/package.json`;
  const localNativeBinaryPath = `${stagingRoot}/node_modules/node-pty/build/Release/pty.node`;
  const stampFilePath = `${stagingRoot}/.coder-studio-node-pty-stamp`;
  const stampKey = "1.1.0|127|x64";

  it("returns undefined when the WSL-local node-pty env is not configured", () => {
    expect(
      ensureWslLocalNodePtyPackage({
        env: {},
        spawnSync: vi.fn(),
      })
    ).toBeUndefined();
  });

  it("reuses a prepared WSL-local node-pty package when the stamp matches", () => {
    const existsSync = vi.fn((file: string) =>
      [
        sourcePackageJsonPath,
        addonPackageJsonPath,
        localPackageJsonPath,
        localNativeBinaryPath,
        stampFilePath,
      ].includes(file)
    );
    const readFileSync = vi.fn((file: string) => {
      if (file === sourcePackageJsonPath) {
        return JSON.stringify({ version: "1.1.0" });
      }
      if (file === stampFilePath) {
        return stampKey;
      }
      throw new Error(`Unexpected read: ${file}`);
    });
    const spawnSync = vi.fn();

    expect(
      ensureWslLocalNodePtyPackage({
        env: {
          HOME: "/home/me",
          CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON: sourcePackageJsonPath,
          CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON: addonPackageJsonPath,
          CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT:
            "~/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty",
        },
        nodeAbi: "127",
        arch: "x64",
        existsSync,
        readFileSync,
        spawnSync,
      })
    ).toBe(localPackageJsonPath);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("installs a fresh WSL-local node-pty package when the prepared copy is missing", () => {
    let installed = false;
    const existsSync = vi.fn((file: string) => {
      if (file === sourcePackageJsonPath || file === addonPackageJsonPath) {
        return true;
      }

      if (!installed) {
        return false;
      }

      return [localPackageJsonPath, localNativeBinaryPath].includes(file);
    });
    const readFileSync = vi.fn((file: string) => {
      if (file === sourcePackageJsonPath) {
        return JSON.stringify({ version: "1.1.0" });
      }
      throw new Error(`Unexpected read: ${file}`);
    });
    const writeFileSync = vi.fn();
    const mkdirSync = vi.fn();
    const rmSync = vi.fn();
    const spawnSync = vi.fn(() => {
      installed = true;
      return {
        status: 0,
        stdout: "",
        stderr: "",
      };
    });

    expect(
      ensureWslLocalNodePtyPackage({
        env: {
          HOME: "/home/me",
          CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON: sourcePackageJsonPath,
          CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON: addonPackageJsonPath,
          CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT:
            "~/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty",
        },
        nodeAbi: "127",
        arch: "x64",
        existsSync,
        readFileSync,
        writeFileSync,
        mkdirSync,
        rmSync,
        spawnSync,
      })
    ).toBe(localPackageJsonPath);

    expect(rmSync).toHaveBeenCalledWith(stagingRoot, { recursive: true, force: true });
    expect(mkdirSync).toHaveBeenCalledWith(stagingRoot, { recursive: true });
    expect(writeFileSync).toHaveBeenCalledWith(
      `${stagingRoot}/package.json`,
      expect.stringContaining('"node-pty": "file:/mnt/c/coder-studio/node_modules/node-pty"')
    );
    expect(writeFileSync).toHaveBeenCalledWith(stampFilePath, stampKey);
    expect(spawnSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(["install", "--no-package-lock", "--omit=dev"]),
      expect.objectContaining({
        cwd: stagingRoot,
        encoding: "utf8",
        env: expect.objectContaining({
          npm_config_build_from_source: "true",
          npm_config_audit: "false",
          npm_config_fund: "false",
        }),
      })
    );
  });
});

describe("NodePtyHost", () => {
  it("prefers the prepared WSL-local node-pty package when configured", () => {
    const spawn = vi.fn(() => ({
      pid: 321,
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }));
    const localRequire = vi.fn((id: string) => {
      if (
        id !== "/home/me/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty/node_modules/node-pty"
      ) {
        throw new Error(`Unexpected require: ${id}`);
      }

      return {
        spawn,
      };
    });

    const host = new NodePtyHost({
      ensureWslLocalNodePtyPackage: vi.fn(
        () =>
          "/home/me/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty/node_modules/node-pty/package.json"
      ),
      createRequire: vi.fn(() => localRequire),
      defaultRequire: vi.fn(),
    });

    host.spawn(["bash"], {
      cwd: "/home/me/app",
      env: {},
      cols: 120,
      rows: 30,
    });

    expect(localRequire).toHaveBeenCalledWith(
      "/home/me/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty/node_modules/node-pty"
    );
    expect(spawn).toHaveBeenCalledWith("bash", [], {
      cwd: "/home/me/app",
      env: {},
      cols: 120,
      rows: 30,
    });
  });
});
