import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  callCoderStudioCommand,
  clearAuthBlockByIp,
  confirmYesNo,
  getServerStatus,
  isInteractiveSession,
  listAuthBlocks,
  openBrowser,
  prepareLocalStateStorage,
  readCliConfig,
  startManagedServer,
  startServer,
  stopRunningServer,
  writeCliConfig,
} = vi.hoisted(() => ({
  callCoderStudioCommand: vi.fn(),
  clearAuthBlockByIp: vi.fn(),
  confirmYesNo: vi.fn(),
  getServerStatus: vi.fn(),
  isInteractiveSession: vi.fn(),
  listAuthBlocks: vi.fn(),
  openBrowser: vi.fn(),
  prepareLocalStateStorage: vi.fn(),
  readCliConfig: vi.fn(),
  startManagedServer: vi.fn(),
  startServer: vi.fn(),
  stopRunningServer: vi.fn(),
  writeCliConfig: vi.fn(),
}));

vi.mock("./config-store.js", () => ({
  readCliConfig,
  writeCliConfig,
}));

vi.mock("./pm2-control.js", () => ({
  startManagedServer,
}));

vi.mock("./server-control.js", () => ({
  getServerStatus,
  stopRunningServer,
}));

vi.mock("./auth-control.js", () => ({
  clearAuthBlockByIp,
  listAuthBlocks,
}));

vi.mock("./server-runner.js", () => ({
  prepareLocalStateStorage,
  startServer,
}));

vi.mock("./prompts.js", () => ({
  confirmYesNo,
  isInteractiveSession,
}));

vi.mock("./browser.js", () => ({
  openBrowser,
}));

vi.mock("./automation-command-client.js", () => ({
  callCoderStudioCommand,
}));

import { main } from "./cli";
import { parseArgs, RUNTIME_CONFIG_ERROR } from "./parse-args";

beforeEach(() => {
  readCliConfig.mockReturnValue(null);
  writeCliConfig.mockImplementation(() => undefined);
  startManagedServer.mockResolvedValue(undefined);
  startServer.mockResolvedValue({ stop: vi.fn() });
  prepareLocalStateStorage.mockImplementation(() => undefined);
  stopRunningServer.mockResolvedValue(false);
  clearAuthBlockByIp.mockResolvedValue(false);
  listAuthBlocks.mockResolvedValue([]);
  confirmYesNo.mockResolvedValue(false);
  isInteractiveSession.mockReturnValue(true);
  openBrowser.mockResolvedValue(undefined);
  callCoderStudioCommand.mockResolvedValue({ ok: true });
  getServerStatus.mockResolvedValue({
    status: "stopped",
    pid: null,
    host: null,
    port: null,
    restartCount: 0,
    outFile: "/tmp/server.out.log",
    errFile: "/tmp/server.err.log",
    startedAt: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("main", () => {
  it("runs the foreground runner when serve --foreground is provided", async () => {
    await main(["serve", "--foreground"]);

    expect(startServer).toHaveBeenCalledTimes(1);
    expect(startManagedServer).not.toHaveBeenCalled();
  });

  it("does not start foreground mode when restart is declined for an existing server", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 1,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    confirmYesNo.mockResolvedValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve", "--foreground"]);

    expect(confirmYesNo).toHaveBeenCalledWith(
      "Coder Studio is already running at http://127.0.0.1:4187. Restart it? [y/N] "
    );
    expect(startServer).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "Leaving the existing Coder Studio server running at http://127.0.0.1:4187."
    );
  });

  it("restarts the managed server before starting foreground mode with --restart", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 1,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve", "--foreground", "--restart"]);

    expect(confirmYesNo).not.toHaveBeenCalled();
    expect(stopRunningServer).toHaveBeenCalledTimes(1);
    expect(startServer).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Restarting the managed Coder Studio server...");
    expect(logSpy).toHaveBeenCalledWith("Starting Coder Studio Server in foreground...");
  });

  it("starts pm2-managed mode for bare serve", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve"]);

    expect(startManagedServer).toHaveBeenCalledWith({
      script: expect.stringMatching(/server-runner\.(ts|js|mjs)$/),
      cwd: process.cwd(),
      waitMs: 5000,
    });
    expect(logSpy).toHaveBeenCalledWith("Coder Studio server started in background.");
    expect(logSpy).toHaveBeenCalledWith("Run `coder-studio status` to inspect the server.");
  });

  it("prepares local state storage before managed startup", async () => {
    await main(["serve"]);

    expect(prepareLocalStateStorage).toHaveBeenCalledTimes(1);
    expect(startManagedServer).toHaveBeenCalledTimes(1);
    const prepareOrder = prepareLocalStateStorage.mock.invocationCallOrder[0];
    const startOrder = startManagedServer.mock.invocationCallOrder[0];
    expect(prepareOrder).toBeDefined();
    expect(startOrder).toBeDefined();
    expect(prepareOrder ?? Number.POSITIVE_INFINITY).toBeLessThan(
      startOrder ?? Number.POSITIVE_INFINITY
    );
  });

  it("prints status output for status command", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "0.0.0.0",
      port: 4187,
      restartCount: 2,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["status"]);

    const output = logSpy.mock.calls[0]?.[0];
    expect(output).toContain("Status: running");
    expect(output).toContain("Port: 4187");
    expect(output).toContain("Listen host: 0.0.0.0");
    expect(output).toContain("Listen IP: 0.0.0.0");
    expect(output).toContain("Local URL: http://127.0.0.1:4187");
  });

  it("prints combined log output for logs command", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "cs-cli-logs-"));
    const outFile = join(logDir, "server.out.log");
    const errFile = join(logDir, "server.err.log");
    writeFileSync(outFile, "out line\n", "utf-8");
    writeFileSync(errFile, "err line\n", "utf-8");
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 2,
      outFile,
      errFile,
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["logs"]);
      expect(logSpy).toHaveBeenCalledWith("out line\nerr line");
    } finally {
      if (existsSync(logDir)) {
        rmSync(logDir, { recursive: true, force: true });
      }
    }
  });

  it("prints only the recent tail for logs command", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "cs-cli-logs-tail-"));
    const outFile = join(logDir, "server.out.log");
    const errFile = join(logDir, "server.err.log");
    const outLines = Array.from({ length: 45 }, (_, index) => `out line ${index + 1}`);
    const errLines = ["err line 1", "err line 2"];
    writeFileSync(outFile, `${outLines.join("\n")}\n`, "utf-8");
    writeFileSync(errFile, `${errLines.join("\n")}\n`, "utf-8");
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 2,
      outFile,
      errFile,
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["logs"]);
      expect(logSpy).toHaveBeenCalledWith(
        `${outLines.slice(-40).join("\n")}\n${errLines.join("\n")}`
      );
    } finally {
      if (existsSync(logDir)) {
        rmSync(logDir, { recursive: true, force: true });
      }
    }
  });

  it("prints only the requested error log tail for logs command", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "cs-cli-logs-errors-"));
    const outFile = join(logDir, "server.out.log");
    const errFile = join(logDir, "server.err.log");
    writeFileSync(outFile, "out line 1\nout line 2\n", "utf-8");
    writeFileSync(errFile, "err line 1\nerr line 2\n", "utf-8");
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 2,
      outFile,
      errFile,
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await main(["logs", "--errors-only", "--tail", "1"]);
      expect(logSpy).toHaveBeenCalledWith("err line 2");
    } finally {
      if (existsSync(logDir)) {
        rmSync(logDir, { recursive: true, force: true });
      }
    }
  });

  it("prints stop output for stop command", async () => {
    stopRunningServer.mockResolvedValue(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["stop"]);

    expect(logSpy).toHaveBeenCalledWith("Stopped Coder Studio server.");
  });

  it("parses server alias through main as a normal background start", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["server"]);

    expect(startManagedServer).toHaveBeenCalledWith({
      script: expect.stringMatching(/server-runner\.(ts|js|mjs)$/),
      cwd: process.cwd(),
      waitMs: 5000,
    });
    expect(logSpy).toHaveBeenCalledWith("Coder Studio server started in background.");
  });

  it("prompts before restarting an existing background server", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 1,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    confirmYesNo.mockResolvedValue(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve"]);

    expect(confirmYesNo).toHaveBeenCalledWith(
      "Coder Studio is already running at http://127.0.0.1:4187. Restart it? [y/N] "
    );
    expect(startManagedServer).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Restarting the managed Coder Studio server...");
  });

  it("restarts immediately with --restart without prompting", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 1,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve", "--restart"]);

    expect(confirmYesNo).not.toHaveBeenCalled();
    expect(startManagedServer).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Restarting the managed Coder Studio server...");
  });

  it("keeps the current server when restart is declined", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 1,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    confirmYesNo.mockResolvedValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve"]);

    expect(startManagedServer).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "Leaving the existing Coder Studio server running at http://127.0.0.1:4187."
    );
  });

  it("starts the managed server for open and opens the browser", async () => {
    getServerStatus
      .mockResolvedValueOnce({
        status: "stopped",
        pid: null,
        host: null,
        port: null,
        restartCount: 0,
        outFile: "/tmp/server.out.log",
        errFile: "/tmp/server.err.log",
        startedAt: null,
      })
      .mockResolvedValueOnce({
        status: "running",
        pid: 424242,
        host: "127.0.0.1",
        port: 4187,
        restartCount: 0,
        outFile: "/tmp/server.out.log",
        errFile: "/tmp/server.err.log",
        startedAt: 1000,
      });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["open"]);

    expect(startManagedServer).toHaveBeenCalledTimes(1);
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4187");
    expect(logSpy).toHaveBeenCalledWith(
      "Opening Coder Studio in your browser: http://127.0.0.1:4187"
    );
  });

  it("opens the current service from open when restart is declined", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "0.0.0.0",
      port: 4187,
      restartCount: 0,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    confirmYesNo.mockResolvedValue(false);

    await main(["open"]);

    expect(startManagedServer).not.toHaveBeenCalled();
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4187");
  });

  it("restarts immediately for open --restart and then opens the browser", async () => {
    getServerStatus
      .mockResolvedValueOnce({
        status: "running",
        pid: 424242,
        host: "127.0.0.1",
        port: 4187,
        restartCount: 0,
        outFile: "/tmp/server.out.log",
        errFile: "/tmp/server.err.log",
        startedAt: 1000,
      })
      .mockResolvedValueOnce({
        status: "running",
        pid: 434343,
        host: "127.0.0.1",
        port: 4190,
        restartCount: 0,
        outFile: "/tmp/server.out.log",
        errFile: "/tmp/server.err.log",
        startedAt: 2000,
      });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["open", "--restart"]);

    expect(confirmYesNo).not.toHaveBeenCalled();
    expect(startManagedServer).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("Restarting the managed Coder Studio server...");
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4190");
  });

  it("rethrows background startup failures for open and does not open the browser", async () => {
    const startupError = new Error(
      "Coder Studio failed to start in background: the managed process entered the errored state.\n\nRecent error log excerpt (/tmp/server.err.log):\nError: listen EADDRINUSE: address already in use 127.0.0.1:4187\n\nRun `coder-studio logs` for details or `coder-studio serve --foreground` for interactive debugging."
    );
    startManagedServer.mockRejectedValueOnce(startupError);

    await expect(main(["open"])).rejects.toThrow(
      "Error: listen EADDRINUSE: address already in use 127.0.0.1:4187"
    );
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("does not restart in non-interactive mode and prints a clear message", async () => {
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 424242,
      host: "127.0.0.1",
      port: 4187,
      restartCount: 0,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1000,
    });
    isInteractiveSession.mockReturnValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["serve"]);

    expect(confirmYesNo).not.toHaveBeenCalled();
    expect(startManagedServer).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "Coder Studio is already running at http://127.0.0.1:4187. Service already exists and was not restarted."
    );
  });

  it("drops an ephemeral port when config updates rewrite saved settings", async () => {
    readCliConfig.mockReturnValue({
      host: "0.0.0.0",
      port: 0,
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });

    await main(["config", "--host", "127.0.0.1"]);

    expect(writeCliConfig).toHaveBeenCalledWith({
      host: "127.0.0.1",
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });
  });

  it("rejects unsupported Node.js versions before dispatching commands", async () => {
    const originalVersions = process.versions;
    Object.defineProperty(process, "versions", {
      configurable: true,
      value: { ...process.versions, node: "22.4.0" },
    });

    try {
      await expect(main(["status"])).rejects.toThrow(/requires Node\.js >=24\.0\.0/);
      expect(getServerStatus).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "versions", {
        configurable: true,
        value: originalVersions,
      });
    }
  });

  it("prints the current auth block list", async () => {
    listAuthBlocks.mockResolvedValue([
      {
        ip: "198.51.100.24",
        failedCount: 10,
        firstFailedAt: 1000,
        lastFailedAt: 2000,
        blockedUntil: 3000,
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["auth", "ban-list"]);

    expect(listAuthBlocks).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("198.51.100.24"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("blockedUntil"));
  });

  it("unblocks the given IP from local auth storage", async () => {
    clearAuthBlockByIp.mockResolvedValue(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["auth", "unblock", "--ip", "198.51.100.24"]);

    expect(clearAuthBlockByIp).toHaveBeenCalledWith("198.51.100.24");
    expect(logSpy).toHaveBeenCalledWith("Unblocked IP: 198.51.100.24");
  });

  it("prints identify output", async () => {
    vi.stubEnv("CODER_STUDIO", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["identify", "--json"]);

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      insideCoderStudio: false,
    });
  });

  it("prints capabilities output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["capabilities", "--json"]);

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual(
      expect.objectContaining({
        version: 1,
        commands: expect.arrayContaining([expect.objectContaining({ name: "git.status" })]),
      })
    );
  });

  it("prints workspace list output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce([{ id: "ws-1", path: "/repo" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["workspace", "list", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "workspace.list",
      args: {},
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      { id: "ws-1", path: "/repo" },
    ]);
  });

  it("prints session list output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce([{ id: "sess-1", workspaceId: "ws-1" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["session", "list", "--workspace", "ws-1", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "session.list",
      args: { workspaceId: "ws-1" },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      { id: "sess-1", workspaceId: "ws-1" },
    ]);
  });

  it("prints terminal read output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({ terminalId: "term-1", text: "ready\n" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["terminal", "read", "--terminal", "term-1", "--bytes", "4096", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "terminal.read",
      args: { terminalId: "term-1", bytes: 4096 },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      terminalId: "term-1",
      text: "ready\n",
    });
  });

  it("prints git status output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({ branch: "main", entries: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["git", "status", "--workspace", "ws-1", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "git.status",
      args: { workspaceId: "ws-1" },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      branch: "main",
      entries: [],
    });
  });

  it("prints git diff output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({ diff: "diff --git a/a b/a\n" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["git", "diff", "--workspace", "ws-1", "--path", "src/a.ts", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "git.diff",
      args: { workspaceId: "ws-1", path: "src/a.ts" },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      diff: "diff --git a/a b/a\n",
    });
  });

  it("prints UI open-file dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-1",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "ui",
      "open-file",
      "--workspace",
      "ws-1",
      "--path",
      "src/index.ts",
      "--line",
      "12",
      "--column",
      "3",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "editor.openFile",
          workspaceId: "ws-1",
          path: "src/index.ts",
          line: 12,
          column: 3,
        },
        source: { kind: "agent" },
      },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-1",
      topic: "workspace.ws-1.ui.action",
    });
  });

  it("prints UI open-url dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-2",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "ui",
      "open-url",
      "--workspace",
      "ws-1",
      "--url",
      "http://127.0.0.1:5173",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "browser.openUrl",
          workspaceId: "ws-1",
          url: "http://127.0.0.1:5173",
        },
        source: { kind: "agent" },
      },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-2",
      topic: "workspace.ws-1.ui.action",
    });
  });

  it("prints UI close-file dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-close-file",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["ui", "close-file", "--workspace", "ws-1", "--path", "src/index.ts", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "editor.closeFile",
          workspaceId: "ws-1",
          path: "src/index.ts",
        },
        source: { kind: "agent" },
      },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-close-file",
      topic: "workspace.ws-1.ui.action",
    });
  });

  it("prints UI close-url dispatch output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({
      accepted: true,
      requestId: "req-close-url",
      topic: "workspace.ws-1.ui.action",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "ui",
      "close-url",
      "--workspace",
      "ws-1",
      "--url",
      "http://127.0.0.1:5173",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "uiAction.dispatch",
      args: {
        workspaceId: "ws-1",
        intent: {
          type: "browser.closeUrl",
          workspaceId: "ws-1",
          url: "http://127.0.0.1:5173",
        },
        source: { kind: "agent" },
      },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      accepted: true,
      requestId: "req-close-url",
      topic: "workspace.ws-1.ui.action",
    });
  });

  it("prints memory list output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce([{ id: "mem-1", workspaceId: "ws-1" }]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["memory", "list", "--workspace", "ws-1", "--type", "decision", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "memory.list",
      args: { workspaceId: "ws-1", type: "decision" },
    });
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual([
      { id: "mem-1", workspaceId: "ws-1" },
    ]);
  });

  it("uses CODER_STUDIO_WORKSPACE_ID for memory commands when workspace is omitted", async () => {
    vi.stubEnv("CODER_STUDIO_WORKSPACE_ID", "ws-env");
    callCoderStudioCommand.mockResolvedValueOnce([{ id: "mem-1", workspaceId: "ws-env" }]);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["memory", "search", "testing", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "memory.search",
      args: { workspaceId: "ws-env", query: "testing" },
    });
  });

  it("prints memory get output through the Coder Studio command API", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({ id: "mem-1", workspaceId: "ws-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["memory", "get", "mem-1", "--workspace", "ws-1", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "memory.get",
      args: { workspaceId: "ws-1", id: "mem-1" },
    });
  });

  it("maps memory add options to memory.create", async () => {
    callCoderStudioCommand.mockResolvedValueOnce({ id: "mem-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "memory",
      "add",
      "--workspace",
      "ws-1",
      "--type",
      "decision",
      "--content",
      "Persist decisions outside the repo.",
      "--tag",
      "Architecture",
      "--tag",
      "Testing",
      "--skill",
      "coder-studio-memory",
      "--json",
    ]);

    expect(callCoderStudioCommand).toHaveBeenCalledWith({
      apiUrl: undefined,
      op: "memory.create",
      args: {
        workspaceId: "ws-1",
        type: "decision",
        content: "Persist decisions outside the repo.",
        tags: ["Architecture", "Testing"],
        sourceHint: { skillSlug: "coder-studio-memory" },
      },
    });
  });

  it("maps memory update and delete commands", async () => {
    callCoderStudioCommand.mockResolvedValue({ id: "mem-1", workspaceId: "ws-1" });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await main([
      "memory",
      "update",
      "mem-1",
      "--workspace",
      "ws-1",
      "--content",
      "Updated content",
      "--tag",
      "storage",
      "--json",
    ]);
    await main(["memory", "delete", "mem-1", "--workspace", "ws-1", "--json"]);

    expect(callCoderStudioCommand).toHaveBeenNthCalledWith(1, {
      apiUrl: undefined,
      op: "memory.update",
      args: {
        workspaceId: "ws-1",
        id: "mem-1",
        content: "Updated content",
        tags: ["storage"],
      },
    });
    expect(callCoderStudioCommand).toHaveBeenNthCalledWith(2, {
      apiUrl: undefined,
      op: "memory.delete",
      args: { workspaceId: "ws-1", id: "mem-1" },
    });
  });
});

describe("parseArgs", () => {
  it("defaults to serve command when no command given", () => {
    expect(parseArgs([])).toEqual({
      command: "serve",
    });
  });

  it("parses config command with host and port values", () => {
    expect(parseArgs(["config", "--host", "0.0.0.0", "--port", "4186"])).toEqual({
      command: "config",
      host: "0.0.0.0",
      port: 4186,
    });
  });

  it("parses config command with data-dir and password values", () => {
    expect(parseArgs(["config", "--state-dir", "/tmp/cs-data", "--password", "sekrit"])).toEqual({
      command: "config",
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });
  });

  it("accepts legacy data-dir as a config alias", () => {
    expect(parseArgs(["config", "--data-dir", "/tmp/cs-data", "--password", "sekrit"])).toEqual({
      command: "config",
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });
  });

  it("parses stop command", () => {
    expect(parseArgs(["stop"])).toEqual({
      command: "stop",
    });
  });

  it("parses status command", () => {
    expect(parseArgs(["status"])).toEqual({
      command: "status",
    });
  });

  it("parses logs command", () => {
    expect(parseArgs(["logs"])).toEqual({
      command: "logs",
    });
  });

  it("parses logs command with tail count", () => {
    expect(parseArgs(["logs", "--tail", "100"])).toEqual({
      command: "logs",
      tail: 100,
    });
  });

  it("parses logs command with errors-only flag", () => {
    expect(parseArgs(["logs", "--errors-only"])).toEqual({
      command: "logs",
      errorsOnly: true,
    });
  });

  it("parses open command", () => {
    expect(parseArgs(["open"])).toEqual({
      command: "open",
    });
  });

  it("parses version command", () => {
    expect(parseArgs(["version"])).toEqual({
      command: "version",
    });
  });

  it("parses auth ban-list command", () => {
    expect(parseArgs(["auth", "ban-list"])).toEqual({
      command: "auth",
      authCommand: "ban-list",
    });
  });

  it("parses auth unblock command with ip value", () => {
    expect(parseArgs(["auth", "unblock", "--ip", "198.51.100.24"])).toEqual({
      command: "auth",
      authCommand: "unblock",
      ip: "198.51.100.24",
    });
  });

  it("parses identify command with json output", () => {
    expect(parseArgs(["identify", "--json"])).toEqual({
      command: "identify",
      json: true,
    });
  });

  it("parses capabilities command with json output", () => {
    expect(parseArgs(["capabilities", "--json"])).toEqual({
      command: "capabilities",
      json: true,
    });
  });

  it("parses workspace list command with json output", () => {
    expect(parseArgs(["workspace", "list", "--json"])).toEqual({
      command: "workspace",
      workspaceCommand: "list",
      json: true,
    });
  });

  it("parses session list command with workspace and json output", () => {
    expect(parseArgs(["session", "list", "--workspace", "ws-1", "--json"])).toEqual({
      command: "session",
      sessionCommand: "list",
      workspaceId: "ws-1",
      json: true,
    });
  });

  it("parses terminal read command with terminal id and byte limit", () => {
    expect(parseArgs(["terminal", "read", "--terminal", "term-1", "--bytes", "4096"])).toEqual({
      command: "terminal",
      terminalCommand: "read",
      terminalId: "term-1",
      bytes: 4096,
    });
  });

  it("parses git status command with workspace and json output", () => {
    expect(parseArgs(["git", "status", "--workspace", "ws-1", "--json"])).toEqual({
      command: "git",
      gitCommand: "status",
      workspaceId: "ws-1",
      json: true,
    });
  });

  it("parses git diff command with workspace, path, staged, and json output", () => {
    expect(
      parseArgs(["git", "diff", "--workspace", "ws-1", "--path", "src/a.ts", "--staged", "--json"])
    ).toEqual({
      command: "git",
      gitCommand: "diff",
      workspaceId: "ws-1",
      path: "src/a.ts",
      staged: true,
      json: true,
    });
  });

  it("parses UI open-file command", () => {
    expect(
      parseArgs([
        "ui",
        "open-file",
        "--workspace",
        "ws-1",
        "--path",
        "src/index.ts",
        "--line",
        "12",
        "--column",
        "3",
        "--json",
      ])
    ).toEqual({
      command: "ui",
      uiCommand: "open-file",
      workspaceId: "ws-1",
      path: "src/index.ts",
      line: 12,
      column: 3,
      json: true,
    });
  });

  it("parses memory list command with workspace, type, tag, and json output", () => {
    expect(
      parseArgs([
        "memory",
        "list",
        "--workspace",
        "ws-1",
        "--type",
        "decision",
        "--tag",
        "Architecture",
        "--json",
      ])
    ).toEqual({
      command: "memory",
      memoryCommand: "list",
      workspaceId: "ws-1",
      memoryType: "decision",
      tags: ["Architecture"],
      json: true,
    });
  });

  it("parses UI close-file command", () => {
    expect(
      parseArgs(["ui", "close-file", "--workspace", "ws-1", "--path", "src/index.ts", "--json"])
    ).toEqual({
      command: "ui",
      uiCommand: "close-file",
      workspaceId: "ws-1",
      path: "src/index.ts",
      json: true,
    });
  });

  it("parses UI close-url command", () => {
    expect(
      parseArgs([
        "ui",
        "close-url",
        "--workspace",
        "ws-1",
        "--url",
        "http://127.0.0.1:5173",
        "--json",
      ])
    ).toEqual({
      command: "ui",
      uiCommand: "close-url",
      workspaceId: "ws-1",
      url: "http://127.0.0.1:5173",
      json: true,
    });
  });

  it("parses memory search command with query text", () => {
    expect(parseArgs(["memory", "search", "testing", "--workspace", "ws-1"])).toEqual({
      command: "memory",
      memoryCommand: "search",
      workspaceId: "ws-1",
      query: "testing",
    });
  });

  it("parses memory get command with id", () => {
    expect(parseArgs(["memory", "get", "mem-1", "--workspace", "ws-1"])).toEqual({
      command: "memory",
      memoryCommand: "get",
      memoryId: "mem-1",
      workspaceId: "ws-1",
    });
  });

  it("parses memory add command with content fields, tags, and skill source", () => {
    expect(
      parseArgs([
        "memory",
        "add",
        "--workspace",
        "ws-1",
        "--type",
        "decision",
        "--content",
        "Persist decisions.",
        "--tag",
        "Architecture",
        "--tag",
        "Testing",
        "--skill",
        "coder-studio-memory",
        "--json",
      ])
    ).toEqual({
      command: "memory",
      memoryCommand: "add",
      workspaceId: "ws-1",
      memoryType: "decision",
      content: "Persist decisions.",
      tags: ["Architecture", "Testing"],
      skillSlug: "coder-studio-memory",
      json: true,
    });
  });

  it("parses UI show-panel and run-command commands", () => {
    expect(parseArgs(["ui", "show-panel", "--panel", "terminal"])).toEqual({
      command: "ui",
      uiCommand: "show-panel",
      panel: "terminal",
    });

    expect(parseArgs(["ui", "run-command", "--command", "quickOpen.open"])).toEqual({
      command: "ui",
      uiCommand: "run-command",
      uiCommandId: "quickOpen.open",
    });
  });

  it("parses memory update and delete commands", () => {
    expect(
      parseArgs([
        "memory",
        "update",
        "mem-1",
        "--workspace",
        "ws-1",
        "--content",
        "Updated content",
        "--tag",
        "storage",
      ])
    ).toEqual({
      command: "memory",
      memoryCommand: "update",
      memoryId: "mem-1",
      workspaceId: "ws-1",
      content: "Updated content",
      tags: ["storage"],
    });
    expect(parseArgs(["memory", "delete", "mem-1", "--workspace", "ws-1"])).toEqual({
      command: "memory",
      memoryCommand: "delete",
      memoryId: "mem-1",
      workspaceId: "ws-1",
    });
  });

  it("parses server alias as serve", () => {
    expect(parseArgs(["server"])).toEqual({
      command: "serve",
    });
  });

  it("treats -h as help instead of host", () => {
    expect(parseArgs(["-h"])).toEqual({
      command: "help",
    });
  });

  it("parses config help subcommand", () => {
    expect(parseArgs(["config", "help"])).toEqual({
      command: "config",
      configHelp: true,
    });
  });

  it("parses config --help flag", () => {
    expect(parseArgs(["config", "--help"])).toEqual({
      command: "config",
      configHelp: true,
    });
  });

  it("parses serve --foreground with foreground: true", () => {
    expect(parseArgs(["serve", "--foreground"])).toEqual({
      command: "serve",
      foreground: true,
    });
  });

  it("parses serve --restart with restart: true", () => {
    expect(parseArgs(["serve", "--restart"])).toEqual({
      command: "serve",
      restart: true,
    });
  });

  it("parses open --restart with restart: true", () => {
    expect(parseArgs(["open", "--restart"])).toEqual({
      command: "open",
      restart: true,
    });
  });

  it("parses bare foreground flag as serve foreground mode", () => {
    expect(parseArgs(["--foreground"])).toEqual({
      command: "serve",
      foreground: true,
    });
  });

  it("rejects serve-time host overrides", () => {
    expect(() => parseArgs(["serve", "--host", "0.0.0.0"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects serve-time port overrides", () => {
    expect(() => parseArgs(["serve", "--port", "4186"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects serve-time state-dir overrides", () => {
    expect(() => parseArgs(["serve", "--state-dir", "/tmp/data"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects bare legacy data-dir overrides", () => {
    expect(() => parseArgs(["--data-dir", "/tmp/cs-data"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects bare state-dir overrides", () => {
    expect(() => parseArgs(["--state-dir", "/tmp/cs-data"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects serve-time password overrides", () => {
    expect(() => parseArgs(["serve", "--password", "sekrit"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects bare password overrides", () => {
    expect(() => parseArgs(["--password", "sekrit"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects serve-time no-auth overrides", () => {
    expect(() => parseArgs(["serve", "--no-auth"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects bare no-auth overrides", () => {
    expect(() => parseArgs(["--no-auth"])).toThrow(RUNTIME_CONFIG_ERROR);
  });

  it("rejects status-time host overrides", () => {
    expect(() => parseArgs(["status", "--host", "0.0.0.0"])).toThrow("Unknown option: --host");
  });

  it("rejects logs-time port overrides", () => {
    expect(() => parseArgs(["logs", "--port", "4186"])).toThrow("Unknown option: --port");
  });

  it("rejects logs tail with a non-numeric value", () => {
    expect(() => parseArgs(["logs", "--tail", "nope"])).toThrow("Invalid tail number");
  });

  it("rejects logs tail with zero", () => {
    expect(() => parseArgs(["logs", "--tail", "0"])).toThrow("Invalid tail number");
  });

  it("rejects logs tail with a negative value", () => {
    expect(() => parseArgs(["logs", "--tail", "-1"])).toThrow("Invalid tail number");
  });

  it("rejects logs tail with a decimal value", () => {
    expect(() => parseArgs(["logs", "--tail", "1.5"])).toThrow("Invalid tail number");
  });

  it("rejects logs tail with trailing garbage", () => {
    expect(() => parseArgs(["logs", "--tail", "10junk"])).toThrow("Invalid tail number");
  });

  it("rejects stop-time state-dir overrides", () => {
    expect(() => parseArgs(["stop", "--state-dir", "/tmp/cs-data"])).toThrow(
      "Unknown option: --state-dir"
    );
  });

  it("rejects help-time password overrides", () => {
    expect(() => parseArgs(["help", "--password", "sekrit"])).toThrow("Unknown option: --password");
  });

  it("rejects version-time no-auth overrides", () => {
    expect(() => parseArgs(["--version", "--no-auth"])).toThrow("Unknown option: --no-auth");
  });

  it("rejects config-to-stop host overrides after switching commands", () => {
    expect(() => parseArgs(["config", "stop", "--host", "0.0.0.0"])).toThrow(
      "Unknown option: --host"
    );
  });

  it("rejects config-to-status password overrides after switching commands", () => {
    expect(() => parseArgs(["config", "status", "--password", "sekrit"])).toThrow(
      "Unknown option: --password"
    );
  });

  it("rejects config-to-logs no-auth overrides after switching commands", () => {
    expect(() => parseArgs(["config", "logs", "--no-auth"])).toThrow("Unknown option: --no-auth");
  });

  it("rejects config-time no-auth overrides", () => {
    expect(() => parseArgs(["config", "--no-auth"])).toThrow("Unknown option: --no-auth");
  });

  it("treats config then stop then help as help, not config help", () => {
    expect(parseArgs(["config", "stop", "help"])).toEqual({
      command: "help",
    });
  });

  it("treats config then logs then --help as help, not config help", () => {
    expect(parseArgs(["config", "logs", "--help"])).toEqual({
      command: "help",
    });
  });

  it("rejects foreground after switching from serve to version", () => {
    expect(() => parseArgs(["serve", "--version", "--foreground"])).toThrow(
      "Unknown option: --foreground"
    );
  });

  it("rejects restart on non-start commands", () => {
    expect(() => parseArgs(["status", "--restart"])).toThrow("Unknown option: --restart");
  });

  it("rejects unknown positional tokens", () => {
    expect(() => parseArgs(["bogus"])).toThrow("Unknown argument: bogus");
  });

  it("requires an ip value for auth unblock", () => {
    expect(() => parseArgs(["auth", "unblock"])).toThrow("Missing ip value");
  });

  it("rejects unknown flags on non-config commands", () => {
    expect(() => parseArgs(["status", "--bogus"])).toThrow("Unknown option: --bogus");
  });

  it("rejects json output on unsupported commands", () => {
    expect(() => parseArgs(["status", "--json"])).toThrow("Unknown option: --json");
  });

  it("requires workspace id for session list", () => {
    expect(() => parseArgs(["session", "list"])).toThrow("Missing workspace value");
  });

  it("requires terminal id for terminal read", () => {
    expect(() => parseArgs(["terminal", "read"])).toThrow("Missing terminal value");
  });

  it("requires workspace id for git status", () => {
    expect(() => parseArgs(["git", "status"])).toThrow("Missing workspace value");
  });

  it("requires path for git diff", () => {
    expect(() => parseArgs(["git", "diff", "--workspace", "ws-1"])).toThrow("Missing path value");
  });

  it("requires memory command arguments", () => {
    expect(() => parseArgs(["memory"])).toThrow("Missing memory subcommand");
    expect(() => parseArgs(["memory", "get", "--workspace", "ws-1"])).toThrow(
      "Missing memory id value"
    );
    expect(() => parseArgs(["memory", "add", "--workspace", "ws-1"])).toThrow("Missing type value");
    expect(() => parseArgs(["memory", "add", "--type", "decision"])).toThrow(
      "Missing content value"
    );
    expect(() => parseArgs(["memory", "search", "--workspace", "ws-1"])).toThrow(
      "Missing query value"
    );
  });

  it("rejects legacy title flags on memory commands", () => {
    expect(() =>
      parseArgs(["memory", "add", "--workspace", "ws-1", "--type", "decision", "--title", "t"])
    ).toThrow("Unknown option: --title");
    expect(() =>
      parseArgs(["memory", "update", "mem-1", "--workspace", "ws-1", "--title", "t"])
    ).toThrow("Unknown option: --title");
  });

  it("allows config-time host-only updates", () => {
    expect(parseArgs(["config", "--host", "127.0.0.1"])).toEqual({
      command: "config",
      host: "127.0.0.1",
    });
  });

  it("allows config-time port-only updates", () => {
    expect(parseArgs(["config", "--port", "4190"])).toEqual({
      command: "config",
      port: 4190,
    });
  });

  it("allows config-time state-dir updates", () => {
    expect(parseArgs(["config", "--state-dir", "/custom/path"])).toEqual({
      command: "config",
      stateDir: "/custom/path",
    });
  });

  it("allows config-time password updates", () => {
    expect(parseArgs(["config", "--password", "mypassword"])).toEqual({
      command: "config",
      password: "mypassword",
    });
  });
});
