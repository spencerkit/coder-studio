import { describe, expect, it } from "vitest";
import { isDirectExecution, resolveSpawnCommand } from "./process.js";

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
  it("uses pnpm.cmd on Windows so spawn works without a shell", () => {
    expect(resolveSpawnCommand("pnpm", "win32")).toBe("pnpm.cmd");
  });

  it("does not rewrite native Windows executables like git", () => {
    expect(resolveSpawnCommand("git", "win32")).toBe("git");
  });

  it("leaves commands unchanged on POSIX platforms", () => {
    expect(resolveSpawnCommand("pnpm", "linux")).toBe("pnpm");
  });
});
