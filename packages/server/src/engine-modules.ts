import { createRequire } from "node:module";
import { resolve } from "node:path";

const runtimeRequire = createRequire(import.meta.url);

function getEngineRequire(): NodeJS.Require {
  const engineRoot = process.env.CODER_STUDIO_ENGINE_ROOT?.trim();
  return engineRoot
    ? createRequire(resolve(engineRoot, "coder-studio-engine-host.cjs"))
    : runtimeRequire;
}

export function resolveEngineModule(id: string): string {
  return getEngineRequire().resolve(id);
}

export function loadEngineModule<T>(id: string): T {
  return getEngineRequire()(id) as T;
}
