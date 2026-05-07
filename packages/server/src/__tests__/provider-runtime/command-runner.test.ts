import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
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

import { runCommandAsString } from "../../provider-runtime/command-runner.js";

function createChildProcessMock() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = stdout;
  child.stderr = stderr;
  return child;
}

describe("runCommandAsString", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("normalizes stdout and stderr to strings", async () => {
    spawnMock.mockImplementation(
      (_file: string, _args: string[], _options: { windowsHide?: boolean }) => {
        const child = createChildProcessMock();
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("ok\n"));
          child.stderr.emit("data", Buffer.from("warn\n"));
          child.emit("close", 0);
        });
        return child;
      }
    );

    const result = await runCommandAsString("demo", ["--version"], { windowsHide: true });

    expect(result).toEqual({ stdout: "ok\n", stderr: "warn\n" });
    expect(spawnMock).toHaveBeenCalledWith("demo", ["--version"], {
      shell: false,
      windowsHide: true,
    });
  });

  it("defaults windowsHide to true when caller omits the option", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await runCommandAsString("demo", []);

    expect(spawnMock).toHaveBeenCalledWith("demo", [], {
      shell: false,
      windowsHide: true,
    });
  });

  it("routes Windows .cmd shims through a shell so Node does not reject them", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await runCommandAsString("npm", ["install", "-g", "@openai/codex"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@openai/codex"],
      expect.objectContaining({ shell: true, windowsHide: true })
    );
  });

  it("keeps native Windows executables off the shell path", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    await runCommandAsString("git", ["--version"]);

    expect(spawnMock).toHaveBeenCalledWith(
      "git",
      ["--version"],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });
});
