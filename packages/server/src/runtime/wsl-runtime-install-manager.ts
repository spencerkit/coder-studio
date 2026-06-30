import type { InstalledWslRuntimePointer, WslDistroRuntimeStore } from "./wsl-distro-store.js";

export interface WslRuntimeInstallManager {
  ensureInstalled(distro: string): Promise<InstalledWslRuntimePointer>;
}

export function createWslRuntimeInstallManager(input: {
  hostRuntimeVersion: string;
  store: WslDistroRuntimeStore;
  installRuntime(input: {
    distro: string;
    runtimeVersion: string;
  }): Promise<InstalledWslRuntimePointer>;
}): WslRuntimeInstallManager {
  return {
    async ensureInstalled(distro) {
      const storedPointer = await input.store.readActiveRuntime(distro);
      if (storedPointer?.runtimeVersion === input.hostRuntimeVersion) {
        return storedPointer;
      }

      const installedPointer = await input.installRuntime({
        distro,
        runtimeVersion: input.hostRuntimeVersion,
      });
      await input.store.writeActiveRuntime(distro, installedPointer);
      return installedPointer;
    },
  };
}
