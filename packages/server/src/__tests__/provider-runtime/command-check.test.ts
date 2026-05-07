import { describe, expect, it, vi } from "vitest";
import {
  checkCommandAvailable,
  getCommandLookupExecutable,
  resolveCommand,
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
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "/usr/bin/codex\n",
        stderr: "",
      })
    );

    await expect(checkCommandAvailable("codex", { platform: "linux", execFile })).resolves.toBe(
      true
    );
    expect(execFile).toHaveBeenCalledWith("which", ["codex"], { windowsHide: true });
  });

  it("returns false when the lookup command fails", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => {
        throw new Error("not found");
      }
    );

    await expect(checkCommandAvailable("claude", { platform: "win32", execFile })).resolves.toBe(
      false
    );
    expect(execFile).toHaveBeenCalledWith("where", ["claude"], { windowsHide: true });
  });

  it("passes windowsHide to Windows lookups", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\codex.exe\r\n",
        stderr: "",
      })
    );

    await expect(checkCommandAvailable("codex", { platform: "win32", execFile })).resolves.toBe(
      true
    );

    expect(execFile).toHaveBeenCalledWith("where", ["codex"], { windowsHide: true });
  });
});

describe("resolveCommand", () => {
  it("returns the first resolved executable path from command lookup output", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "C:\\npm\\npm.cmd\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n",
        stderr: "",
      })
    );

    await expect(resolveCommand("npm", { platform: "win32", execFile })).resolves.toEqual({
      command: "npm",
      executable: "C:\\npm\\npm.cmd",
    });
    expect(execFile).toHaveBeenCalledWith("where", ["npm"], { windowsHide: true });
  });
});
