import type { ProductChannelRuntime } from "./product-channel.js";
import type { RuntimeManifest } from "./runtime-manifest.js";
import type {
  RuntimeDownloadOptions,
  RuntimeUpdateAdapter,
  RuntimeUpdateMetadata,
} from "./runtime-update-manager.js";
import type { WslDistroProbe } from "./wsl-discovery.js";
import {
  type WslInstalledRuntime,
  WslInstaller,
  type WslRuntimeDownloadOptions,
  type WslRuntimeUpdateMetadata,
} from "./wsl-installer.js";
import { WslRuntimeStoreClient } from "./wsl-runtime-store.js";

export class WslRuntimeUpdateAdapter implements RuntimeUpdateAdapter {
  constructor(
    private readonly options: {
      probe: WslDistroProbe;
      installer: WslInstaller;
      runtimeStore: WslRuntimeStoreClient;
    }
  ) {}

  async getCurrentVersion(): Promise<string> {
    return (await this.options.runtimeStore.getLaunchCandidate()).manifest.runtimeVersion;
  }

  async getCurrentManifest(): Promise<RuntimeManifest> {
    return (await this.options.runtimeStore.getLaunchCandidate()).manifest;
  }

  checkMetadata(
    expected: ProductChannelRuntime,
    plannedShellVersion: string,
    releaseTag: string
  ): Promise<WslRuntimeUpdateMetadata> {
    return this.options.installer.checkRuntime(
      this.options.probe,
      expected,
      plannedShellVersion,
      releaseTag
    );
  }

  downloadAndStage(
    metadata: RuntimeUpdateMetadata,
    options: RuntimeDownloadOptions
  ): Promise<WslInstalledRuntime> {
    const wslMetadata = metadata as WslRuntimeUpdateMetadata;
    if (wslMetadata.probe?.target.id !== this.options.probe.target.id) {
      throw new Error("WSL Runtime metadata belongs to a different distribution");
    }
    return this.options.installer.downloadAndStageRuntime(
      wslMetadata,
      options as WslRuntimeDownloadOptions
    );
  }

  getPendingVersion(): Promise<string | null> {
    return this.options.runtimeStore.readPendingVersion();
  }
}
