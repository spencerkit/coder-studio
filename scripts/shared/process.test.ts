import { describe, expect, it } from "vitest";
import { isDirectExecution, resolveSpawnCommand, shouldUseShellForCommand } from "./process.js";

describe("isDirectExecution", () => {
  it("matches direct execution for POSIX script paths", () => {
    expect(isDirectExecution("file:///repo/scripts/dev.ts", "/repo/scripts/dev.ts")).toBe(true);
  });

  it("matches direct execution for Windows script paths", () => {
    expect(isDirectExecution("file:///C:/repo/scripts/dev.ts", "C:\\repo\\scripts\\dev.ts")).toBe(
      true
    );
  });

  it("returns false when the current module differs from argv[1]", () => {
    expect(isDirectExecution("file:///repo/scripts/build.ts", "/repo/scripts/dev.ts")).toBe(false);
  });
});

describe("resolveSpawnCommand", () => {
  it("keeps pnpm unresolved on Windows so cmd can resolve the shim", () => {
    expect(resolveSpawnCommand("pnpm", "win32")).toBe("pnpm");
  });

  it("does not rewrite native Windows executables like git", () => {
    expect(resolveSpawnCommand("git", "win32")).toBe("git");
  });

  it("leaves commands unchanged on POSIX platforms", () => {
    expect(resolveSpawnCommand("pnpm", "linux")).toBe("pnpm");
  });
});

describe("shouldUseShellForCommand", () => {
  it("uses a shell for pnpm on Windows because pnpm.cmd is not directly executable", () => {
    expect(shouldUseShellForCommand("pnpm", "win32")).toBe(true);
  });

  it("does not use a shell for native executables like git on Windows", () => {
    expect(shouldUseShellForCommand("git", "win32")).toBe(false);
  });

  it("does not use a shell on POSIX platforms", () => {
    expect(shouldUseShellForCommand("pnpm", "linux")).toBe(false);
  });
});
