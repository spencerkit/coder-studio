import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { SystemDependencyInstallManager } from "../../system-deps/install-manager.js";

function createFakePtyHost() {
  let onData: ((data: string) => void) | undefined;
  let onExit: ((event: { exitCode: number }) => void) | undefined;
  const writes: string[] = [];

  return {
    writes,
    host: {
      spawn: vi.fn(() => ({
        onData: (cb: (data: string) => void) => {
          onData = cb;
        },
        onExit: (cb: (event: { exitCode: number }) => void) => {
          onExit = cb;
        },
        write: (data: string | Buffer) => {
          writes.push(Buffer.isBuffer(data) ? data.toString("utf8") : data);
        },
        resize: () => {},
        kill: async () => {
          onExit?.({ exitCode: 130 });
        },
      })),
    },
    emitData: (data: string) => onData?.(data),
    emitExit: (exitCode = 0) => onExit?.({ exitCode }),
  };
}

describe("SystemDependencyInstallManager", () => {
  it("reuses the active job, broadcasts output, waits for password input, and verifies success", async () => {
    const pty = createFakePtyHost();
    const broadcast = vi.fn();
    let gitInstalled = false;
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { broadcast } as never,
      commandExists: vi.fn(
        async (command: string) => command === "apt-get" || (gitInstalled && command === "git")
      ),
      runCommand: vi.fn(async (file: string) => {
        if (file === "git") {
          if (!gitInstalled) {
            throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
          }
          return { stdout: "git version 2.49.0\n", stderr: "" };
        }
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const first = await manager.start("git");
    const second = await manager.start("git");

    expect(second.jobId).toBe(first.jobId);

    pty.emitData("[sudo] password for spencer:");

    await vi.waitFor(() => {
      expect(manager.get(first.jobId)?.status).toBe("waiting_input");
    });

    await manager.submitInput(first.jobId, "hunter2\n");
    expect(pty.writes.at(-1)).toBe("hunter2\n");

    gitInstalled = true;
    pty.emitData("installed git\n");
    pty.emitExit(0);

    await vi.waitFor(() => {
      expect(manager.get(first.jobId)?.status).toBe("succeeded");
    });

    expect(broadcast).toHaveBeenCalledWith(
      Topics.systemDependencyInstallOutput(first.jobId),
      expect.objectContaining({ jobId: first.jobId, chunk: "installed git\n" })
    );
  });

  it("marks a cancelled job when the user aborts the install", async () => {
    const pty = createFakePtyHost();
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { broadcast: vi.fn() } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git");
    await manager.cancel(job.jobId);

    expect(manager.get(job.jobId)).toMatchObject({
      status: "cancelled",
      failure: { code: "user_cancelled" },
    });
  });
});
