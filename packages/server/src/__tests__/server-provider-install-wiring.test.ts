import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import { createServer, type Server } from "../server.js";

describe("createServer provider install wiring", () => {
  let server: Server | undefined;
  let dataDir: string;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true });
    }

    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }

    vi.clearAllMocks();
  });

  it("forwards execFile options from the assembled provider install manager", async () => {
    let codexChecks = 0;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    execFileMock.mockImplementation(
      (
        file: string,
        args: string[],
        options: { windowsHide?: boolean },
        callback: (
          error: Error | null,
          result?: {
            stdout: string;
            stderr: string;
          }
        ) => void
      ) => {
        if (!options?.windowsHide) {
          callback(new Error(`windowsHide missing for ${file}`));
          return {} as ReturnType<typeof execFileMock>;
        }

        if (file === "where" && args[0] === "codex") {
          codexChecks += 1;
          if (codexChecks === 1) {
            callback(new Error("codex unavailable"));
            return {} as ReturnType<typeof execFileMock>;
          }

          callback(null, { stdout: "C:\\codex\\codex.exe\r\n", stderr: "" });
          return {} as ReturnType<typeof execFileMock>;
        }

        if (file === "where" && args[0] === "npm") {
          callback(null, { stdout: "C:\\npm\\npm.cmd\r\n", stderr: "" });
          return {} as ReturnType<typeof execFileMock>;
        }

        if (file === "npm" && args.join(" ") === "install -g @openai/codex") {
          callback(null, { stdout: "installed", stderr: "" });
          return {} as ReturnType<typeof execFileMock>;
        }

        callback(new Error(`unexpected execFile call: ${file} ${args.join(" ")}`));
        return {} as ReturnType<typeof execFileMock>;
      }
    );

    dataDir = mkdtempSync(join(tmpdir(), "coder-studio-server-provider-install-"));
    server = await createServer({
      dataDir: join(dataDir, "server.db"),
      host: "127.0.0.1",
      port: 0,
    });

    const providerInstallMgr = server.__test__?.commandContext.providerInstallMgr;
    expect(providerInstallMgr).toBeDefined();

    const job = await providerInstallMgr!.start("codex");

    await vi.waitFor(() => {
      expect(providerInstallMgr!.get(job.jobId)?.status).toBe("succeeded");
    });

    expect(execFileMock).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@openai/codex"],
      { windowsHide: true },
      expect.any(Function)
    );
  });
});
