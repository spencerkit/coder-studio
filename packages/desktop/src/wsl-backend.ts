import type { ManagedBackendLaunch, ManagedBackendLaunchContext } from "./backend-manager.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import type { WslRuntimeCandidate } from "./wsl-runtime-store.js";

function environmentArgument(name: string, value: string): string {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new Error(`Unsafe WSL environment value: ${name}`);
  }
  return `${name}=${value}`;
}

function safeUserPathEntries(userPath: string | undefined): string[] {
  if (!userPath) return [];

  const entries: string[] = [];
  const seen = new Set<string>();
  for (const rawEntry of userPath.split(":")) {
    const entry = rawEntry.trim();
    if (
      !entry.startsWith("/") ||
      entry === "/mnt" ||
      entry.startsWith("/mnt/") ||
      entry.includes("\0") ||
      entry.includes("\n") ||
      entry.includes("\r") ||
      seen.has(entry)
    ) {
      continue;
    }
    seen.add(entry);
    entries.push(entry);
  }
  return entries;
}

export function createWslBackendLaunch(
  probe: WslDistroProbe,
  runtime: WslRuntimeCandidate,
  context: ManagedBackendLaunchContext,
  windowsCwd: string
): ManagedBackendLaunch {
  const distro = probe.target.distro;
  if (!distro) throw new Error("WSL environment has no distribution name");
  const engineRoot = `${probe.dataRoot}/engine/versions/${runtime.manifest.requiredEngineVersion}`;
  const npmPrefix = `${probe.dataRoot}/tools/npm`;
  const userPath = Array.from(
    new Set([
      `${npmPrefix}/bin`,
      `${engineRoot}/bin`,
      ...safeUserPathEntries(probe.userPath),
      `${probe.home}/.local/bin`,
      `${probe.home}/.local/share/pnpm`,
      `${probe.home}/.npm-global/bin`,
      "/usr/local/sbin",
      "/usr/local/bin",
      "/usr/sbin",
      "/usr/bin",
      "/sbin",
      "/bin",
    ])
  ).join(":");
  const env = [
    environmentArgument("PATH", userPath),
    environmentArgument("NPM_CONFIG_PREFIX", npmPrefix),
    environmentArgument("NODE_ENV", "production"),
    environmentArgument("CODER_STUDIO_LOG_FORMAT", "json"),
    environmentArgument("CODER_STUDIO_RUNTIME_DIR", `${probe.dataRoot}/runtime`),
    environmentArgument("CODER_STUDIO_DESKTOP_SECRET", context.secret),
    environmentArgument("CODER_STUDIO_DESKTOP_PORT", "0"),
    environmentArgument("CODER_STUDIO_DESKTOP_STATE_DIR", `${probe.dataRoot}/data`),
    environmentArgument("CODER_STUDIO_DESKTOP_UPLOADS_DIR", `${probe.dataRoot}/uploads`),
    environmentArgument("CODER_STUDIO_DESKTOP_APP_VERSION", runtime.manifest.runtimeVersion),
    environmentArgument("CODER_STUDIO_ENGINE_ROOT", engineRoot),
    environmentArgument(
      "CODER_STUDIO_MERMAID_RUNTIME_PATH",
      `${runtime.root}/assets/mermaid.min.js`
    ),
    environmentArgument("NODE_PATH", `${engineRoot}/node_modules`),
  ];

  return {
    command: "wsl.exe",
    args: [
      "--distribution",
      distro,
      "--cd",
      runtime.root,
      "--exec",
      "/usr/bin/env",
      ...env,
      `${engineRoot}/bin/node`,
      `${runtime.root}/${runtime.manifest.entrypoint}`,
    ],
    cwd: windowsCwd,
  };
}
