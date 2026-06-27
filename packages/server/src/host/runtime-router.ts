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

  private resolveRuntimeId(target: RuntimeRouteTarget): string {
    if (target.kind === "default") {
      return this.deps.defaultRuntimeId;
    }

    if (target.kind === "runtime") {
      return target.runtimeId;
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

    return runtimeId;
  }

  async executeOnTarget(
    target: RuntimeRouteTarget,
    op: string,
    args: unknown,
    meta?: RuntimeExecuteMeta
  ): Promise<unknown> {
    const runtimeId = this.resolveRuntimeId(target);
    const runtime = this.deps.runtimeRegistry.get(runtimeId);
    if (!runtime) {
      throw { code: "runtime_not_found", message: `Runtime not found: ${runtimeId}` };
    }

    return runtime.execute(op, args, meta);
  }

  getAuthContextForClient(_clientId?: string): RequestAuthContext | undefined {
    return undefined;
  }
}
