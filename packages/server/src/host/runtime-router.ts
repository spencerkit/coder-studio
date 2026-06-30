import type { RequestAuthContext } from "../auth/index.js";
import type { RuntimeExecuteMeta, RuntimeRouteTarget } from "../runtime/contract.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { WorkspaceRuntimeBindingStore } from "./workspace-runtime-binding.js";

export class RuntimeRouter {
  constructor(
    private readonly deps: {
      runtimeRegistry: RuntimeRegistry;
      bindings: WorkspaceRuntimeBindingStore;
      defaultRuntimeId: string;
    }
  ) {}

  private resolveRoute(target: RuntimeRouteTarget): {
    runtimeId: string;
    workspaceId?: string;
  } {
    if (target.kind === "default") {
      return {
        runtimeId: this.deps.defaultRuntimeId,
      };
    }

    if (target.kind === "runtime") {
      return {
        runtimeId: target.runtimeId,
      };
    }

    const workspaceId =
      target.kind === "workspace"
        ? target.workspaceId
        : target.kind === "session"
          ? this.deps.bindings.findWorkspaceIdBySessionId(target.sessionId)
          : this.deps.bindings.findWorkspaceIdByTerminalId(target.terminalId);

    if (!workspaceId) {
      throw { code: "workspace_not_found", message: "Unable to resolve runtime target" };
    }

    const runtimeId = this.deps.bindings.getRuntimeIdForWorkspace(workspaceId);
    if (!runtimeId) {
      throw {
        code: "runtime_not_bound",
        message: `No runtime bound for workspace: ${workspaceId}`,
      };
    }

    return {
      runtimeId,
      workspaceId,
    };
  }

  async executeOnTarget(
    target: RuntimeRouteTarget,
    op: string,
    args: unknown,
    meta?: RuntimeExecuteMeta
  ): Promise<unknown> {
    const route = this.resolveRoute(target);
    const runtimeId = route.runtimeId;
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw { code: "runtime_not_found", message: `Runtime not found: ${runtimeId}` };
    }

    return runtime.execute(op, args, {
      ...meta,
      ...(route.workspaceId ? { workspaceId: route.workspaceId } : {}),
    });
  }

  getAuthContextForClient(_clientId?: string): RequestAuthContext | undefined {
    return undefined;
  }
}
