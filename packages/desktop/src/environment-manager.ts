import { EnvironmentStateStore, NATIVE_ENVIRONMENT } from "./environment-state.js";
import type {
  DesktopEnvironmentProgress,
  DesktopEnvironmentSummary,
  DesktopEnvironmentTarget,
} from "./protocol.js";
import {
  API_PROTOCOL_VERSION,
  compareVersions,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  RUNTIME_HOST_API_VERSION,
  type RuntimeManifest,
} from "./runtime-manifest.js";
import type { RuntimeUpdateAdapter } from "./runtime-update-manager.js";
import type { WslCommandRunner } from "./wsl-command.js";
import { WslDiscovery, type WslDistroProbe } from "./wsl-discovery.js";
import { WslInstaller } from "./wsl-installer.js";
import { type WslRuntimeCandidate, WslRuntimeStoreClient } from "./wsl-runtime-store.js";
import { WslRuntimeUpdateAdapter } from "./wsl-runtime-update-adapter.js";

export interface PreparedWslEnvironment {
  probe: WslDistroProbe;
  runtimeStore: WslRuntimeStoreClient;
  runtime: WslRuntimeCandidate;
}

export interface DesktopEnvironmentManagerOptions {
  stateStore: EnvironmentStateStore;
  discovery: WslDiscovery;
  shellVersion: string;
  nodeVersion: string;
  runtimeVersion: string;
  publicKeyPem: string;
  releaseBaseUrl: string;
  enableWsl?: boolean;
  fetch?: typeof fetch;
  wslRunner?: WslCommandRunner;
  nativeRuntimeUpdateAdapter?: RuntimeUpdateAdapter;
  onProgress?: (progress: DesktopEnvironmentProgress) => void;
}

export class DesktopEnvironmentManager {
  private activeTarget: DesktopEnvironmentTarget = NATIVE_ENVIRONMENT;

  constructor(private readonly options: DesktopEnvironmentManagerOptions) {}

  async getStartupTarget(): Promise<DesktopEnvironmentTarget> {
    return this.options.stateStore.getStartupTarget();
  }

  setActiveTarget(target: DesktopEnvironmentTarget): void {
    this.activeTarget = target;
  }

  async listEnvironments(): Promise<DesktopEnvironmentSummary[]> {
    if (this.options.enableWsl === false) {
      return [
        {
          ...NATIVE_ENVIRONMENT,
          active: true,
          status: "ready",
          platform: "win32",
          arch: process.arch,
        },
      ];
    }
    return this.options.discovery.listEnvironments(this.activeTarget.id);
  }

  async getActiveEnvironment(): Promise<DesktopEnvironmentSummary> {
    const environments = await this.listEnvironments();
    return (
      environments.find((environment) => environment.id === this.activeTarget.id) ?? {
        ...this.activeTarget,
        active: true,
        status: "error",
        platform: this.activeTarget.kind === "wsl" ? "linux" : "win32",
        message: "The selected environment is no longer available.",
      }
    );
  }

  async resolveTarget(environmentId: string): Promise<DesktopEnvironmentTarget> {
    const environment = (await this.listEnvironments()).find((entry) => entry.id === environmentId);
    if (!environment) throw new Error(`Unknown Desktop environment: ${environmentId}`);
    if (environment.status === "unavailable" || environment.status === "error") {
      throw new Error(environment.message ?? `${environment.label} is unavailable`);
    }
    if (environment.kind === "native") return NATIVE_ENVIRONMENT;
    if (!environment.distro) throw new Error(`${environment.label} has no WSL distribution name`);
    return {
      id: environment.id,
      kind: "wsl",
      label: environment.label,
      distro: environment.distro,
    };
  }

  async prepareWsl(target: DesktopEnvironmentTarget): Promise<PreparedWslEnvironment> {
    if (target.kind !== "wsl" || !target.distro) {
      throw new Error("The selected environment is not a WSL distribution");
    }
    this.emit(target.id, "checking", `Checking ${target.label}…`);
    const probe = await this.options.discovery.probe(target.distro);
    if (!probe.supported) throw new Error(probe.message ?? `${target.label} is unsupported`);
    const runtimeStore = new WslRuntimeStoreClient({ probe });
    const existing = await runtimeStore.getLaunchCandidate().catch(() => null);
    if (existing && this.isRuntimeCompatible(existing.manifest)) {
      return { probe, runtimeStore, runtime: existing };
    }

    const installer = new WslInstaller({
      publicKeyPem: this.options.publicKeyPem,
      shellVersion: this.options.shellVersion,
      nodeVersion: this.options.nodeVersion,
      runtimeVersion: this.options.runtimeVersion,
      engineManifestUrl: (arch) =>
        new URL(
          `coder-studio-engine-linux-${arch}.manifest.json`,
          this.options.releaseBaseUrl
        ).toString(),
      runtimeManifestUrl: (arch) =>
        new URL(
          `coder-studio-server-runtime-linux-${arch}.manifest.json`,
          this.options.releaseBaseUrl
        ).toString(),
      onProgress: (progress) =>
        this.emit(target.id, progress.phase, progress.message, progress.percent),
    });
    await installer.prepare(probe);
    const installed = await runtimeStore.getLaunchCandidate();
    if (!this.isRuntimeCompatible(installed.manifest)) {
      throw new Error(
        `WSL Runtime ${installed.manifest.runtimeVersion} does not match shared Web ${this.options.runtimeVersion}`
      );
    }
    return { probe, runtimeStore, runtime: installed };
  }

  async createRuntimeUpdateAdapter(
    target: "win32-x64" | "linux-x64",
    environmentId: string
  ): Promise<RuntimeUpdateAdapter> {
    const environment = (await this.listEnvironments()).find((entry) => entry.id === environmentId);
    if (!environment) throw new Error(`Unknown Desktop environment: ${environmentId}`);
    if (environment.status !== "ready") {
      throw new Error(environment.message ?? `${environment.label} is unavailable`);
    }
    if (environment.kind === "native") {
      if (target !== "win32-x64") {
        throw new Error(`Runtime target ${target} does not match the native environment`);
      }
      if (!this.options.nativeRuntimeUpdateAdapter) {
        throw new Error("The native Runtime update adapter is not configured");
      }
      return this.options.nativeRuntimeUpdateAdapter;
    }
    if (target !== "linux-x64" || environment.arch !== "x64") {
      throw new Error(`Runtime target ${target} does not match ${environment.label}`);
    }
    if (!environment.distro) throw new Error(`${environment.label} has no WSL distribution name`);
    const probe = await this.options.discovery.probe(environment.distro);
    if (!probe.supported || probe.arch !== "x64") {
      throw new Error(probe.message ?? `${environment.label} is unsupported`);
    }
    const runtimeStore = new WslRuntimeStoreClient({
      probe,
      runner: this.options.wslRunner,
    });
    const installer = new WslInstaller({
      publicKeyPem: this.options.publicKeyPem,
      shellVersion: this.options.shellVersion,
      nodeVersion: this.options.nodeVersion,
      runtimeVersion: this.options.runtimeVersion,
      engineManifestUrl: (arch) =>
        new URL(
          `coder-studio-engine-linux-${arch}.manifest.json`,
          this.options.releaseBaseUrl
        ).toString(),
      runtimeManifestUrl: (arch) =>
        new URL(
          `coder-studio-server-runtime-linux-${arch}.manifest.json`,
          this.options.releaseBaseUrl
        ).toString(),
      fetch: this.options.fetch,
      runner: this.options.wslRunner,
      onProgress: (progress) =>
        this.emit(environmentId, progress.phase, progress.message, progress.percent),
    });
    return new WslRuntimeUpdateAdapter({ probe, installer, runtimeStore });
  }

  async beginSwitch(target: DesktopEnvironmentTarget): Promise<void> {
    await this.options.stateStore.beginSwitch(target);
  }

  async markLaunchSuccessful(target: DesktopEnvironmentTarget): Promise<void> {
    this.activeTarget = target;
    await this.options.stateStore.markLaunchSuccessful(target);
  }

  isRuntimeCompatible(manifest: RuntimeManifest): boolean {
    return (
      manifest.runtimeVersion === this.options.runtimeVersion &&
      manifest.platform === "linux" &&
      !manifest.webRoot &&
      manifest.requiredEngineVersion === DESKTOP_ENGINE_VERSION &&
      manifest.requiredNodeVersion === this.options.nodeVersion &&
      manifest.runtimeHostApiVersion === RUNTIME_HOST_API_VERSION &&
      manifest.apiProtocolVersion === API_PROTOCOL_VERSION &&
      manifest.dataSchemaVersion === DATA_SCHEMA_VERSION &&
      compareVersions(this.options.shellVersion, manifest.minShellVersion) >= 0
    );
  }

  private emit(
    environmentId: string,
    phase: DesktopEnvironmentProgress["phase"],
    message: string,
    percent?: number
  ): void {
    this.options.onProgress?.({ environmentId, phase, message, percent });
  }
}
