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
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "/usr/bin/codex\n",
        stderr: "",
      })
    );

    await expect(
      checkCommandAvailable("codex", { platform: "linux", runCommand: execFile })
    ).resolves.toBe(true);
    expect(execFile).toHaveBeenCalledWith("which", ["codex"], { windowsHide: true });
  });

  it("returns false when the lookup command fails", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => {
        throw new Error("not found");
      }
    );

    await expect(
      checkCommandAvailable("claude", { platform: "win32", runCommand: execFile })
    ).resolves.toBe(false);
    expect(execFile).toHaveBeenCalledWith("where", ["claude"], { windowsHide: true });
  });

  it("passes windowsHide to Windows lookups", async () => {
    const execFile = vi.fn(
      async (_file: string, _args: string[], _options?: { windowsHide: boolean }) => ({
        stdout: "C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\codex.exe\r\n",
        stderr: "",
      })
    );

    await expect(
      checkCommandAvailable("codex", { platform: "win32", runCommand: execFile })
    ).resolves.toBe(true);

    expect(execFile).toHaveBeenCalledWith("where", ["codex"], { windowsHide: true });
  });

  it("checks the filesystem directly for absolute Windows paths instead of invoking where", async () => {
    // `where.exe` rejects `C:\...` arguments with "invalid pattern" because it
    // parses the first colon as a path:pattern separator. Make sure we never
    // hand absolute paths to it.
    const execFile = vi.fn();
    const absolutePath = "C:\\tools\\lsp\\vue\\node_modules\\.bin\\vue-language-server.cmd";

    await expect(
      checkCommandAvailable(absolutePath, {
        platform: "win32",
        runCommand: execFile,
        existsSync: (file) => file === absolutePath,
      })
    ).resolves.toBe(true);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("returns false for absolute Windows paths that do not exist on disk", async () => {
    const execFile = vi.fn();

    await expect(
      checkCommandAvailable("C:\\tools\\missing.cmd", {
        platform: "win32",
        runCommand: execFile,
        existsSync: () => false,
        pathExt: ".CMD;.EXE",
      })
    ).resolves.toBe(false);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("appends PATHEXT extensions when an absolute Windows path has no extension", async () => {
    const execFile = vi.fn();
    const baseline = "C:\\tools\\bin\\vue-language-server";
    const resolved = `${baseline}.CMD`;

    await expect(
      checkCommandAvailable(baseline, {
        platform: "win32",
        runCommand: execFile,
        existsSync: (file) => file === resolved,
        pathExt: ".EXE;.CMD",
      })
    ).resolves.toBe(true);

    expect(execFile).not.toHaveBeenCalled();
  });

  it("checks the filesystem directly for absolute POSIX paths", async () => {
    const execFile = vi.fn();
    const absolutePath = "/opt/coder-studio/lsp-tools/go/bin/gopls";

    await expect(
      checkCommandAvailable(absolutePath, {
        platform: "linux",
        runCommand: execFile,
        existsSync: (file) => file === absolutePath,
      })
    ).resolves.toBe(true);

    expect(execFile).not.toHaveBeenCalled();
  });
});
