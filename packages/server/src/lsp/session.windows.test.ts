import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { LspSession } from "./session.js";

function createSpawnedChildMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: null;
    stdout: null;
    stderr: null;
  };
  child.stdin = null;
  child.stdout = null;
  child.stderr = null;
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
});
