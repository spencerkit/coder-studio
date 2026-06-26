import type { ProviderDefinition } from "@coder-studio/core";
import type { RuntimeHandle } from "../runtime/contract.js";

export class RuntimeRegistry {
  private readonly runtimes = new Map<string, RuntimeHandle>();

  register(runtime: RuntimeHandle): void {
    this.runtimes.set(runtime.id, runtime);
  }

  get(runtimeId: string): RuntimeHandle | undefined {
    return this.runtimes.get(runtimeId);
  }

  list(): RuntimeHandle[] {
    return Array.from(this.runtimes.values());
  }

  setProviderRegistry(providers: ProviderDefinition[]): void {
    for (const runtime of this.runtimes.values()) {
      runtime.setProviderRegistry?.(providers);
    }
  }
}
