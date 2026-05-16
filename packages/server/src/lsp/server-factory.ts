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

export function resolveLspServerSpec(args: {
  workspace: Workspace;
  path: string;
  env?: NodeJS.ProcessEnv;
}): LspServerSpec | null {
  const env = args.env ?? process.env;
  const extension = args.path.slice(args.path.lastIndexOf(".")).toLowerCase();

  const base = TYPESCRIPT_EXTENSIONS.has(extension)
    ? overrideable("typescript", args.workspace.path, env, "typescript-language-server", [
        "--stdio",
      ])
    : PYTHON_EXTENSIONS.has(extension)
      ? overrideable("python", args.workspace.path, env, "pylsp", [])
      : GO_EXTENSIONS.has(extension)
        ? overrideable("go", args.workspace.path, env, "gopls", [])
        : RUST_EXTENSIONS.has(extension)
          ? overrideable("rust", args.workspace.path, env, "rust-analyzer", [])
          : null;

  if (!base) {
    return null;
  }

  if (args.workspace.targetRuntime !== "wsl") {
    return base;
  }

  return {
    ...base,
    command: "wsl",
    args: [
      ...(args.workspace.wslDistro ? ["-d", args.workspace.wslDistro] : []),
      "--",
      base.command,
      ...base.args,
    ],
  };
}

function overrideable(
  serverKind: LspServerKind,
  rootPath: string,
  env: NodeJS.ProcessEnv,
  defaultCommand: string,
  defaultArgs: string[]
): LspServerSpec {
  const prefix = `CODER_STUDIO_LSP_${serverKind.toUpperCase()}`;
  const command = env[`${prefix}_COMMAND`] ?? defaultCommand;
  const argsJson = env[`${prefix}_ARGS_JSON`];
  const args = argsJson ? parseOverrideArgs(argsJson, `${prefix}_ARGS_JSON`) : defaultArgs;

  return {
    serverKind,
    command,
    args,
    rootPath,
  };
}

function parseOverrideArgs(raw: string, envVarName: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    throw new Error(`Invalid JSON in ${envVarName}`);
  }
}
