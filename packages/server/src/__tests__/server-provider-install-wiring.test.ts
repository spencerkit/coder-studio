import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { createServer, type Server } from "../server.js";

describe("createServer provider install wiring", () => {
  let server: Server | undefined;
  let stateDir: string;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    if (stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
    }

    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }

    vi.clearAllMocks();
  });

  it("forwards direct command-name execution from the assembled provider install manager", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    let npmInstalled = false;
    let codexInstalled = false;
    spawnMock.mockImplementation(
      (file: string, args: string[], options: { windowsHide?: boolean }) => {
        const stdoutHandlers: Array<(chunk: string) => void> = [];
        const stderrHandlers: Array<(chunk: string) => void> = [];
        const closeHandlers: Array<(code: number) => void> = [];
        const errorHandlers: Array<(error: Error) => void> = [];
        const child = {
          stdout: {
            on: vi.fn((event: string, handler: (chunk: string) => void) => {
              if (event === "data") stdoutHandlers.push(handler);
            }),
          },
          stderr: {
            on: vi.fn((event: string, handler: (chunk: string) => void) => {
              if (event === "data") stderrHandlers.push(handler);
            }),
          },
          on: vi.fn((event: string, handler: ((arg: number) => void) | ((arg: Error) => void)) => {
            if (event === "close") closeHandlers.push(handler as (code: number) => void);
            if (event === "error") errorHandlers.push(handler as (error: Error) => void);
          }),
        };

        queueMicrotask(() => {
          if (!options?.windowsHide) {
            for (const handler of errorHandlers) {
              handler(new Error(`windowsHide missing for ${file}`));
            }
            return;
          }

          const writeStdout = (value: string) => {
            for (const handler of stdoutHandlers) handler(value);
          };
          const closeOk = () => {
            for (const handler of closeHandlers) handler(0);
          };
          const fail = (message: string) => {
            for (const handler of errorHandlers) handler(new Error(message));
          };

          if (file === "where" && args[0] === "winget") {
            writeStdout("C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe\r\n");
            closeOk();
            return;
          }

          if (
            file === "winget" &&
            args.join(" ") === "install --id OpenJS.NodeJS.LTS --exact --silent"
          ) {
            npmInstalled = true;
            writeStdout("installed node");
            closeOk();
            return;
          }

          if (file === "npm" && args.join(" ") === "install -g @openai/codex") {
            if (!npmInstalled) {
              fail("npm unavailable");
              return;
            }
            codexInstalled = true;
            writeStdout("installed");
            closeOk();
            return;
          }

          if (file === "where" && args[0] === "codex") {
            if (!codexInstalled) {
              fail("codex unavailable");
              return;
            }
            writeStdout("C:\\codex\\codex.cmd\r\n");
            closeOk();
            return;
          }

          fail(`unexpected spawn call: ${file} ${args.join(" ")}`);
        });

        return child;
      }
    );

    stateDir = mkdtempSync(join(tmpdir(), "coder-studio-server-provider-install-"));
    server = await createServer({
      stateDir,
      host: "127.0.0.1",
      port: 0,
    });

    const providerInstallMgr = server.__test__?.commandContext.providerInstallMgr;
    expect(providerInstallMgr).toBeDefined();

    const job = await providerInstallMgr!.start("codex");

    await vi.waitFor(() => {
      expect(providerInstallMgr!.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@openai/codex"],
      expect.objectContaining({ shell: true, windowsHide: true })
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "winget",
      ["install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--silent"],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });
});
