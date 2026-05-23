import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function resolveLspToolRoot(stateDir: string): string {
  const root = join(stateDir, "lsp-tools");
  mkdirSync(root, { recursive: true });
  return root;
}
