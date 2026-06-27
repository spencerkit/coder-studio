import type { CustomTerminalProfile } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTerminalProfiles } from "../detect.js";
import { listTerminalProfiles, resolveTerminalLaunch } from "../registry.js";

const customProfiles: CustomTerminalProfile[] = [
  {
    id: "custom:node-shell",
    label: "Node Shell",
    command: "node",
    args: ["--interactive"],
    icon: "terminal",
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("detectTerminalProfiles", () => {
  it("uses ComSpec for cmd detection instead of shellPath on Windows", async () => {
    vi.stubEnv("ComSpec", "C:\\Windows\\System32\\cmd.exe");

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      shellPath: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      commandExists: async (command) => command === "C:\\Windows\\System32\\cmd.exe",
    });

    expect(profiles).toContainEqual(
      expect.objectContaining({
        id: "detected:win:cmd",
        argv: ["C:\\Windows\\System32\\cmd.exe"],
      })
    );
  });

  it("uses the resolved Git Bash path from PATH on Windows", async () => {
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");

    const runCommand = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean }) => {
        if (file === "where" && args[0] === "bash") {
          return {
            stdout: "C:\\Program Files\\Git\\bin\\bash.exe\r\n",
            stderr: "",
          };
        }

        throw new Error(`missing: ${file} ${args.join(" ")}`);
      }
    );

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      runCommand,
    });

    expect(profiles).toContainEqual(
      expect.objectContaining({
        id: "detected:win:git-bash",
        argv: ["C:\\Program Files\\Git\\bin\\bash.exe"],
      })
    );
  });

  it("does not treat the WSL bash shim as Git Bash on Windows", async () => {
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");

    const runCommand = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean }) => {
        if (file === "where" && args[0] === "bash") {
          return {
            stdout: "C:\\Windows\\System32\\bash.exe\r\n",
            stderr: "",
          };
        }

        throw new Error(`missing: ${file} ${args.join(" ")}`);
      }
    );

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      runCommand,
    });

    expect(profiles.find((profile) => profile.id === "detected:win:git-bash")).toBeUndefined();
  });

  it("does not treat non-Git bash implementations as Git Bash on Windows", async () => {
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");

    const runCommand = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean }) => {
        if (file === "where" && args[0] === "bash") {
          return {
            stdout: "C:\\msys64\\usr\\bin\\bash.exe\r\n",
            stderr: "",
          };
        }

        throw new Error(`missing: ${file} ${args.join(" ")}`);
      }
    );

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      runCommand,
    });

    expect(profiles.find((profile) => profile.id === "detected:win:git-bash")).toBeUndefined();
  });

  it("detects Git Bash from known Git for Windows install paths when bash is not on PATH", async () => {
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");
    vi.stubEnv("ProgramFiles", "C:\\Program Files");
    vi.stubEnv("ProgramFiles(x86)", "C:\\Program Files (x86)");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\spencer\\AppData\\Local");

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      commandExists: async () => false,
      existsSync: (file) => file === "C:\\Program Files\\Git\\bin\\bash.exe",
    });

    expect(profiles).toContainEqual(
      expect.objectContaining({
        id: "detected:win:git-bash",
        argv: ["C:\\Program Files\\Git\\bin\\bash.exe"],
      })
    );
  });

  it("labels detected WSL distros with a WSL suffix", async () => {
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");

    const runCommand = vi.fn(
      async (file: string, args: string[], options?: { windowsHide: boolean; cwd?: string }) => {
        if (file === "where" && args[0] === "wsl") {
          return {
            stdout: "C:\\Windows\\System32\\wsl.exe\r\n",
            stderr: "",
          };
        }

        if (file === "wsl.exe" && args[0] === "-l" && args[1] === "-q") {
          return {
            stdout: "Ubuntu-24.04\r\n",
            stderr: "",
          };
        }

        throw new Error(`missing: ${file} ${args.join(" ")}`);
      }
    );

    const profiles = await detectTerminalProfiles({
      platform: "win32",
      runCommand,
    });

    expect(profiles).toContainEqual(
      expect.objectContaining({
        id: "detected:win:wsl:Ubuntu-24.04",
        label: "Ubuntu-24.04 (WSL)",
        argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
      })
    );
    expect(runCommand).toHaveBeenCalledWith(
      "wsl.exe",
      ["-l", "-q"],
      expect.objectContaining({
        windowsHide: true,
        cwd: process.cwd(),
      })
    );
  });

  it("detects WSL distros from a host-safe cwd when the server cwd is a WSL share", async () => {
    const originalCwd = process.cwd;
    vi.stubEnv("ComSpec", "");
    vi.stubEnv("COMSPEC", "");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\spencer\\AppData\\Local");
    process.cwd = () => "\\\\wsl$\\Ubuntu-24.04\\home\\spencer\\workspace\\coder-studio";

    const runCommand = vi.fn(
      async (file: string, args: string[], _options?: { windowsHide: boolean; cwd?: string }) => {
        if (file === "where" && args[0] === "wsl") {
          return {
            stdout: "C:\\Windows\\System32\\wsl.exe\r\n",
            stderr: "",
          };
        }

        if (file === "wsl.exe" && args[0] === "-l" && args[1] === "-q") {
          return {
            stdout: "Ubuntu-24.04\r\n",
            stderr: "",
          };
        }

        throw new Error(`missing: ${file} ${args.join(" ")}`);
      }
    );

    try {
      const profiles = await detectTerminalProfiles({
        platform: "win32",
        runCommand,
      });

      expect(profiles).toContainEqual(
        expect.objectContaining({
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04 (WSL)",
        })
      );
      expect(runCommand).toHaveBeenCalledWith(
        "wsl.exe",
        ["-l", "-q"],
        expect.objectContaining({
          windowsHide: true,
          cwd: "C:\\Users\\spencer\\AppData\\Local\\Temp",
        })
      );
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe("terminal profile registry", () => {
  it("keeps the configured default id while resolving a fallback available profile", async () => {
    const result = await listTerminalProfiles({
      platform: "linux",
      shellPath: "/bin/zsh",
      configuredDefaultProfileId: "detected:win:powershell",
      customProfiles,
      detectProfiles: async () => [
        {
          id: "detected:posix:zsh",
          label: "zsh",
          source: "detected",
          runtime: "native",
          icon: "terminal",
          argv: ["/bin/zsh", "-i"],
          cwdRuntime: "native",
        },
      ],
    });

    expect(result.configuredDefaultProfileId).toBe("detected:win:powershell");
    expect(result.resolvedDefaultProfileId).toBe("detected:posix:zsh");
    expect(result.profiles.map((profile) => profile.id)).toEqual([
      "detected:posix:zsh",
      "custom:node-shell",
    ]);
  });

  it("throws for an explicitly requested unavailable profile instead of silently falling back", async () => {
    await expect(
      resolveTerminalLaunch({
        platform: "linux",
        shellPath: "/bin/zsh",
        configuredDefaultProfileId: "detected:posix:zsh",
        requestedProfileId: "detected:win:pwsh",
        customProfiles: [],
        workspacePath: "/repo/app",
        detectProfiles: async () => [
          {
            id: "detected:posix:zsh",
            label: "zsh",
            source: "detected",
            runtime: "native",
            icon: "terminal",
            argv: ["/bin/zsh", "-i"],
            cwdRuntime: "native",
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "terminal_profile_unavailable",
      message: "Terminal profile unavailable: detected:win:pwsh",
    });
  });

  it("builds a WSL launch spec with mapped cwd when the workspace is on a Windows drive", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "C:\\repo\\app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.title).toBe("Ubuntu-24.04 (WSL)");
    expect(launch.argv).toEqual(["wsl.exe", "-d", "Ubuntu-24.04", "--cd", "/mnt/c/repo/app"]);
    expect(launch.cwd).toBe("C:\\repo\\app");
    expect(launch.profileId).toBe("detected:win:wsl:Ubuntu-24.04");
  });

  it("normalizes WSL profile labels in list results", async () => {
    const result = await listTerminalProfiles({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(result.profiles[0]?.label).toBe("Ubuntu-24.04 (WSL)");
  });

  it("converts matching WSL UNC workspace paths into explicit Linux --cd targets", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "\\\\wsl$\\Ubuntu-24.04\\repo\\app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.title).toBe("Ubuntu-24.04 (WSL)");
    expect(launch.argv).toEqual(["wsl.exe", "-d", "Ubuntu-24.04", "--cd", "/repo/app"]);
    expect(launch.cwd).toBe("\\\\wsl$\\Ubuntu-24.04\\repo\\app");
  });

  it("passes a Linux workspace path through to WSL profiles as an explicit --cd target", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "/home/spencer/workspace/my app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.title).toBe("Ubuntu-24.04 (WSL)");
    expect(launch.argv).toEqual([
      "wsl.exe",
      "-d",
      "Ubuntu-24.04",
      "--cd",
      "/home/spencer/workspace/my app",
    ]);
    expect(launch.cwd).toBe("/home/spencer/workspace/my app");
  });

  it("falls back to the distro home when a WSL UNC path points to a different distro", async () => {
    const launch = await resolveTerminalLaunch({
      platform: "win32",
      configuredDefaultProfileId: "detected:win:wsl:Ubuntu-24.04",
      workspacePath: "\\\\wsl$\\Debian\\home\\spencer\\workspace\\my app",
      customProfiles: [],
      detectProfiles: async () => [
        {
          id: "detected:win:wsl:Ubuntu-24.04",
          label: "Ubuntu-24.04",
          source: "detected",
          runtime: "wsl",
          icon: "terminal",
          argv: ["wsl.exe", "-d", "Ubuntu-24.04"],
          cwdRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
    });

    expect(launch.title).toBe("Ubuntu-24.04 (WSL)");
    expect(launch.argv).toEqual(["wsl.exe", "-d", "Ubuntu-24.04"]);
    expect(launch.cwd).toBe("\\\\wsl$\\Debian\\home\\spencer\\workspace\\my app");
  });
});
