import { describe, expect, it, vi } from "vitest";
import type { WslCommandRunner } from "./wsl-command.js";
import { WSL_PROBE_SCRIPT, WslDiscovery } from "./wsl-discovery.js";

function result(stdout: string | Buffer, exitCode = 0) {
  return {
    stdout: typeof stdout === "string" ? Buffer.from(stdout) : stdout,
    stderr: Buffer.alloc(0),
    exitCode,
  };
}

describe("WslDiscovery", () => {
  it("isolates interactive shell probe output from inherited WSL pipes", () => {
    expect(WSL_PROBE_SCRIPT).toContain('probe_file="/tmp/coder-studio-shell-probe-$$"');
    expect(WSL_PROBE_SCRIPT).toContain("/usr/bin/timeout --kill-after=1s 5s");
    expect(WSL_PROBE_SCRIPT).toContain('>"$probe_file" 2>/dev/null');
    expect(WSL_PROBE_SCRIPT).toContain('cat "$probe_file"');
    expect(WSL_PROBE_SCRIPT).toContain('rm -f "$probe_file"');
  });

  it("decodes Windows UTF-16 distro output", async () => {
    const runner = vi
      .fn<WslCommandRunner>()
      .mockResolvedValue(result(Buffer.from("Ubuntu-24.04\r\nDebian\r\n", "utf16le")));
    const discovery = new WslDiscovery({ runner, platform: "win32" });

    await expect(discovery.listDistros()).resolves.toEqual(["Ubuntu-24.04", "Debian"]);
  });

  it("reports a ready glibc WSL2 environment", async () => {
    const runner = vi
      .fn<WslCommandRunner>()
      .mockResolvedValue(
        result(
          [
            "/home/alice",
            "/home/alice/.local/share/coder-studio-desktop",
            "x86_64",
            "5.15.153.1-microsoft-standard-WSL2",
            "glibc 2.39",
            "true",
            "true",
            "shell startup noise",
            "__CODER_STUDIO_USER_PATH__/home/alice/.cargo/bin:/run/user/1000/fnm_multishells/42/bin:/mnt/c/Windows/System32:/usr/bin",
            "",
          ].join("\n")
        )
      );
    const discovery = new WslDiscovery({ runner, platform: "win32" });

    await expect(discovery.probe("Ubuntu-24.04")).resolves.toMatchObject({
      arch: "x64",
      engineInstalled: true,
      installed: true,
      supported: true,
      userPath:
        "/home/alice/.cargo/bin:/run/user/1000/fnm_multishells/42/bin:/mnt/c/Windows/System32:/usr/bin",
    });
  });

  it("rejects WSL1 and musl environments", async () => {
    const runner = vi
      .fn<WslCommandRunner>()
      .mockResolvedValueOnce(
        result(
          [
            "/home/alice",
            "/tmp/coder-studio",
            "x86_64",
            "4.4.0-microsoft",
            "glibc 2.31",
            "false",
            "false",
            "",
          ].join("\n")
        )
      )
      .mockResolvedValueOnce(
        result(
          [
            "/home/alice",
            "/tmp/coder-studio",
            "x86_64",
            "5.15.153.1-microsoft-standard-WSL2",
            "musl 1.2.5",
            "false",
            "false",
            "",
          ].join("\n")
        )
      );
    const discovery = new WslDiscovery({ runner, platform: "win32" });

    await expect(discovery.probe("Legacy")).resolves.toMatchObject({
      supported: false,
      message: "Coder Studio requires WSL2.",
    });
    await expect(discovery.probe("Alpine")).resolves.toMatchObject({
      supported: false,
      message: "Coder Studio currently requires a glibc-based WSL distribution.",
    });
  });

  it("detects arm64 distributions but keeps them unavailable until release assets exist", async () => {
    const runner = vi
      .fn<WslCommandRunner>()
      .mockResolvedValue(
        result(
          [
            "/home/alice",
            "/home/alice/.local/share/coder-studio-desktop",
            "aarch64",
            "5.15.153.1-microsoft-standard-WSL2",
            "glibc 2.39",
            "false",
            "false",
            "",
          ].join("\n")
        )
      );
    const discovery = new WslDiscovery({ runner, platform: "win32" });

    await expect(discovery.probe("Ubuntu-ARM")).resolves.toMatchObject({
      arch: "arm64",
      supported: false,
      message: "Coder Studio currently supports x64 WSL2 distributions only.",
    });
  });
});
