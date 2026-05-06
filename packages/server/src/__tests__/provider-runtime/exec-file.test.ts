import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

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

import { execFileAsString } from "../../provider-runtime/exec-file.js";

describe("execFileAsString", () => {
  it("normalizes Buffer stdout and stderr to strings", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: { windowsHide?: boolean } | undefined,
        callback: (
          error: Error | null,
          result: {
            stdout: Buffer;
            stderr: Buffer;
          }
        ) => void
      ) => {
        callback(null, {
          stdout: Buffer.from("ok\n"),
          stderr: Buffer.from("warn\n"),
        });
        return {} as ReturnType<typeof execFileMock>;
      }
    );

    const result = await execFileAsString("demo", ["--version"], { windowsHide: true });

    expect(result).toEqual({ stdout: "ok\n", stderr: "warn\n" });
  });
});
