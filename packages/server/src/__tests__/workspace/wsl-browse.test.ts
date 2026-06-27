import { describe, expect, it, vi } from "vitest";
import { browseWslDirectory, createWslDirectoryInDistro } from "../../workspace/wsl-browse.js";

describe("browseWslDirectory", () => {
  it("maps machine-readable WSL browse output into BrowseResult", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: [
        "OK",
        "/home/spencer",
        "/home",
        "2",
        "/",
        "/home/spencer",
        "workspace",
        "/home/spencer/workspace",
        "",
      ].join("\0"),
      stderr: "",
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "~" },
        { commandExists: async () => true, runCommand }
      )
    ).resolves.toEqual({
      currentPath: "/home/spencer",
      parentPath: "/home",
      rootPaths: ["/", "/home/spencer"],
      directories: [{ name: "workspace", path: "/home/spencer/workspace" }],
    });

    expect(runCommand).toHaveBeenCalledWith(
      "wsl",
      expect.arrayContaining(["-d", "Ubuntu-24.04", "--cd", "/", "-e", "sh", "-c"]),
      { windowsHide: true }
    );
  });

  it("maps distro lookup failures to wsl_distro_not_found", async () => {
    const runCommand = vi.fn().mockRejectedValue(
      Object.assign(new Error("WSL_E_DISTRO_NOT_FOUND"), {
        stderr: "WSL_E_DISTRO_NOT_FOUND",
      })
    );

    await expect(
      browseWslDirectory(
        { distro: "Missing-Distro", path: "/home/spencer" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "wsl_distro_not_found" });
  });

  it("rejects blank distro names before invoking wsl.exe", async () => {
    const runCommand = vi.fn();

    await expect(
      browseWslDirectory({ distro: "   " }, { commandExists: async () => true, runCommand })
    ).rejects.toMatchObject({ code: "invalid_path" });

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("returns wsl_unavailable when neither wsl nor wsl.exe exists", async () => {
    const commandExists = vi.fn().mockResolvedValue(false);
    const runCommand = vi.fn();

    await expect(
      browseWslDirectory({ distro: "Ubuntu-24.04", path: "/" }, { commandExists, runCommand })
    ).rejects.toMatchObject({ code: "wsl_unavailable" });

    expect(commandExists).toHaveBeenNthCalledWith(1, "wsl");
    expect(commandExists).toHaveBeenNthCalledWith(2, "wsl.exe");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("maps permission denied failures", async () => {
    const runCommand = vi.fn().mockRejectedValue(
      Object.assign(new Error("permission denied"), {
        stderr: "permission denied",
      })
    );

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "/root" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("maps unclassified failures to browse_failed", async () => {
    const runCommand = vi.fn().mockRejectedValue(
      Object.assign(new Error("kaboom"), {
        stderr: "unexpected failure",
      })
    );

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "/" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "browse_failed" });
  });

  it("executes through wsl when only wsl is available", async () => {
    const commandExists = vi.fn(async (command: string) => command === "wsl");
    const runCommand = vi.fn().mockImplementation(async (file: string) => {
      if (file !== "wsl") {
        throw Object.assign(new Error(`${file} not found`), { stderr: `${file} not found` });
      }

      return {
        stdout: ["OK", "/home/spencer", "/home", "2", "/", "/home/spencer", ""].join("\0"),
        stderr: "",
      };
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "/home/spencer" },
        { commandExists, runCommand }
      )
    ).resolves.toEqual({
      currentPath: "/home/spencer",
      parentPath: "/home",
      rootPaths: ["/", "/home/spencer"],
      directories: [],
    });

    expect(runCommand).toHaveBeenCalledWith(
      "wsl",
      expect.arrayContaining(["-d", "Ubuntu-24.04", "--cd", "/", "-e", "sh", "-c"]),
      { windowsHide: true }
    );
  });

  it("passes shell-sensitive path as a positional argument instead of embedding it in the script", async () => {
    const sensitivePath = "/tmp/$(touch pwned)`echo nope`$EVILVAR\tline\nnext";
    const runCommand = vi.fn().mockResolvedValue({
      stdout: ["OK", "/tmp", "/", "1", "/", ""].join("\0"),
      stderr: "",
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: sensitivePath },
        { commandExists: async () => true, runCommand }
      )
    ).resolves.toEqual({
      currentPath: "/tmp",
      parentPath: "/",
      rootPaths: ["/"],
      directories: [],
    });

    const [, args] = runCommand.mock.calls[0] as [string, string[], { windowsHide: true }];
    const script = args[7];
    expect(args.slice(0, 7)).toEqual(["-d", "Ubuntu-24.04", "--cd", "/", "-e", "sh", "-c"]);
    expect(args[8]).toBe("sh");
    expect(args[9]).toBe(sensitivePath);
    expect(script).not.toContain(sensitivePath);
    expect(script).not.toContain("touch pwned");
    expect(script).not.toContain("$EVILVAR");
    expect(script).not.toContain("`echo nope`");
  });

  it("maps malformed helper output to browse_failed", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "not-json-and-not-protocol",
      stderr: "",
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "/" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "browse_failed" });
  });

  it("maps protocol output with a non-empty trailing field to browse_failed", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: ["OK", "/tmp", "/", "1", "/", "garbage"].join("\0"),
      stderr: "",
    });

    await expect(
      browseWslDirectory(
        { distro: "Ubuntu-24.04", path: "/tmp" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "browse_failed" });
  });
});

describe("createWslDirectoryInDistro", () => {
  it("returns ok after a successful mkdir helper run", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "OK\0true\0",
      stderr: "",
    });

    await expect(
      createWslDirectoryInDistro(
        { distro: "Ubuntu-24.04", path: "/home/spencer/workspace/demo" },
        { commandExists: async () => true, runCommand }
      )
    ).resolves.toEqual({ ok: true });
  });

  it("rejects blank distro names before invoking wsl", async () => {
    const runCommand = vi.fn();

    await expect(
      createWslDirectoryInDistro(
        { distro: "   ", path: "/home/spencer/workspace/demo" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "invalid_path" });

    expect(runCommand).not.toHaveBeenCalled();
  });

  it("maps permission denied failures", async () => {
    const runCommand = vi.fn().mockRejectedValue(
      Object.assign(new Error("permission denied"), {
        stderr: "permission denied",
      })
    );

    await expect(
      createWslDirectoryInDistro(
        { distro: "Ubuntu-24.04", path: "/root/demo" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("maps malformed success output to browse_failed", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: "OK\0not-true",
      stderr: "",
    });

    await expect(
      createWslDirectoryInDistro(
        { distro: "Ubuntu-24.04", path: "/home/spencer/workspace/demo" },
        { commandExists: async () => true, runCommand }
      )
    ).rejects.toMatchObject({ code: "browse_failed" });
  });
});
