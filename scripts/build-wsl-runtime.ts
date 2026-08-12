import { buildDesktopRuntime } from "./build-desktop-runtime.js";
import { error, success } from "./shared/logger.js";
import { isDirectExecution } from "./shared/process.js";

export async function buildWslRuntime(): Promise<void> {
  if (process.platform !== "linux") {
    throw new Error("The WSL Server Runtime must be built on a Linux runner");
  }
  const result = await buildDesktopRuntime({
    includeWeb: false,
    packagePrefix: "coder-studio-server-runtime",
  });
  success(`WSL Server Runtime built at ${result.releaseRuntimeDir}`);
}

if (isDirectExecution(import.meta.url)) {
  buildWslRuntime().catch((buildError) => {
    error(buildError instanceof Error ? buildError.message : String(buildError));
    process.exit(1);
  });
}
