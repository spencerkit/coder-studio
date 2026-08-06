import { describe, expect, it } from "vitest";
import type { RuntimeManifest } from "./runtime-manifest.js";
import { createWslBackendLaunch } from "./wsl-backend.js";

const manifest: RuntimeManifest = {
  schemaVersion: 1,
  runtimeVersion: "0.5.6",
  minShellVersion: "0.1.0",
  requiredEngineVersion: "1",
  requiredNodeVersion: "24.19.0",
  runtimeHostApiVersion: 1,
  apiProtocolVersion: 1,
  dataSchemaVersion: 1,
  platform: "linux",
  arch: "x64",
  entrypoint: "server.mjs",
  files: [],
};

describe("createWslBackendLaunch", () => {
  it("launches the Linux Node and Server directly without interpolating a shell command", () => {
    const launch = createWslBackendLaunch(
      {
        target: {
          id: "wsl:test",
          kind: "wsl",
          label: "WSL: Ubuntu-24.04",
          distro: "Ubuntu-24.04",
        },
        home: "/home/alice",
        dataRoot: "/home/alice/.local/share/coder-studio-desktop",
        userPath:
          "/home/alice/.cargo/bin:/run/user/1000/fnm_multishells/42/bin:/mnt/c/Windows/System32:C:\\Windows\\System32:relative/bin:/usr/bin:/home/alice/.cargo/bin",
        arch: "x64",
        kernel: "microsoft-standard-WSL2",
        libc: "glibc 2.39",
        engineInstalled: true,
        installed: true,
        supported: true,
      },
      {
        root: "/home/alice/.local/share/coder-studio-desktop/runtime-store/versions/abc",
        source: "active",
        pointer: { id: "abcdefabcdefabcdefabcdef", runtimeVersion: "0.5.6", installedAt: "now" },
        manifest,
      },
      { secret: "secret-value", appVersion: "0.1.0" },
      "C:\\logs"
    );

    expect(launch.command).toBe("wsl.exe");
    expect(launch.args).toContain("--exec");
    expect(launch.args).toContain("/usr/bin/env");
    expect(launch.args).toContain("CODER_STUDIO_DESKTOP_SECRET=secret-value");
    const pathArgument = launch.args.find((argument) => argument.startsWith("PATH="));
    expect(pathArgument).toBe(
      "PATH=/home/alice/.local/share/coder-studio-desktop/engine/versions/1/bin:/home/alice/.cargo/bin:/run/user/1000/fnm_multishells/42/bin:/usr/bin:/home/alice/.local/bin:/home/alice/.local/share/pnpm:/home/alice/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:/bin"
    );
    expect(pathArgument).not.toContain("/mnt/");
    expect(pathArgument).not.toContain("C:\\Windows");
    expect(launch.args.at(-2)).toBe(
      "/home/alice/.local/share/coder-studio-desktop/engine/versions/1/bin/node"
    );
    expect(launch.args.at(-1)).toContain("/runtime-store/versions/abc/server.mjs");
    expect(launch.args).not.toContain("-c");
  });
});
