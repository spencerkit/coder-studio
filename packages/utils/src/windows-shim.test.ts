import { describe, expect, it } from "vitest";
import { shouldUseShellForCommand } from "./windows-shim.js";

describe("shouldUseShellForCommand", () => {
  it("uses a shell for pnpm on Windows because pnpm.cmd is not directly executable", () => {
    expect(shouldUseShellForCommand("pnpm", "win32")).toBe(true);
  });

  it("uses a shell for npm and npx on Windows", () => {
    expect(shouldUseShellForCommand("npm", "win32")).toBe(true);
    expect(shouldUseShellForCommand("npx", "win32")).toBe(true);
  });

  it("does not use a shell for native executables like git on Windows", () => {
    expect(shouldUseShellForCommand("git", "win32")).toBe(false);
  });

  it("does not use a shell on POSIX platforms", () => {
    expect(shouldUseShellForCommand("pnpm", "linux")).toBe(false);
    expect(shouldUseShellForCommand("pnpm", "darwin")).toBe(false);
  });

  it("matches shim names case-insensitively", () => {
    expect(shouldUseShellForCommand("NPM", "win32")).toBe(true);
    expect(shouldUseShellForCommand("Pnpm", "win32")).toBe(true);
  });
});
