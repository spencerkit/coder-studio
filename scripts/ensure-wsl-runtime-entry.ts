import { error, success } from "./shared/logger.js";
import { isDirectExecution } from "./shared/process.js";
import { ensureWslRuntimeEntryBuilt } from "./shared/wsl-runtime-entry.js";

async function main(): Promise<void> {
  const entryPath = await ensureWslRuntimeEntryBuilt();
  success(`WSL runtime entry ready: ${entryPath}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { main as ensureWslRuntimeEntry };
