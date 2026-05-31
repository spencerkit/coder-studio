import type { LspServerKind, Workspace } from "@coder-studio/core";

/**
 * A secondary LSP process started alongside the primary one.
 *
 * Currently only used for Vue: Volar 3.x removed its embedded TypeScript
 * service and now relies on the LSP client to relay `tsserver/request`
 * notifications to a TypeScript Language Server with `@vue/typescript-plugin`
 * loaded. The companion is that TS server.
 */
export interface LspCompanionSpec {
  command: string;
  args: string[];
  initializationOptions?: unknown;
}

export interface LspServerSpec {
  serverKind: LspServerKind;
  command: string;
  args: string[];
  rootPath: string;
  initializationOptions?: unknown;
  companion?: LspCompanionSpec;
  bridges?: {
    /**
     * When true, `tsserver/request` notifications received on the primary
     * connection are forwarded to the companion via
     * `workspace/executeCommand("typescript.tsserverRequest", ...)`, and the
     * response is sent back via a `tsserver/response` notification. Required
     * for Volar 3.x to answer hover/definition/quickinfo requests.
     */
    tsserverRequest?: boolean;
  };
}

const TYPESCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
]);
const PYTHON_EXTENSIONS = new Set([".py"]);
const GO_EXTENSIONS = new Set([".go"]);
const RUST_EXTENSIONS = new Set([".rs"]);
const VUE_EXTENSIONS = new Set([".vue"]);

export function resolveLspServerKind(path: string): LspServerKind | null {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();

  if (TYPESCRIPT_EXTENSIONS.has(extension)) {
    return "typescript";
  }

  if (PYTHON_EXTENSIONS.has(extension)) {
    return "python";
  }

  if (GO_EXTENSIONS.has(extension)) {
    return "go";
  }

  if (RUST_EXTENSIONS.has(extension)) {
    return "rust";
  }

  if (VUE_EXTENSIONS.has(extension)) {
    return "vue";
  }

  return null;
}

export function wrapLspCommandForWorkspace(spec: {
  workspace: Workspace;
  serverKind: LspServerKind;
  command: string;
  args: string[];
  rootPath: string;
  initializationOptions?: unknown;
  companion?: LspCompanionSpec;
  bridges?: LspServerSpec["bridges"];
}): LspServerSpec {
  if (spec.workspace.targetRuntime !== "wsl") {
    return {
      serverKind: spec.serverKind,
      command: spec.command,
      args: spec.args,
      rootPath: spec.rootPath,
      initializationOptions: spec.initializationOptions,
      companion: spec.companion,
      bridges: spec.bridges,
    };
  }

  const wrapWithWsl = (command: string, args: string[]): { command: string; args: string[] } => ({
    command: "wsl",
    args: [
      ...(spec.workspace.wslDistro ? ["-d", spec.workspace.wslDistro] : []),
      "--",
      command,
      ...args,
    ],
  });

  const primary = wrapWithWsl(spec.command, spec.args);

  return {
    serverKind: spec.serverKind,
    command: primary.command,
    args: primary.args,
    rootPath: spec.rootPath,
    initializationOptions: spec.initializationOptions,
    companion: spec.companion
      ? {
          ...wrapWithWsl(spec.companion.command, spec.companion.args),
          initializationOptions: spec.companion.initializationOptions,
        }
      : undefined,
    bridges: spec.bridges,
  };
}
