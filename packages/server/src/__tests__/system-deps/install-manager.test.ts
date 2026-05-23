import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { SystemDependencyInstallManager } from "../../system-deps/install-manager.js";

function createFakePtyHost() {
  let onData: ((data: string) => void) | undefined;
  let onExit:
    | ((event: { exitCode: number; signal?: number; reason?: "exit" | "pty_disconnected" }) => void)
    | undefined;
  const writes: string[] = [];

  return {
    writes,
    host: {
      spawn: vi.fn(() => ({
        onData: (cb: (data: string) => void) => {
          onData = cb;
        },
        onExit: (
          cb: (event: {
            exitCode: number;
            signal?: number;
            reason?: "exit" | "pty_disconnected";
          }) => void
        ) => {
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
    emitExit: (
      event: { exitCode?: number; signal?: number; reason?: "exit" | "pty_disconnected" } = {}
    ) =>
      onExit?.({
        exitCode: event.exitCode ?? 0,
        signal: event.signal,
        reason: event.reason,
      }),
  };
}

describe("SystemDependencyInstallManager", () => {
  it("reuses the active job for the owner, sends output only to the owner, waits for password input, and verifies success", async () => {
    const pty = createFakePtyHost();
    const sendToClient = vi.fn(() => true);
    let gitInstalled = false;
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { sendToClient } as never,
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

    const first = await manager.start("git", "client-a");
    const second = await manager.start("git", "client-a");

    expect(second.jobId).toBe(first.jobId);
    await expect(manager.start("git", "client-b")).rejects.toMatchObject({
      code: "system_dependency_install_in_progress",
    });

    pty.emitData("[sudo] password for spencer:");

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "client-a")?.status).toBe("waiting_input");
    });
    expect(manager.get(first.jobId, "client-b")).toBeUndefined();

    await manager.submitInput(first.jobId, "client-a", "hunter2\n");
    expect(pty.writes.at(-1)).toBe("hunter2\n");

    gitInstalled = true;
    pty.emitData("installed git\n");
    pty.emitExit({ exitCode: 0 });

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "client-a")?.status).toBe("succeeded");
    });

    expect(sendToClient).toHaveBeenCalledWith(
      "client-a",
      expect.objectContaining({
        kind: "event",
        topic: Topics.systemDependencyInstallOutput(first.jobId),
        data: expect.objectContaining({ jobId: first.jobId, chunk: "installed git\n" }),
      })
    );
  });

  it("marks a cancelled job when the user aborts the install", async () => {
    const pty = createFakePtyHost();
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "client-a");
    await manager.cancel(job.jobId, "client-a");

    expect(manager.get(job.jobId, "client-a")).toMatchObject({
      status: "cancelled",
      failure: { code: "user_cancelled" },
    });
  });

  it("classifies permission denied failures from install output", async () => {
    const pty = createFakePtyHost();
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "client-a");
    pty.emitData(
      "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n"
    );
    pty.emitExit({ exitCode: 100 });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "client-a")).toMatchObject({
        status: "failed",
        failure: { code: "permission_denied" },
      });
    });
  });

  it("classifies pty disconnect failures distinctly", async () => {
    const pty = createFakePtyHost();
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "client-a");
    pty.emitExit({ exitCode: 1, reason: "pty_disconnected" });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "client-a")).toMatchObject({
        status: "failed",
        failure: { code: "pty_disconnected" },
      });
    });
  });

  it("allows the owner to retry after a failed install", async () => {
    const firstPty = createFakePtyHost();
    const secondPty = createFakePtyHost();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(firstPty.host.spawn())
      .mockReturnValueOnce(secondPty.host.spawn());
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: { spawn } as never,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const first = await manager.start("git", "client-a");
    firstPty.emitExit({ exitCode: 1 });

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "client-a")?.status).toBe("failed");
    });

    const retried = await manager.start("git", "client-a");
    expect(retried.jobId).not.toBe(first.jobId);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
