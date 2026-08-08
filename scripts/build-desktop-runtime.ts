import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import * as esbuild from "esbuild";
import {
  API_PROTOCOL_VERSION,
  DATA_SCHEMA_VERSION,
  DESKTOP_ENGINE_VERSION,
  DESKTOP_NODE_VERSION,
  getRuntimeManifestSigningPayload,
  RUNTIME_HOST_API_VERSION,
  type RuntimeFileEntry,
  type RuntimeManifest,
  verifyRuntimeManifestSignature,
} from "../packages/desktop/src/runtime-manifest.js";
import { buildWeb } from "./build-web.js";
import { copy, copyDir, ensureDir, run } from "./shared/index.js";
import { error, log, success, warn } from "./shared/logger.js";
import { CLI_DIR, DESKTOP_DIR, ROOT_DIR, SERVER_DIR, WEB_DIST_DIR } from "./shared/paths.js";
import { isDirectExecution } from "./shared/process.js";

export const DESKTOP_FACTORY_RUNTIME_DIR = resolve(DESKTOP_DIR, "dist/factory-runtime");
export const DESKTOP_RUNTIME_RELEASE_DIR = resolve(ROOT_DIR, "release/runtime");
const RUNTIME_EXTERNAL_MODULES = ["node-pty"];
const RUNTIME_OPTIONAL_EXTERNAL_MODULES = ["bufferutil", "utf-8-validate"];
const NODE_BUILTIN_MODULES = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.startsWith("node:") ? name.slice(5) : `node:${name}`,
  ])
);

export function createDesktopRuntimeBuildOptions(): esbuild.BuildOptions {
  return {
    entryPoints: {
      server: resolve(DESKTOP_DIR, "src/sidecar.ts"),
      "automation-entry": resolve(CLI_DIR, "src/automation-entry.ts"),
    },
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outdir: DESKTOP_FACTORY_RUNTIME_DIR,
    outExtension: { ".js": ".mjs" },
    external: RUNTIME_EXTERNAL_MODULES,
    sourcemap: false,
    minify: false,
    metafile: true,
    alias: {
      "@coder-studio/server": resolve(SERVER_DIR, "src/index.ts"),
      "@coder-studio/core/runtime": resolve(ROOT_DIR, "packages/core/src/runtime.ts"),
      "@coder-studio/core/state-paths": resolve(ROOT_DIR, "packages/core/src/state-paths.ts"),
      "@coder-studio/core": resolve(ROOT_DIR, "packages/core/src/index.ts"),
      "@coder-studio/providers": resolve(ROOT_DIR, "packages/providers/src/index.ts"),
      "@coder-studio/utils": resolve(ROOT_DIR, "packages/utils/src/index.ts"),
    },
    banner: {
      js: [
        "// Coder Studio Product Runtime - generated artifact",
        'import { createRequire as __coderStudioCreateRequire } from "node:module";',
        "const require = __coderStudioCreateRequire(import.meta.url);",
      ].join("\n"),
    },
  };
}

async function readPackageVersion(packagePath: string, label: string): Promise<string> {
  const manifest = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error(`Unable to resolve ${label} version`);
  }
  return manifest.version.trim();
}

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

async function removeSourcemaps(root: string): Promise<void> {
  const files = await collectFiles(root);
  await Promise.all(
    files.filter((path) => path.endsWith(".map")).map((path) => rm(resolve(root, path)))
  );
}

function assertRuntimeBundleBoundary(result: esbuild.BuildResult): void {
  const imports = Object.values(result.metafile?.outputs ?? {}).flatMap((output) => output.imports);
  const unauthorized = imports.filter(
    (entry) =>
      !NODE_BUILTIN_MODULES.has(entry.path) &&
      !RUNTIME_EXTERNAL_MODULES.some(
        (moduleName) => entry.path === moduleName || entry.path.startsWith(`${moduleName}/`)
      ) &&
      !RUNTIME_OPTIONAL_EXTERNAL_MODULES.includes(entry.path)
  );
  if (unauthorized.length > 0) {
    throw new Error(
      `Product Runtime contains unauthorized external imports: ${[
        ...new Set(unauthorized.map((entry) => entry.path)),
      ].join(", ")}`
    );
  }
}

async function createFileEntries(runtimeRoot: string): Promise<RuntimeFileEntry[]> {
  const files = (await collectFiles(runtimeRoot)).filter(
    (path) => path !== "manifest.json" && !path.endsWith(".map")
  );
  return Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(resolve(runtimeRoot, ...path.split("/")));
      return {
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.byteLength,
      };
    })
  );
}

function signManifest(manifest: RuntimeManifest): RuntimeManifest {
  const privateKeyPem = process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY?.trim();
  if (!privateKeyPem) return manifest;
  const signature = sign(
    null,
    getRuntimeManifestSigningPayload(manifest),
    createPrivateKey(privateKeyPem)
  ).toString("base64");
  const signedManifest: RuntimeManifest = {
    ...manifest,
    signature: { algorithm: "ed25519", value: signature },
  };
  const publicKeyPem = process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY?.trim();
  if (publicKeyPem && !verifyRuntimeManifestSignature(signedManifest, publicKeyPem)) {
    throw new Error("Runtime signing private key does not match the Desktop public key");
  }
  return signedManifest;
}

function readOptionalReleaseTimestamp(): string | null {
  const value = process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT?.trim();
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("CODER_STUDIO_RELEASE_PUBLISHED_AT must be a valid UTC timestamp");
  }
  return new Date(timestamp).toISOString();
}

export async function buildDesktopRuntime(
  options: { includeWeb?: boolean; packagePrefix?: string } = {}
): Promise<{
  factoryRuntimeDir: string;
  releaseRuntimeDir: string;
  manifest: RuntimeManifest;
}> {
  const runtimeVersion =
    process.env.CODER_STUDIO_RUNTIME_VERSION?.trim() ||
    (await readPackageVersion(resolve(ROOT_DIR, "packages/cli/package.json"), "Product Runtime"));
  const minShellVersion =
    process.env.CODER_STUDIO_RUNTIME_MIN_SHELL_VERSION?.trim() ||
    (await readPackageVersion(resolve(DESKTOP_DIR, "package.json"), "Desktop Shell"));
  const releasePublishedAt = readOptionalReleaseTimestamp();
  if (process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY?.trim() && !releasePublishedAt) {
    throw new Error("CODER_STUDIO_RELEASE_PUBLISHED_AT is required for signed Runtime artifacts");
  }
  const includeWeb = options.includeWeb ?? true;
  const packagePrefix = options.packagePrefix ?? "coder-studio-runtime";
  const packageBaseName = `${packagePrefix}-${runtimeVersion}-${process.platform}-${process.arch}`;
  if (includeWeb) await buildWeb();
  await rm(DESKTOP_FACTORY_RUNTIME_DIR, { recursive: true, force: true });
  await ensureDir(DESKTOP_FACTORY_RUNTIME_DIR);

  const result = await esbuild.build(createDesktopRuntimeBuildOptions());
  assertRuntimeBundleBoundary(result);

  await Promise.all([
    ...(includeWeb ? [copyDir(WEB_DIST_DIR, resolve(DESKTOP_FACTORY_RUNTIME_DIR, "web"))] : []),
    copy(
      resolve(SERVER_DIR, "node_modules/mermaid/dist/mermaid.min.js"),
      resolve(DESKTOP_FACTORY_RUNTIME_DIR, "assets/mermaid.min.js")
    ),
  ]);
  await removeSourcemaps(DESKTOP_FACTORY_RUNTIME_DIR);

  const manifestFields = {
    runtimeVersion,
    minShellVersion,
    requiredEngineVersion: DESKTOP_ENGINE_VERSION,
    requiredNodeVersion: DESKTOP_NODE_VERSION,
    runtimeHostApiVersion: RUNTIME_HOST_API_VERSION,
    apiProtocolVersion: API_PROTOCOL_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    platform: process.platform,
    arch: process.arch,
    entrypoint: "server.mjs",
    ...(includeWeb ? { webRoot: "web" } : {}),
    packageFile: `${packageBaseName}.tgz`,
    files: await createFileEntries(DESKTOP_FACTORY_RUNTIME_DIR),
  };
  const unsignedManifest: RuntimeManifest = releasePublishedAt
    ? {
        ...manifestFields,
        schemaVersion: 2,
        publishedAt: releasePublishedAt,
      }
    : {
        ...manifestFields,
        schemaVersion: 1,
      };
  const manifest = signManifest(unsignedManifest);
  await writeFile(
    resolve(DESKTOP_FACTORY_RUNTIME_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const releaseRuntimeDir = resolve(DESKTOP_RUNTIME_RELEASE_DIR, packageBaseName);
  await rm(releaseRuntimeDir, { recursive: true, force: true });
  await ensureDir(dirname(releaseRuntimeDir));
  await copyDir(DESKTOP_FACTORY_RUNTIME_DIR, releaseRuntimeDir);
  const releaseManifestPath = resolve(
    DESKTOP_RUNTIME_RELEASE_DIR,
    `${packageBaseName}.manifest.json`
  );
  const channelManifestPath = resolve(
    DESKTOP_RUNTIME_RELEASE_DIR,
    `${packagePrefix}-${process.platform}-${process.arch}.manifest.json`
  );
  const releasePackagePath = resolve(DESKTOP_RUNTIME_RELEASE_DIR, `${packageBaseName}.tgz`);
  await Promise.all([
    copy(resolve(DESKTOP_FACTORY_RUNTIME_DIR, "manifest.json"), releaseManifestPath),
    copy(resolve(DESKTOP_FACTORY_RUNTIME_DIR, "manifest.json"), channelManifestPath),
    rm(releasePackagePath, { force: true }),
  ]);
  await run("tar", ["-czf", releasePackagePath, "-C", DESKTOP_FACTORY_RUNTIME_DIR, "."]);
  if (!manifest.signature) {
    warn(
      "Product Runtime is unsigned: it is valid as the installed Factory Runtime but cannot be installed as a network update"
    );
  }
  return { factoryRuntimeDir: DESKTOP_FACTORY_RUNTIME_DIR, releaseRuntimeDir, manifest };
}

if (isDirectExecution(import.meta.url)) {
  buildDesktopRuntime()
    .then(({ releaseRuntimeDir }) => {
      success(`Product Runtime built at ${releaseRuntimeDir}`);
      log("");
    })
    .catch((buildError) => {
      error(buildError instanceof Error ? buildError.message : String(buildError));
      process.exit(1);
    });
}
