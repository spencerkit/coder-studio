import { EventEmitter } from "node:events";
import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { LspSession } from "./session.js";

function createSpawnedChildMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: null;
    stdout: null;
    stderr: null;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = null;
  child.stdout = null;
  child.stderr = null;
  child.kill = vi.fn();
  return child;
}

function createSpawnedChildWithStreams() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

describe("LspSession Windows launch", () => {
  it("routes managed Vue cmd shims through a shell on Windows", async () => {
    const spawnProcess = vi.fn(() => createSpawnedChildMock());
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: "C:\\repo",
      spec: {
        serverKind: "vue",
        command: "C:\\tools\\vue-language-server.cmd",
        args: ["--stdio"],
        rootPath: "C:\\repo",
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 1000,
      platform: "win32",
      spawnProcess,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await expect(session.start()).rejects.toThrow("Failed to start LSP process stdio");
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\tools\\vue-language-server.cmd",
      ["--stdio"],
      expect.objectContaining({
        cwd: "C:\\repo",
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        windowsHide: true,
      })
    );
  });

  it("spawns the companion typescript server alongside Volar when a companion spec is present", async () => {
    const spawnProcess = vi.fn(() => createSpawnedChildWithStreams());
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: "C:\\repo",
      spec: {
        serverKind: "vue",
        command: "C:\\tools\\vue-language-server.cmd",
        args: ["--stdio"],
        rootPath: "C:\\repo",
        companion: {
          command: "C:\\node\\node.exe",
          args: ["C:\\tools\\typescript-language-server\\lib\\cli.mjs", "--stdio"],
          initializationOptions: {
            plugins: [
              {
                name: "@vue/typescript-plugin",
                location: "C:\\tools\\@vue\\language-server",
                languages: ["vue"],
              },
            ],
          },
        },
        bridges: { tsserverRequest: true },
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 100,
      platform: "win32",
      spawnProcess,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    // Both children get spawned with working pipes; neither will respond to
    // `initialize`, so `start` rejects via the request timeout. The point of
    // the test is that *both* spawn calls happened and the companion used the
    // node + stdio launch shape.
    await expect(session.start()).rejects.toThrow();
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      "C:\\tools\\vue-language-server.cmd",
      ["--stdio"],
      expect.objectContaining({ shell: true, cwd: "C:\\repo" })
    );
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      "C:\\node\\node.exe",
      ["C:\\tools\\typescript-language-server\\lib\\cli.mjs", "--stdio"],
      expect.objectContaining({ cwd: "C:\\repo", stdio: ["pipe", "pipe", "pipe"] })
    );

    await session.stop();
  });
});
