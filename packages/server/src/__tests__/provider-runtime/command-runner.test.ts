import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

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
});
