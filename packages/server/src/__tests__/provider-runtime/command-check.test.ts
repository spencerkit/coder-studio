import { describe, expect, it, vi } from "vitest";
import {
  checkCommandAvailable,
  getCommandLookupExecutable,
} from "../../provider-runtime/command-check.js";

describe("getCommandLookupExecutable", () => {
  it("uses where on Windows", () => {
    expect(getCommandLookupExecutable("win32")).toBe("where");
  });

  it("uses which on darwin and linux", () => {
    expect(getCommandLookupExecutable("darwin")).toBe("which");
    expect(getCommandLookupExecutable("linux")).toBe("which");
  });
});

describe("checkCommandAvailable", () => {
  it("returns true when the lookup command succeeds", async () => {
    const execFile = vi.fn(async () => ({ stdout: "/usr/bin/codex\n", stderr: "" }));

    await expect(checkCommandAvailable("codex", { platform: "linux", execFile })).resolves.toBe(
      true
    );
    expect(execFile).toHaveBeenCalledWith("which", ["codex"]);
  });

  it("returns false when the lookup command fails", async () => {
    const execFile = vi.fn(async () => {
      throw new Error("not found");
    });

    await expect(checkCommandAvailable("claude", { platform: "win32", execFile })).resolves.toBe(
      false
    );
    expect(execFile).toHaveBeenCalledWith("where", ["claude"]);
  });
});
