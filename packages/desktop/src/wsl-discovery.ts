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
  /** PATH reported by the user's interactive WSL shell, before safety filtering. */
  userPath?: string;
  /** `npm` resolved from the user's interactive WSL shell, when they manage their own Node. */
  userNpm?: string;
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
  // Agent CLIs are spawned directly by the Server rather than through a shell. Capture the
  // interactive shell PATH so tools managed by fnm/nvm/asdf/etc. can be inherited as well.
  // The same shell reports its own npm, which decides whether the Server defers to the user's
  // Node toolchain or falls back to the bundled Engine npm.
  // Bound rc-file execution so a broken interactive shell cannot block Desktop startup.
  'if test -x /usr/bin/timeout; then shell=${SHELL:-/bin/sh}; if test -x "$shell"; then /usr/bin/timeout 5s "$shell" -ic \'printf "\\n__CODER_STUDIO_USER_PATH__%s\\n" "$PATH"; printf "__CODER_STUDIO_USER_NPM__%s\\n" "$(command -v npm 2>/dev/null || true)"\' 2>/dev/null || true; fi; fi',
].join("; ");

const USER_PATH_MARKER = "__CODER_STUDIO_USER_PATH__";
const USER_NPM_MARKER = "__CODER_STUDIO_USER_NPM__";

function parseMarkedLine(output: string, marker: string): string | undefined {
  const markerLine = output.split(/\r?\n/).find((line) => line.startsWith(marker));
  const value = markerLine?.slice(marker.length).trim();
  return value || undefined;
}

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
    const output = result.stdout.toString("utf8");
    const [home, dataRoot, rawArch, kernel, libc, engineInstalledValue, runtimeInstalledValue] =
      output.split(/\r?\n/);
    const userPath = parseMarkedLine(output, USER_PATH_MARKER);
    const userNpm = parseMarkedLine(output, USER_NPM_MARKER);
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
        userPath,
        userNpm,
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
        userPath,
        userNpm,
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
      userPath,
      userNpm,
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
            engineVersion: probe.installed ? DESKTOP_ENGINE_VERSION : undefined,
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
