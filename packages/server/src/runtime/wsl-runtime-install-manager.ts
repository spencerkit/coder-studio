import type { InstalledWslRuntimePointer, WslDistroRuntimeStore } from "./wsl-distro-store.js";

export interface WslRuntimeInstallManager {
  ensureInstalled(distro: string): Promise<InstalledWslRuntimePointer>;
}

export interface CheckStoredWslRuntimeReusableInput {
  distro: string;
  hostRuntimeVersion: string;
}

export function createWslRuntimeInstallManager(input: {
  hostRuntimeVersion: string;
  store: WslDistroRuntimeStore;
  isStoredRuntimeReusable?(
    pointer: InstalledWslRuntimePointer,
    input: CheckStoredWslRuntimeReusableInput
  ): Promise<boolean> | boolean;
  installRuntime(input: {
    distro: string;
    runtimeVersion: string;
  }): Promise<InstalledWslRuntimePointer>;
}): WslRuntimeInstallManager {
  return {
    async ensureInstalled(distro) {
      const storedPointer = await input.store.readActiveRuntime(distro);
      if (
        storedPointer?.runtimeVersion === input.hostRuntimeVersion &&
        (await input.isStoredRuntimeReusable?.(storedPointer, {
          distro,
          hostRuntimeVersion: input.hostRuntimeVersion,
        })) !== false
      ) {
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
