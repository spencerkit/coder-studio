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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("SystemDependencyInstallManager", () => {
  it("reuses the active job for the owner, rebinds output after reconnect, waits for password input, and verifies success", async () => {
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

    const first = await manager.start("git", "tab-a", "client-a");
    const second = await manager.start("git", "tab-a", "client-a");

    expect(second.jobId).toBe(first.jobId);
    await expect(manager.start("git", "tab-b", "client-b")).rejects.toMatchObject({
      code: "system_dependency_install_in_progress",
    });

    pty.emitData("[sudo] password for spencer:");

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "tab-a", "client-a")?.status).toBe("waiting_input");
    });
    expect(manager.get(first.jobId, "tab-b", "client-b")).toBeUndefined();

    expect(manager.get(first.jobId, "tab-a", "client-a-reconnected")?.status).toBe("waiting_input");

    await manager.submitInput(first.jobId, "tab-a", "hunter2\n", "client-a-reconnected");
    expect(pty.writes.at(-1)).toBe("hunter2\n");

    gitInstalled = true;
    pty.emitData("installed git\n");
    pty.emitExit({ exitCode: 0 });

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "tab-a", "client-a-reconnected")?.status).toBe("succeeded");
    });

    expect(sendToClient).toHaveBeenCalledWith(
      "client-a-reconnected",
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

    const job = await manager.start("git", "tab-a", "client-a");
    await manager.cancel(job.jobId, "tab-a", "client-a");

    expect(manager.get(job.jobId, "tab-a", "client-a")).toMatchObject({
      status: "cancelled",
      failure: { code: "user_cancelled" },
    });
  });

  it("keeps a cancelled job cancelled if the user aborts during verification", async () => {
    const pty = createFakePtyHost();
    const verifyDeferred = createDeferred<{ stdout: string; stderr: string }>();
    let gitInstalled = false;
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: pty.host,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(
        async (command: string) => command === "apt-get" || (gitInstalled && command === "git")
      ),
      runCommand: vi.fn(async (file: string) => {
        if (file === "git") {
          return verifyDeferred.promise;
        }
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "tab-a", "client-a");
    gitInstalled = true;
    pty.emitExit({ exitCode: 0 });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "tab-a", "client-a")?.currentStepId).toBe("verify-git");
    });

    await manager.cancel(job.jobId, "tab-a", "client-a");
    verifyDeferred.resolve({ stdout: "git version 2.49.0\n", stderr: "" });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "tab-a", "client-a")).toMatchObject({
        status: "cancelled",
        failure: { code: "user_cancelled" },
      });
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

    const job = await manager.start("git", "tab-a", "client-a");
    pty.emitData(
      "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n"
    );
    pty.emitExit({ exitCode: 100 });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "tab-a", "client-a")).toMatchObject({
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

    const job = await manager.start("git", "tab-a", "client-a");
    pty.emitExit({ exitCode: 1, reason: "pty_disconnected" });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "tab-a", "client-a")).toMatchObject({
        status: "failed",
        failure: { code: "pty_disconnected" },
      });
    });
  });

  it("does not misclassify signal exits as pty disconnects", async () => {
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

    const job = await manager.start("git", "tab-a", "client-a");
    pty.emitExit({ exitCode: 143, signal: 15 });

    await vi.waitFor(() => {
      expect(manager.get(job.jobId, "tab-a", "client-a")).toMatchObject({
        status: "failed",
        failure: { code: "command_failed" },
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

    const first = await manager.start("git", "tab-a", "client-a");
    firstPty.emitExit({ exitCode: 1 });

    await vi.waitFor(() => {
      expect(manager.get(first.jobId, "tab-a", "client-a")?.status).toBe("failed");
    });

    const retried = await manager.start("git", "tab-a", "client-a");
    expect(retried.jobId).not.toBe(first.jobId);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("classifies PTY spawn EACCES failures as permission_denied", async () => {
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: {
        spawn: vi.fn(() => {
          throw Object.assign(new Error("spawn sudo EACCES"), {
            code: "EACCES",
            stderr: "Permission denied",
          });
        }),
      } as never,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "tab-a", "client-a");

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "permission_denied",
      },
    });
  });

  it("classifies PTY spawn failures without a known permission or ENOENT code as command_failed", async () => {
    const manager = new SystemDependencyInstallManager({
      platform: "linux",
      ptyHost: {
        spawn: vi.fn(() => {
          throw Object.assign(new Error("spawn failed"), {
            code: "EIO",
            stderr: "terminal backend failed",
          });
        }),
      } as never,
      broadcaster: { sendToClient: vi.fn(() => true) } as never,
      commandExists: vi.fn(async (command: string) => command === "apt-get"),
      runCommand: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { exitCode: 127, stdout: "", stderr: "" });
      }),
    });

    const job = await manager.start("git", "tab-a", "client-a");

    expect(job).toMatchObject({
      status: "failed",
      failure: {
        code: "command_failed",
      },
    });
  });
});
