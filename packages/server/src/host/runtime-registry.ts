import type { ProviderDefinition } from "@coder-studio/core";
import type { RuntimeHandle } from "../runtime/contract.js";
import type { RemoteStateSnapshot } from "../runtime/remote/protocol.js";

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeHandle>();

  register(runtime: RuntimeHandle): void {
    this.runtimes.set(runtime.id, runtime);
  }

  get(runtimeId: string): RuntimeHandle | undefined {
    return this.runtimes.get(runtimeId);
  }

  remove(runtimeId: string): RuntimeHandle | undefined {
    const runtime = this.runtimes.get(runtimeId);
    this.runtimes.delete(runtimeId);
    return runtime;
  }

  list(): RuntimeHandle[] {
    return Array.from(this.runtimes.values());
  }

  setProviderRegistry(providers: ProviderDefinition[]): void {
    for (const runtime of this.runtimes.values()) {
      void runtime.setProviderRegistry?.(providers);
    }
  }

  async syncSnapshot(snapshot: RemoteStateSnapshot): Promise<void> {
    await Promise.all(
      Array.from(this.runtimes.values(), (runtime) => runtime.syncSnapshot?.(snapshot))
    );
  }

  listByKind(kind: RuntimeHandle["kind"]): RuntimeHandle[] {
    return this.list().filter((runtime) => runtime.kind === kind);
  }
}
