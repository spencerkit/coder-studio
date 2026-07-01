import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter as defaultPathDelimiter, join } from "node:path";

export interface DevCliShimInput {
  rootDir: string;
  cliDir: string;
}

export interface DevCliShimResult {
  binDir: string;
  unixShimPath: string;
  windowsShimPath: string;
}

export interface DevServerEnvInput extends DevCliShimInput {
  env: NodeJS.ProcessEnv;
}

function quotePosixShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindowsCmdArg(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
}

const requireFromHere = createRequire(import.meta.url);

function resolveDevCliRuntime() {
  return {
    nodeExecPath: process.execPath,
    tsxLoaderPath: requireFromHere.resolve("tsx"),
  };
}

export function ensureDevCliShim(input: DevCliShimInput): DevCliShimResult {
  const binDir = join(input.rootDir, ".tmp", "dev-bin");
  const unixShimPath = join(binDir, "coder-studio-cli");
  const windowsShimPath = join(binDir, "coder-studio-cli.cmd");
  const repoCliEntry = join(input.cliDir, "src", "bin.ts");
  const { nodeExecPath, tsxLoaderPath } = resolveDevCliRuntime();
  const unixNodeExec = quotePosixShellArg(nodeExecPath);
  const unixTsxLoader = quotePosixShellArg(tsxLoaderPath);
  const unixRepoCliEntry = quotePosixShellArg(repoCliEntry);
  const windowsNodeExec = quoteWindowsCmdArg(nodeExecPath);
  const windowsTsxLoader = quoteWindowsCmdArg(tsxLoaderPath);
  const windowsRepoCliEntry = quoteWindowsCmdArg(repoCliEntry);

  mkdirSync(binDir, { recursive: true });

  writeFileSync(
    unixShimPath,
    [
      "#!/usr/bin/env sh",
      `exec ${unixNodeExec} --import ${unixTsxLoader} ${unixRepoCliEntry} "$@"`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o755 }
  );
  writeFileSync(
    windowsShimPath,
    [
      "@echo off",
      `${windowsNodeExec} --import ${windowsTsxLoader} ${windowsRepoCliEntry} %*`,
      "",
    ].join("\r\n"),
    "utf8"
  );

  return {
    binDir,
    unixShimPath,
    windowsShimPath,
  };
}

export function prependPathEntry(
  env: NodeJS.ProcessEnv,
  entry: string,
  options: { delimiter?: string } = {}
): NodeJS.ProcessEnv {
  const pathKeys = Object.keys(env).filter((key) => key.toUpperCase() === "PATH");
  const pathKey =
    pathKeys.find((key) => key === "Path") ?? pathKeys.find((key) => key === "PATH") ?? "PATH";
  const currentPath = pathKeys
    .map((key) => env[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(options.delimiter ?? defaultPathDelimiter);
  const delimiter = options.delimiter ?? defaultPathDelimiter;
  const nextEnv = { ...env };
  for (const key of pathKeys) {
    delete nextEnv[key];
  }

  return {
    ...nextEnv,
    [pathKey]: currentPath.length > 0 ? `${entry}${delimiter}${currentPath}` : entry,
  };
}

export function buildDevServerEnv(input: DevServerEnvInput): NodeJS.ProcessEnv {
  const { binDir } = ensureDevCliShim(input);
  return prependPathEntry(input.env, binDir);
}
