import { fileURLToPath } from "node:url";
import { runWslRuntimeEntrypoint } from "@coder-studio/server";

export { runWslRuntimeEntrypoint };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runWslRuntimeEntrypoint().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("WSL runtime error:", message);
    process.exit(1);
  });
}
