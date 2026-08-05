import { createWslEnvironmentTarget, NATIVE_ENVIRONMENT } from "./environment-state.js";
import type { DesktopEnvironmentSummary, DesktopEnvironmentTarget } from "./protocol.js";
import { DESKTOP_ENGINE_VERSION, DESKTOP_NODE_VERSION } from "./runtime-manifest.js";
import {
  decodeWindowsConsoleOutput,
  runWslCommand,
  runWslCommandChecked,
  type WslCommandRunner,
} from "./wsl-command.js";

export interface WslDistroProbe {
  target: DesktopEnvironmentTarget;
  home: string;
  dataRoot: string;
  arch: "x64" | "arm64";
  kernel: string;
  libc: string;
  engineInstalled: boolean;
  installed: boolean;
  supported: boolean;
  message?: string;
}

const PROBE_SCRIPT = [
  "set -eu",
  "home=${HOME:?}",
  'data_root=${XDG_DATA_HOME:-"$home/.local/share"}/coder-studio-desktop',
  "arch=$(uname -m)",
  "kernel=$(uname -r)",
  "libc=$(getconf GNU_LIBC_VERSION 2>/dev/null || true)",
  "engine_installed=false",
  `engine_node="$data_root/engine/versions/${DESKTOP_ENGINE_VERSION}/bin/node"`,
  `if test -x "$engine_node" && test "$("$engine_node" -p 'process.versions.node' 2>/dev/null || true)" = "${DESKTOP_NODE_VERSION}"; then engine_installed=true; fi`,
  "runtime_installed=false",
  'if test -f "$data_root/runtime-store/active.json"; then runtime_installed=true; fi',
  'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$home" "$data_root" "$arch" "$kernel" "$libc"',
  'printf "%s\\n%s\\n" "$engine_installed" "$runtime_installed"',
].join("; ");

function parseDistroList(output: Buffer): string[] {
  return decodeWindowsConsoleOutput(output)
    .split(/\r?\n/)
    .map((line) => line.replace(/\0/g, "").trim())
    .filter(Boolean);
}

function normalizeArch(value: string): "x64" | "arm64" | null {
  if (value === "x86_64" || value === "amd64") return "x64";
  if (value === "aarch64" || value === "arm64") return "arm64";
  return null;
}

export class WslDiscovery {
  constructor(
    private readonly options: {
      runner?: WslCommandRunner;
      platform?: NodeJS.Platform;
    } = {}
  ) {}

  async listDistros(): Promise<string[]> {
    if ((this.options.platform ?? process.platform) !== "win32") return [];
    try {
      const result = await runWslCommandChecked(
        ["--list", "--quiet"],
        undefined,
        this.options.runner ?? runWslCommand
      );
      return parseDistroList(result.stdout);
    } catch {
      return [];
    }
  }

  async probe(distro: string): Promise<WslDistroProbe> {
    const result = await runWslCommandChecked(
      ["--distribution", distro, "--exec", "/bin/sh", "-c", PROBE_SCRIPT],
      undefined,
      this.options.runner ?? runWslCommand
    );
    const [home, dataRoot, rawArch, kernel, libc, engineInstalledValue, runtimeInstalledValue] =
      result.stdout.toString("utf8").split(/\r?\n/);
    const engineInstalled = engineInstalledValue?.trim() === "true";
    const runtimeInstalled = runtimeInstalledValue?.trim() === "true";
    const arch = normalizeArch(rawArch?.trim() ?? "");
    const isWsl2 = (kernel ?? "").toLowerCase().includes("wsl2");
    const isGlibc = (libc ?? "").toLowerCase().startsWith("glibc");
    const target = createWslEnvironmentTarget(distro);
    if (!home?.trim() || !dataRoot?.trim() || !arch) {
      return {
        target,
        home: home?.trim() ?? "",
        dataRoot: dataRoot?.trim() ?? "",
        arch: arch ?? "x64",
        kernel: kernel?.trim() ?? "",
        libc: libc?.trim() ?? "",
        engineInstalled,
        installed: false,
        supported: false,
        message: "Coder Studio requires an x64 or arm64 WSL2 distribution.",
      };
    }
    if (!isWsl2 || !isGlibc) {
      return {
        target,
        home: home.trim(),
        dataRoot: dataRoot.trim(),
        arch,
        kernel: kernel?.trim() ?? "",
        libc: libc?.trim() ?? "",
        engineInstalled,
        installed: engineInstalled && runtimeInstalled,
        supported: false,
        message: !isWsl2
          ? "Coder Studio requires WSL2."
          : "Coder Studio currently requires a glibc-based WSL distribution.",
      };
    }
    return {
      target,
      home: home.trim(),
      dataRoot: dataRoot.trim(),
      arch,
      kernel: kernel?.trim() ?? "",
      libc: libc?.trim() ?? "",
      engineInstalled,
      installed: engineInstalled && runtimeInstalled,
      supported: true,
    };
  }

  async listEnvironments(activeEnvironmentId: string): Promise<DesktopEnvironmentSummary[]> {
    const native: DesktopEnvironmentSummary = {
      ...NATIVE_ENVIRONMENT,
      active: activeEnvironmentId === NATIVE_ENVIRONMENT.id,
      status: "ready",
      platform: "win32",
      arch: process.arch,
    };
    const distros = await this.listDistros();
    const probes = await Promise.all(
      distros.map(async (distro): Promise<DesktopEnvironmentSummary> => {
        const target = createWslEnvironmentTarget(distro);
        try {
          const probe = await this.probe(distro);
          return {
            ...target,
            active: activeEnvironmentId === target.id,
            status: !probe.supported ? "unavailable" : probe.installed ? "ready" : "not-installed",
            platform: "linux",
            arch: probe.arch,
            engineVersion: probe.installed ? "1" : undefined,
            message: probe.message,
          };
        } catch (error) {
          return {
            ...target,
            active: activeEnvironmentId === target.id,
            status: "error",
            platform: "linux",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      })
    );
    return [native, ...probes];
  }
}
