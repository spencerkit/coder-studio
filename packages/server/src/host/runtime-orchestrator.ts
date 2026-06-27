import type { Workspace } from "@coder-studio/core";
import type { RuntimeHandle } from "../runtime/contract.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { WorkspaceRuntimeBindingStore } from "./workspace-runtime-binding.js";

export interface RuntimeOrchestrator {
  ensureRuntimeForWorkspace(workspace: Workspace): Promise<RuntimeHandle>;
  rehydrateWorkspaces(workspaces: Workspace[]): Promise<void>;
  syncWorkspaceBinding(workspaceId: string): Promise<void>;
  disposeWorkspaceRuntime(workspaceId: string): Promise<void>;
  stopAllRuntimes(): Promise<void>;
}

export function getRuntimeIdForWorkspace(
  workspace: Pick<Workspace, "id" | "targetRuntime">,
  nativeRuntimeId = "native-default"
): string {
  return workspace.targetRuntime === "wsl" ? `wsl:${workspace.id}` : nativeRuntimeId;
}

export function createRuntimeOrchestrator(input: {
  runtimeRegistry: RuntimeRegistry;
  bindings: WorkspaceRuntimeBindingStore;
  workspaceLookup: {
    get(workspaceId: string): Workspace | undefined;
  };
  nativeRuntimeId: string;
  createWslRuntime(workspace: Workspace, runtimeId: string): Promise<RuntimeHandle>;
}): RuntimeOrchestrator {
  async function bindHydratedRuntimeState(
    workspaceId: string,
    runtime: RuntimeHandle
  ): Promise<void> {
    const resources = runtime.getResources?.();
    if (!resources) {
      return;
    }

    for (const session of resources.sessionRepo.listByWorkspace(workspaceId)) {
      input.bindings.bindSession(session);
    }
    for (const terminal of resources.terminalRepo.listByWorkspace(workspaceId)) {
      input.bindings.bindTerminal(terminal);
    }
  }

  async function releaseWorkspaceScopedRuntime(runtimeId: string | undefined): Promise<void> {
    if (!runtimeId || runtimeId === input.nativeRuntimeId) {
      return;
    }
    if (input.bindings.listWorkspaceIdsForRuntime(runtimeId).length > 0) {
      return;
    }

    const runtime = input.runtimeRegistry.remove(runtimeId);
    await runtime?.stop?.();
  }

  return {
    async ensureRuntimeForWorkspace(workspace) {
      const runtimeId = getRuntimeIdForWorkspace(workspace, input.nativeRuntimeId);
      const previousRuntimeId = input.bindings.getRuntimeIdForWorkspace(workspace.id);
      let runtime = input.runtimeRegistry.get(runtimeId);

      if (!runtime) {
        if (workspace.targetRuntime !== "wsl") {
          throw {
            code: "runtime_not_found",
            message: `Runtime not found: ${runtimeId}`,
          };
        }

        runtime = await input.createWslRuntime(workspace, runtimeId);
        input.runtimeRegistry.register(runtime);
      }

      input.bindings.bindWorkspace(workspace.id, runtimeId);
      await bindHydratedRuntimeState(workspace.id, runtime);

      if (previousRuntimeId && previousRuntimeId !== runtimeId) {
        await releaseWorkspaceScopedRuntime(previousRuntimeId);
      }

      return runtime;
    },

    async rehydrateWorkspaces(workspaces) {
      for (const workspace of workspaces) {
        await this.ensureRuntimeForWorkspace(workspace);
      }
    },

    async syncWorkspaceBinding(workspaceId) {
      const workspace = input.workspaceLookup.get(workspaceId);
      if (!workspace) {
        input.bindings.unbindWorkspace(workspaceId);
        return;
      }

      await this.ensureRuntimeForWorkspace(workspace);
    },

    async disposeWorkspaceRuntime(workspaceId) {
      const runtimeId = input.bindings.getRuntimeIdForWorkspace(workspaceId);
      const runtime = runtimeId ? input.runtimeRegistry.get(runtimeId) : undefined;

      if (runtime) {
        await runtime.disposeWorkspace(workspaceId);
      }

      input.bindings.unbindWorkspace(workspaceId);
      await releaseWorkspaceScopedRuntime(runtimeId);
    },

    async stopAllRuntimes() {
      for (const runtime of input.runtimeRegistry.list()) {
        await runtime.stop?.();
      }
    },
  };
}
