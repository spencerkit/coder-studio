import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: execFileMock,
}));

import { runGit } from "./cli.js";

describe("runGit windows child-process options", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes windowsHide to git child processes", async () => {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback: (err: Error | null, stdout: string, stderr: string) => void
      ) => {
        const child = new EventEmitter() as EventEmitter & {
          stdin: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        };
        child.stdin = {
          on: vi.fn(),
          end: vi.fn(),
        };
        callback(null, "ok", "");
        return child;
      }
    );

    await expect(runGit("/tmp/worktree", ["status"])).resolves.toEqual({ stdout: "ok", stderr: "" });

    expect(execFileMock).toHaveBeenCalledWith(
      "git",
      ["status"],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    );
  });
});
