import type { LspServerKind, Workspace } from "@coder-studio/core";

export interface LspServerSpec {
  serverKind: LspServerKind;
  command: string;
  args: string[];
  rootPath: string;
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

  return null;
}

export function wrapLspCommandForWorkspace(spec: {
  workspace: Workspace;
  serverKind: LspServerKind;
  command: string;
  args: string[];
  rootPath: string;
}): LspServerSpec {
  if (spec.workspace.targetRuntime !== "wsl") {
    return {
      serverKind: spec.serverKind,
      command: spec.command,
      args: spec.args,
      rootPath: spec.rootPath,
    };
  }

  return {
    serverKind: spec.serverKind,
    command: "wsl",
    args: [
      ...(spec.workspace.wslDistro ? ["-d", spec.workspace.wslDistro] : []),
      "--",
      spec.command,
      ...spec.args,
    ],
    rootPath: spec.rootPath,
  };
}
