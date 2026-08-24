import { createHash, createPrivateKey, sign } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { create } from "tar";
import {
  ENGINE_MANIFEST_SCHEMA_VERSION,
  type EngineManifest,
  getEngineManifestSigningPayload,
} from "../packages/desktop/src/engine-manifest.js";
import { DESKTOP_ENGINE_VERSION } from "../packages/desktop/src/runtime-manifest.js";
import {
  DESKTOP_ENGINE_DIR,
  DESKTOP_NODE_VERSION,
  prepareDesktopPackage,
} from "./prepare-desktop-package.js";
import { ensureDir, error, ROOT_DIR, run, success, warn } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export const WSL_ENGINE_RELEASE_DIR = resolve(ROOT_DIR, "release/engine");

async function collectFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(root, path)));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`WSL Engine contains unsupported entry: ${entry.name}`);
  }
  return files.sort();
}

function signManifest(manifest: EngineManifest): EngineManifest {
  const privateKeyPem = process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY?.trim();
  if (!privateKeyPem) return manifest;
  return {
    ...manifest,
    signature: {
      algorithm: "ed25519",
      value: sign(
        null,
        getEngineManifestSigningPayload(manifest),
        createPrivateKey(privateKeyPem)
      ).toString("base64"),
    },
  };
}

async function verifyNodeToolLaunchers(): Promise<void> {
  for (const command of ["npm", "npx", "corepack"]) {
    await run(resolve(DESKTOP_ENGINE_DIR, `bin/${command}`), ["--version"]);
  }
}

export async function buildWslEngine(): Promise<{ manifest: EngineManifest; packagePath: string }> {
  if (process.platform !== "linux") {
    throw new Error("The WSL Engine must be built on a Linux runner");
  }
  if (process.arch !== "x64" && process.arch !== "arm64") {
    throw new Error(`Unsupported WSL Engine architecture: ${process.arch}`);
  }
  await prepareDesktopPackage({ includeFactoryRuntime: false });
  await verifyNodeToolLaunchers();
  await ensureDir(WSL_ENGINE_RELEASE_DIR);

  const files = await collectFiles(DESKTOP_ENGINE_DIR);
  const packageBaseName = `coder-studio-engine-${DESKTOP_ENGINE_VERSION}-linux-${process.arch}`;
  const packagePath = resolve(WSL_ENGINE_RELEASE_DIR, `${packageBaseName}.tgz`);
  await rm(packagePath, { force: true });
  await create({ cwd: DESKTOP_ENGINE_DIR, file: packagePath, gzip: true, portable: true }, files);
  const packageBytes = await readFile(packagePath);
  const manifest = signManifest({
    schemaVersion: ENGINE_MANIFEST_SCHEMA_VERSION,
    engineVersion: DESKTOP_ENGINE_VERSION,
    nodeVersion: DESKTOP_NODE_VERSION,
    platform: "linux",
    arch: process.arch,
    libc: "glibc",
    packageFile: `${packageBaseName}.tgz`,
    packageSha256: createHash("sha256").update(packageBytes).digest("hex"),
    packageSize: (await stat(packagePath)).size,
    files: await Promise.all(
      files.map(async (path) => {
        const bytes = await readFile(resolve(DESKTOP_ENGINE_DIR, ...path.split("/")));
        return {
          path,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          size: bytes.byteLength,
        };
      })
    ),
  });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(WSL_ENGINE_RELEASE_DIR, `${packageBaseName}.manifest.json`), manifestJson),
    writeFile(
      resolve(WSL_ENGINE_RELEASE_DIR, `coder-studio-engine-linux-${process.arch}.manifest.json`),
      manifestJson
    ),
  ]);
  if (!manifest.signature) {
    warn("WSL Engine is unsigned and cannot be installed by production Desktop builds");
  }
  success(`WSL Engine built at ${packagePath}`);
  return { manifest, packagePath };
}

if (isDirectExecution(import.meta.url)) {
  buildWslEngine().catch((buildError) => {
    error(buildError instanceof Error ? buildError.message : String(buildError));
    process.exit(1);
  });
}
