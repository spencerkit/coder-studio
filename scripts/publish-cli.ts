/**
 * Safe local publish flow for the CLI package.
 *
 * Default mode is a dry-run: validate artifacts, build, and run
 * `pnpm pack --dry-run`. Real publication requires `--publish`.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "./build.js";
import { CLI_DIR, error, info, step, success } from "./shared/index.js";
import { isDirectExecution, shouldUseShellForCommand } from "./shared/process.js";

export interface PublishCliOptions {
  access: string;
  allowDirty: boolean;
  build: boolean;
  publish: boolean;
  registry?: string;
  tag: string;
  otp?: string;
}

export interface PublishCliPackageMeta {
  name: string;
  version: string;
}

export interface ExecOptions {
  cwd: string;
  stdio?: "inherit" | "pipe";
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

const INTERNAL_PACKAGE_PREFIX = "@coder-studio/";

export interface RunPublishCliInput {
  cliDir?: string;
  exec?: ExecFn;
  options: PublishCliOptions;
  buildProject?: () => Promise<void>;
}

export function parsePublishCliArgs(argv: string[]): PublishCliOptions {
  const options: PublishCliOptions = {
    access: "public",
    allowDirty: false,
    build: true,
    publish: false,
    registry: undefined,
    tag: "latest",
    otp: undefined,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    switch (arg) {
      case "--":
        break;
      case "--publish":
        options.publish = true;
        break;
      case "--dry-run":
        options.publish = false;
        break;
      case "--no-build":
        options.build = false;
        break;
      case "--allow-dirty":
        options.allowDirty = true;
        break;
      case "--tag":
        options.tag = readValue(argv, ++index, "--tag");
        break;
      case "--access":
        options.access = readValue(argv, ++index, "--access");
        break;
      case "--registry":
        options.registry = readValue(argv, ++index, "--registry");
        break;
      case "--otp":
        options.otp = readValue(argv, ++index, "--otp");
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown publish:cli option: ${arg}`);
    }
  }

  return options;
}

export function buildPackDryRunArgs(registry?: string): string[] {
  const args = ["pack", "--dry-run", "--json"];
  if (registry) {
    args.push("--registry", registry);
  }
  return args;
}

export function buildPublishArgs(options: PublishCliOptions): string[] {
  const args = ["publish", "--access", options.access, "--tag", options.tag];
  if (options.registry) {
    args.push("--registry", options.registry);
  }
  if (options.otp) {
    args.push("--otp", options.otp);
  }
  return args;
}

export async function assertCliPublishArtifacts(
  cliDir: string = CLI_DIR
): Promise<PublishCliPackageMeta> {
  const packageJsonPath = resolve(cliDir, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
    bin?: unknown;
    files?: unknown;
    exports?: unknown;
    publishConfig?: unknown;
    dependencies?: unknown;
  };

  if (pkg.name !== "@spencer-kit/coder-studio") {
    throw new Error(`Unexpected CLI package name in ${packageJsonPath}`);
  }
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(`Missing CLI package version in ${packageJsonPath}`);
  }

  const publishBin = readPublishBin(pkg);
  const publishExports = readPublishExports(pkg);

  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    throw new Error('CLI package.json must publish only the "dist" files entry');
  }
  if (!hasRecordValue(publishBin, "coder-studio", "./dist/bin.js")) {
    throw new Error('CLI package.json publish bin must point "coder-studio" to "./dist/bin.js"');
  }
  if (!hasNestedRecordValue(publishExports, ".", "import", "./dist/esm/index.mjs")) {
    throw new Error(
      'CLI package.json publish exports must point "." import to "./dist/esm/index.mjs"'
    );
  }
  assertPublishDependenciesResolvable(pkg.dependencies, packageJsonPath);

  await assertFile(resolve(cliDir, "dist/bin.js"));
  await assertFile(resolve(cliDir, "dist/esm/bin.mjs"));
  await assertFile(resolve(cliDir, "dist/esm/desktop-server.mjs"));
  await assertFile(resolve(cliDir, "dist/esm/index.mjs"));
  await assertFile(resolve(cliDir, "dist/esm/server-runner.mjs"));
  await assertFile(resolve(cliDir, "dist/esm/wsl-runtime-entry.mjs"));
  await assertFile(resolve(cliDir, "dist/web/index.html"));
  assertBundleRuntimeDependenciesDeclared(
    pkg.dependencies,
    await collectBareImports(resolve(cliDir, "dist/esm"), [
      "bin.mjs",
      "desktop-server.mjs",
      "index.mjs",
      "server-runner.mjs",
      "wsl-runtime-entry.mjs",
    ]),
    packageJsonPath
  );

  return { name: pkg.name, version: pkg.version };
}

function readPublishBin(pkg: { bin?: unknown; publishConfig?: unknown }): unknown {
  if (typeof pkg.publishConfig === "object" && pkg.publishConfig !== null) {
    const publishBin = (pkg.publishConfig as Record<string, unknown>).bin;
    if (publishBin !== undefined) {
      return publishBin;
    }
  }

  return pkg.bin;
}

function readPublishExports(pkg: { exports?: unknown; publishConfig?: unknown }): unknown {
  if (typeof pkg.publishConfig === "object" && pkg.publishConfig !== null) {
    const publishExports = (pkg.publishConfig as Record<string, unknown>).exports;
    if (publishExports !== undefined) {
      return publishExports;
    }
  }

  return pkg.exports;
}

export async function runPublishCli({
  cliDir = CLI_DIR,
  exec = execCommand,
  options,
  buildProject = build,
}: RunPublishCliInput): Promise<void> {
  const repoRoot = resolve(cliDir, "../..");

  step("PUBLISH CLI", "Preparing CLI package release...\n");

  if (options.publish && !options.allowDirty) {
    await assertCleanGitWorktree(repoRoot, exec);
  }

  if (options.build) {
    info("Running production build...");
    await buildProject();
  } else {
    info("Skipping production build (--no-build).");
  }

  const meta = await assertCliPublishArtifacts(cliDir);
  success(`Validated ${meta.name}@${meta.version} publish artifacts.`);

  info("Running pnpm pack dry-run...");
  await exec("pnpm", buildPackDryRunArgs(options.registry), {
    cwd: cliDir,
    stdio: "inherit",
  });
  success("pnpm pack dry-run completed.");

  if (!options.publish) {
    success("Dry-run complete. Re-run with --publish to publish to npm.");
    return;
  }

  info("Publishing CLI package to npm...");
  await exec("pnpm", buildPublishArgs(options), {
    cwd: cliDir,
    stdio: "inherit",
  });
  success(`Published ${meta.name}@${meta.version}.`);
}

async function assertCleanGitWorktree(repoRoot: string, exec: ExecFn): Promise<void> {
  const result = await exec("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    stdio: "pipe",
  });

  if (result.stdout.trim().length > 0) {
    throw new Error(
      "Refusing to publish from a dirty git worktree. Commit/stash changes or pass --allow-dirty."
    );
  }
}

export async function execCommand(
  command: string,
  args: string[],
  options: ExecOptions
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const stdio = options.stdio ?? "inherit";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: shouldUseShellForCommand(command),
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function assertFile(path: string): Promise<void> {
  const stats = await stat(path).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`Required publish artifact is missing: ${path}`);
  }
}

function hasRecordValue(value: unknown, key: string, expected: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[key] === expected
  );
}

function hasNestedRecordValue(
  value: unknown,
  key: string,
  nestedKey: string,
  expected: string
): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const nested = (value as Record<string, unknown>)[key];
  return (
    typeof nested === "object" &&
    nested !== null &&
    (nested as Record<string, unknown>)[nestedKey] === expected
  );
}

function assertBundleRuntimeDependenciesDeclared(
  dependencies: unknown,
  bareImports: string[],
  packageJsonPath: string
): void {
  if (typeof dependencies !== "object" || dependencies === null) {
    throw new Error(`CLI package.json is missing dependencies in ${packageJsonPath}`);
  }

  const declaredDeps = new Set(Object.keys(dependencies as Record<string, unknown>));
  const undeclared = bareImports.filter((specifier) => !declaredDeps.has(specifier));

  if (undeclared.length > 0) {
    throw new Error(
      `CLI bundle has runtime imports not declared in package.json dependencies: ${undeclared.join(", ")}`
    );
  }
}

function assertPublishDependenciesResolvable(dependencies: unknown, packageJsonPath: string): void {
  if (typeof dependencies !== "object" || dependencies === null) {
    throw new Error(`CLI package.json is missing dependencies in ${packageJsonPath}`);
  }

  for (const [name, version] of Object.entries(dependencies)) {
    if (!name.startsWith(INTERNAL_PACKAGE_PREFIX)) {
      continue;
    }
    if (typeof version !== "string") {
      throw new Error(`Expected ${name} dependency version to be a string in ${packageJsonPath}`);
    }
    throw new Error(
      `${name} dependency must not be published with the CLI bundle (${packageJsonPath})`
    );
  }
}

async function collectBareImports(dir: string, entries: string[]): Promise<string[]> {
  const specifiers = new Set<string>();

  for (const entry of entries) {
    const content = await readFile(resolve(dir, entry), "utf8");
    for (const specifier of extractBareImports(content)) {
      specifiers.add(specifier);
    }
  }

  return Array.from(specifiers).sort();
}

function extractBareImports(content: string): string[] {
  const specifiers = new Set<string>();
  const importPattern =
    /\bimport\s+(?:[^"'()]+?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (
      !specifier ||
      isNodeBuiltinImport(specifier) ||
      specifier.startsWith(".") ||
      specifier.startsWith("/")
    ) {
      continue;
    }
    specifiers.add(specifier);
  }

  return Array.from(specifiers);
}

function isNodeBuiltinImport(specifier: string): boolean {
  return (
    specifier.startsWith("node:") ||
    specifier === "assert" ||
    specifier === "buffer" ||
    specifier === "child_process" ||
    specifier === "crypto" ||
    specifier === "events" ||
    specifier === "fs" ||
    specifier === "fs/promises" ||
    specifier === "http" ||
    specifier === "https" ||
    specifier === "module" ||
    specifier === "net" ||
    specifier === "os" ||
    specifier === "path" ||
    specifier === "readline" ||
    specifier === "stream" ||
    specifier === "timers" ||
    specifier === "tty" ||
    specifier === "url" ||
    specifier === "util" ||
    specifier === "worker_threads"
  );
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printUsage(): void {
  console.log(`
Usage:
  pnpm publish:cli [options]

Default mode is safe and does not publish:
  pnpm publish:cli

Options:
  --publish              Run pnpm publish after validation and pack dry-run
  --dry-run              Force dry-run mode (default)
  --no-build             Skip pnpm build; validate existing dist instead
  --allow-dirty          Allow real publish from a dirty git worktree
  --tag <tag>            npm dist-tag for publish (default: latest)
  --access <access>      npm access level (default: public)
  --registry <url>       npm registry override
  --otp <code>           npm one-time password
`);
}

if (isDirectExecution(import.meta.url)) {
  runPublishCli({ options: parsePublishCliArgs(process.argv.slice(2)) }).catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
