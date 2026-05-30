import { describe, expect, it, vi } from "vitest";
import { resolveManagedPythonCommand } from "./definitions.js";

describe("resolveManagedPythonCommand", () => {
  it("returns the first available candidate on POSIX hosts without probing", async () => {
    const commandExists = vi.fn(async (cmd: string) => cmd === "python3");
    const runCommand = vi.fn();

    await expect(
      resolveManagedPythonCommand(commandExists, "linux", runCommand as never)
    ).resolves.toBe("python3");
    // POSIX hosts do not have Microsoft Store stubs; the helper must NOT
    // execute the candidate just to check the version.
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns null when no candidate is on PATH", async () => {
    await expect(
      resolveManagedPythonCommand(
        vi.fn(async () => false),
        "linux"
      )
    ).resolves.toBeNull();
  });

  it("on Windows, rejects a candidate whose `--version` prints nothing (Store stub)", async () => {
    // Windows ships zero-byte App Execution Aliases for `python` /
    // `python3`. `where.exe` reports them as present, but invoking them
    // silently exits with empty stdout/stderr because Python is not
    // actually installed.
    const commandExists = vi.fn(async () => true);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(
      resolveManagedPythonCommand(commandExists, "win32", runCommand)
    ).resolves.toBeNull();
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenCalledWith(
      "python3",
      ["--version"],
      expect.objectContaining({ windowsHide: true })
    );
    expect(runCommand).toHaveBeenCalledWith(
      "python",
      ["--version"],
      expect.objectContaining({ windowsHide: true })
    );
  });

  it("on Windows, accepts a candidate whose --version prints output on stdout", async () => {
    const commandExists = vi.fn(async () => true);
    const runCommand = vi.fn(async () => ({ stdout: "Python 3.12.0\n", stderr: "" }));

    await expect(resolveManagedPythonCommand(commandExists, "win32", runCommand)).resolves.toBe(
      "python3"
    );
  });

  it("on Windows, accepts a candidate whose --version prints to stderr (older Pythons)", async () => {
    // Pythons < 3.4 print the version banner to stderr instead of stdout.
    const commandExists = vi.fn(async () => true);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "Python 2.7.18\n" }));

    await expect(resolveManagedPythonCommand(commandExists, "win32", runCommand)).resolves.toBe(
      "python3"
    );
  });

  it("on Windows, falls through to the next candidate when the first one's probe fails to spawn", async () => {
    const commandExists = vi.fn(async () => true);
    const runCommand = vi.fn(async (file: string) => {
      if (file === "python3") {
        // simulate spawn failure (file is a stub that can't be executed)
        throw new Error("spawn python3 ENOENT");
      }
      return { stdout: "Python 3.12.0\n", stderr: "" };
    });

    await expect(resolveManagedPythonCommand(commandExists, "win32", runCommand)).resolves.toBe(
      "python"
    );
  });

  it("on Windows, returns null when both candidates are stubs that print nothing", async () => {
    const commandExists = vi.fn(async () => true);
    const runCommand = vi.fn(async () => ({ stdout: "", stderr: "" }));

    await expect(
      resolveManagedPythonCommand(commandExists, "win32", runCommand)
    ).resolves.toBeNull();
  });
});
