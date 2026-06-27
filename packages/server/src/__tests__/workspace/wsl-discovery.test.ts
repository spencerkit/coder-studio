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

import { listWslDistros } from "../../workspace/wsl-discovery.js";

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

describe("listWslDistros", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("decodes UTF-16 LE distro output without a BOM", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      queueMicrotask(() => {
        child.stdout.emit(
          "data",
          Buffer.from("Ubuntu-24.04\r\nopenSUSE-Tumbleweed\r\n", "utf16le")
        );
        child.emit("close", 0);
      });
      return child;
    });

    await expect(listWslDistros({ commandExists: async () => true })).resolves.toEqual([
      "Ubuntu-24.04",
      "openSUSE-Tumbleweed",
    ]);
  });

  it("decodes UTF-16 LE distro output with a BOM", async () => {
    spawnMock.mockImplementation(() => {
      const child = createChildProcessMock();
      queueMicrotask(() => {
        const body = Buffer.from("Ubuntu-24.04\r\n", "utf16le");
        child.stdout.emit("data", Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
        child.emit("close", 0);
      });
      return child;
    });

    await expect(listWslDistros({ commandExists: async () => true })).resolves.toEqual([
      "Ubuntu-24.04",
    ]);
  });
});
