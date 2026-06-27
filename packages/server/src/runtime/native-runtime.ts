import { assembleRuntime } from "./assembly.js";
import { getRuntimeCommandDefinition } from "./command-registry.js";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeHandle, RuntimeHostBridge } from "./contract.js";

async function executeRuntimeCommand(
  op: string,
  args: unknown,
  ctx: RuntimeCommandContext,
  meta?: Parameters<RuntimeHandle["execute"]>[2]
): Promise<unknown> {
  const definition = getRuntimeCommandDefinition(op);
  if (!definition) {
    throw { code: "unknown_op", message: `Unknown operation: ${op}` };
  }

  const parsedArgs = definition.schema.parse(args);
  return definition.handler(parsedArgs, ctx, meta);
}

export async function createNativeRuntime(input: {
  runtimeId: string;
  stateRoot: string;
  runtimeStateRoot?: string;
  hostBridge: RuntimeHostBridge;
  providerRegistry: RuntimeCommandContext["providerRegistry"];
  workspaceLookup: RuntimeCommandContext["workspaceLookup"];
  providerRuntimeDeps?: RuntimeCommandContext["providerRuntimeDeps"];
  settingsRepo?: Parameters<typeof assembleRuntime>[0]["settingsRepo"];
  agentInstructionPublisher?: Parameters<typeof assembleRuntime>[0]["agentInstructionPublisher"];
  contextOverrides?: Partial<RuntimeCommandContext>;
  providerConfigRepoFactory?:
    | ((filePath: string) => RuntimeCommandContext["providerConfigRepo"])
    | undefined;
}): Promise<RuntimeHandle> {
  const assembly = await assembleRuntime(input);

  return {
    id: input.runtimeId,
    kind: "native",
    summary: {
      scope: "shared",
      targetRuntime: "native",
    },
    execute: (op, args, meta) => executeRuntimeCommand(op, args, assembly.context, meta),
    disposeWorkspace: async (workspaceId) => {
      await assembly.context.lspMgr.disposeWorkspace(workspaceId);
      await assembly.context.sessionMgr.stopForWorkspace(workspaceId);
      assembly.context.sessionMgr.deleteEndedForWorkspace(workspaceId);
      assembly.context.taskMgr.clearWorkspace(workspaceId);
      await assembly.context.terminalMgr.closeForWorkspace(workspaceId);
    },
    setProviderRegistry: (providers) => {
      assembly.context.providerRegistry.splice(
        0,
        assembly.context.providerRegistry.length,
        ...providers
      );
      assembly.context.sessionMgr.setProviderRegistry(providers);
      assembly.context.supervisorMgr.setProviderRegistry(providers);
      assembly.resources.providerInstallMgr.setProviders(providers);
    },
    health: async () => ({ ok: true }),
    stop: () => assembly.stop(),
    getContext: () => assembly.context,
    getResources: () => assembly.resources,
  };
}
