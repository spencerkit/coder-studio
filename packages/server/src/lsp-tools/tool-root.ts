import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveLspToolRoot(dataDir: string): string {
  const root = join(dirname(dataDir), "lsp-tools");
  mkdirSync(root, { recursive: true });
  return root;
}
