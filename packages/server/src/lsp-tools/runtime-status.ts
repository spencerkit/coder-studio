import type { LspServerKind, Workspace } from "@coder-studio/core";
import type { LspToolManager } from "./manager.js";

const SERVER_KINDS: LspServerKind[] = ["typescript", "python", "go", "rust", "vue"];

export async function buildLspRuntimeStatus(input: {
  workspace: Workspace;
  lspToolMgr: LspToolManager;
  env?: NodeJS.ProcessEnv;
}) {
  const entries = await Promise.all(
    SERVER_KINDS.map((serverKind) =>
      input.lspToolMgr.runtimeStatus({
        workspace: input.workspace,
        serverKind,
        env: input.env,
      })
    )
  );

  return {
    tools: Object.fromEntries(entries.map((entry) => [entry.serverKind, entry])),
  };
}
