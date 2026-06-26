import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function isPackagedDistRuntime(modulePath: string): boolean {
  return modulePath.includes(`${sep}dist${sep}esm${sep}`);
}

export function resolveAutomationEntryPath(runtimeModuleUrl: string = import.meta.url): string {
  const modulePath = fileURLToPath(runtimeModuleUrl);
  const moduleDir = dirname(modulePath);
  const sourceEntryPath = resolve(moduleDir, "../../../cli/src/automation-entry.ts");
  const repoDistEntryPath = resolve(moduleDir, "../../../cli/dist/esm/automation-entry.mjs");
  const packagedDistEntryPath = resolve(moduleDir, "automation-entry.mjs");
  const candidates = isPackagedDistRuntime(modulePath)
    ? [packagedDistEntryPath, sourceEntryPath, repoDistEntryPath]
    : [sourceEntryPath, repoDistEntryPath, packagedDistEntryPath];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to resolve Coder Studio automation entry. Tried ${candidates.join(", ")}.`
  );
}
