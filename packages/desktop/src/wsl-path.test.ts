import { describe, expect, it } from "vitest";
import { windowsWslPathToLinux } from "./wsl-path.js";

describe("windowsWslPathToLinux", () => {
  it("converts current and legacy WSL UNC paths to Linux paths", () => {
    expect(
      windowsWslPathToLinux("\\\\wsl.localhost\\Ubuntu-24.04\\home\\alice\\repo", "Ubuntu-24.04")
    ).toBe("/home/alice/repo");
    expect(windowsWslPathToLinux("\\\\wsl$\\Ubuntu-24.04", "Ubuntu-24.04")).toBe("/");
  });

  it("rejects Windows folders and folders from another distribution", () => {
    expect(() => windowsWslPathToLinux("C:\\repo", "Ubuntu-24.04")).toThrow(
      "inside the active WSL distribution"
    );
    expect(() =>
      windowsWslPathToLinux("\\\\wsl.localhost\\Debian\\home\\alice", "Ubuntu-24.04")
    ).toThrow("inside WSL: Ubuntu-24.04");
  });
});
