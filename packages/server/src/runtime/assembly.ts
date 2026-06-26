import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeHostBridge } from "./contract.js";
import { getRuntimeStateFile } from "./runtime-state.js";

export interface RuntimeAssembly {
  context: RuntimeCommandContext;
  stop(): Promise<void>;
}

export async function assembleRuntime(input: {
  runtimeId: string;
  stateRoot: string;
  hostBridge: RuntimeHostBridge;
  providerRegistry: RuntimeCommandContext["providerRegistry"];
  workspaceLookup: RuntimeCommandContext["workspaceLookup"];
  providerRuntimeDeps?: RuntimeCommandContext["providerRuntimeDeps"];
  contextOverrides?: Partial<RuntimeCommandContext>;
  providerConfigRepoFactory?:
    | ((filePath: string) => RuntimeCommandContext["providerConfigRepo"])
    | undefined;
}): Promise<RuntimeAssembly> {
  const providerConfigPath = getRuntimeStateFile(
    input.stateRoot,
    input.runtimeId,
    "provider-configs.json"
  );
  const providerConfigRepo = input.providerConfigRepoFactory
    ? input.providerConfigRepoFactory(providerConfigPath)
    : new ProviderConfigRepo({
        filePath: providerConfigPath,
      });

  const context = {
    runtimeId: input.runtimeId,
    workspaceLookup: input.workspaceLookup,
    hostBridge: input.hostBridge,
    eventBus: {
      emit() {},
      on() {
        return () => {};
      },
    },
    providerConfigRepo,
    providerRegistry: input.providerRegistry,
    sessionMgr: {
      setProviderRegistry() {},
      async stopForWorkspace() {},
      deleteEndedForWorkspace() {},
    },
    terminalMgr: {
      async closeForWorkspace() {},
    },
    taskMgr: {
      clearWorkspace() {},
    },
    lspMgr: {
      async disposeWorkspace() {},
    },
    supervisorMgr: {
      setProviderRegistry() {},
    },
    providerRuntimeDeps: input.providerRuntimeDeps,
    ...input.contextOverrides,
  } as unknown as RuntimeCommandContext;

  return {
    context,
    async stop() {},
  };
}
