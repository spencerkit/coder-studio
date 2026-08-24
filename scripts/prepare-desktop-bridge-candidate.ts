import { createPrivateKey, sign } from "node:crypto";
import { copyFile, lstat, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { RuntimeSignature } from "../packages/desktop/src/runtime-manifest.js";
import { parseNetworkRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import { canonicalSigningPayload } from "../packages/desktop/src/signed-json.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

type ProductRuntimeTarget = "win32-x64" | "linux-x64";

interface ModernDesktopChannel {
  schemaVersion: 1;
  channel: "desktop";
  version: string;
  releaseTag: string;
  generatedAt: string;
  shell: {
    version: string;
    publishedAt: string;
    updaterMetadata: string;
    installer: string;
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
  wslEngine: {
    version: string;
    nodeVersion: string;
    manifest: string;
    manifestSha256: string;
  };
  factoryProduct: {
    version: string;
    releaseTag: string;
    runtimes: Record<
      ProductRuntimeTarget,
      {
        manifest: string;
        manifestSha256: string;
      }
    >;
  };
  signature: RuntimeSignature;
}

interface ProductChannel {
  schemaVersion: 1;
  channel: "product";
  version: string;
  releaseTag: string;
  generatedAt: string;
  minShellVersion: string;
  requirements: {
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
  runtimes: Record<
    ProductRuntimeTarget,
    {
      version: string;
      publishedAt: string;
      manifest: string;
      manifestSha256: string;
    }
  >;
  signature: RuntimeSignature;
}

interface LegacyBridgeDesktopChannel {
  schemaVersion: 1;
  channel: "stable";
  releaseTag: string;
  generatedAt: string;
  shell: {
    version: string;
    publishedAt: string;
    updaterMetadata: string;
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
  runtimes: Record<
    ProductRuntimeTarget,
    {
      version: string;
      publishedAt: string;
      manifest: string;
    }
  >;
  signature: RuntimeSignature;
}

interface PrepareDesktopBridgeCandidateOptions {
  candidateDirectory: string;
  productDirectory: string;
  bridgeTag: string;
  privateKeyPem: string;
}

interface PrepareDesktopBridgeCandidateCommand {
  candidateDirectory: string;
  productDirectory: string;
  bridgeTag: string;
  privateKeyPath: string;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value as number;
}

function assertBasename(value: unknown, label: string): string {
  const name = assertString(value, label);
  if (name !== basename(name) || name === "." || name === "..") {
    throw new Error(`${label} must be a safe asset name`);
  }
  return name;
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function copyAsset(source: string, destinationDirectory: string): Promise<void> {
  if (!(await isRegularFile(source))) {
    throw new Error(`Required release asset is missing: ${source}`);
  }
  await copyFile(source, resolve(destinationDirectory, basename(source)));
}

function parseModernDesktopChannel(value: unknown): ModernDesktopChannel {
  if (!value || typeof value !== "object") {
    throw new Error("Desktop bridge candidate channel must be an object");
  }
  const channel = value as Partial<ModernDesktopChannel>;
  if (channel.schemaVersion !== 1 || channel.channel !== "desktop") {
    throw new Error("Desktop bridge candidate must use the split Desktop channel contract");
  }
  const shell = channel.shell;
  const wslEngine = channel.wslEngine;
  const factoryProduct = channel.factoryProduct;
  if (!shell || typeof shell !== "object") {
    throw new Error("Desktop bridge candidate shell metadata is missing");
  }
  if (!wslEngine || typeof wslEngine !== "object") {
    throw new Error("Desktop bridge candidate WSL Engine metadata is missing");
  }
  if (!factoryProduct || typeof factoryProduct !== "object") {
    throw new Error("Desktop bridge candidate Factory Product metadata is missing");
  }
  return {
    schemaVersion: 1,
    channel: "desktop",
    version: assertString(channel.version, "Desktop bridge candidate version"),
    releaseTag: assertString(channel.releaseTag, "Desktop bridge candidate releaseTag"),
    generatedAt: assertString(channel.generatedAt, "Desktop bridge candidate generatedAt"),
    shell: {
      version: assertString(shell.version, "Desktop bridge candidate shell.version"),
      publishedAt: assertString(shell.publishedAt, "Desktop bridge candidate shell.publishedAt"),
      updaterMetadata: assertBasename(
        shell.updaterMetadata,
        "Desktop bridge candidate shell.updaterMetadata"
      ),
      installer: assertBasename(shell.installer, "Desktop bridge candidate shell.installer"),
      engineVersion: assertString(
        shell.engineVersion,
        "Desktop bridge candidate shell.engineVersion"
      ),
      nodeVersion: assertString(shell.nodeVersion, "Desktop bridge candidate shell.nodeVersion"),
      runtimeHostApiVersion: assertPositiveInteger(
        shell.runtimeHostApiVersion,
        "Desktop bridge candidate shell.runtimeHostApiVersion"
      ),
      apiProtocolVersion: assertPositiveInteger(
        shell.apiProtocolVersion,
        "Desktop bridge candidate shell.apiProtocolVersion"
      ),
      dataSchemaVersion: assertPositiveInteger(
        shell.dataSchemaVersion,
        "Desktop bridge candidate shell.dataSchemaVersion"
      ),
    },
    wslEngine: {
      version: assertString(wslEngine.version, "Desktop bridge candidate wslEngine.version"),
      nodeVersion: assertString(
        wslEngine.nodeVersion,
        "Desktop bridge candidate wslEngine.nodeVersion"
      ),
      manifest: assertBasename(wslEngine.manifest, "Desktop bridge candidate wslEngine.manifest"),
      manifestSha256: assertString(
        wslEngine.manifestSha256,
        "Desktop bridge candidate wslEngine.manifestSha256"
      ),
    },
    factoryProduct: {
      version: assertString(
        factoryProduct.version,
        "Desktop bridge candidate factoryProduct.version"
      ),
      releaseTag: assertString(
        factoryProduct.releaseTag,
        "Desktop bridge candidate factoryProduct.releaseTag"
      ),
      runtimes: {
        "win32-x64": {
          manifest: assertBasename(
            factoryProduct.runtimes?.["win32-x64"]?.manifest,
            "Desktop bridge candidate factoryProduct.runtimes.win32-x64.manifest"
          ),
          manifestSha256: assertString(
            factoryProduct.runtimes?.["win32-x64"]?.manifestSha256,
            "Desktop bridge candidate factoryProduct.runtimes.win32-x64.manifestSha256"
          ),
        },
        "linux-x64": {
          manifest: assertBasename(
            factoryProduct.runtimes?.["linux-x64"]?.manifest,
            "Desktop bridge candidate factoryProduct.runtimes.linux-x64.manifest"
          ),
          manifestSha256: assertString(
            factoryProduct.runtimes?.["linux-x64"]?.manifestSha256,
            "Desktop bridge candidate factoryProduct.runtimes.linux-x64.manifestSha256"
          ),
        },
      },
    },
    signature:
      channel.signature && typeof channel.signature === "object"
        ? (channel.signature as RuntimeSignature)
        : { algorithm: "ed25519", value: "" },
  };
}

function parseProductChannel(value: unknown): ProductChannel {
  if (!value || typeof value !== "object") {
    throw new Error("Bridge Product channel must be an object");
  }
  const channel = value as Partial<ProductChannel>;
  if (channel.schemaVersion !== 1 || channel.channel !== "product") {
    throw new Error("Bridge Product channel must use the signed Product channel contract");
  }
  return {
    schemaVersion: 1,
    channel: "product",
    version: assertString(channel.version, "Bridge Product channel version"),
    releaseTag: assertString(channel.releaseTag, "Bridge Product channel releaseTag"),
    generatedAt: assertString(channel.generatedAt, "Bridge Product channel generatedAt"),
    minShellVersion: assertString(
      channel.minShellVersion,
      "Bridge Product channel minShellVersion"
    ),
    requirements: {
      engineVersion: assertString(
        channel.requirements?.engineVersion,
        "Bridge Product channel requirements.engineVersion"
      ),
      nodeVersion: assertString(
        channel.requirements?.nodeVersion,
        "Bridge Product channel requirements.nodeVersion"
      ),
      runtimeHostApiVersion: assertPositiveInteger(
        channel.requirements?.runtimeHostApiVersion,
        "Bridge Product channel requirements.runtimeHostApiVersion"
      ),
      apiProtocolVersion: assertPositiveInteger(
        channel.requirements?.apiProtocolVersion,
        "Bridge Product channel requirements.apiProtocolVersion"
      ),
      dataSchemaVersion: assertPositiveInteger(
        channel.requirements?.dataSchemaVersion,
        "Bridge Product channel requirements.dataSchemaVersion"
      ),
    },
    runtimes: {
      "win32-x64": {
        version: assertString(
          channel.runtimes?.["win32-x64"]?.version,
          "Bridge Product channel runtimes.win32-x64.version"
        ),
        publishedAt: assertString(
          channel.runtimes?.["win32-x64"]?.publishedAt,
          "Bridge Product channel runtimes.win32-x64.publishedAt"
        ),
        manifest: assertBasename(
          channel.runtimes?.["win32-x64"]?.manifest,
          "Bridge Product channel runtimes.win32-x64.manifest"
        ),
        manifestSha256: assertString(
          channel.runtimes?.["win32-x64"]?.manifestSha256,
          "Bridge Product channel runtimes.win32-x64.manifestSha256"
        ),
      },
      "linux-x64": {
        version: assertString(
          channel.runtimes?.["linux-x64"]?.version,
          "Bridge Product channel runtimes.linux-x64.version"
        ),
        publishedAt: assertString(
          channel.runtimes?.["linux-x64"]?.publishedAt,
          "Bridge Product channel runtimes.linux-x64.publishedAt"
        ),
        manifest: assertBasename(
          channel.runtimes?.["linux-x64"]?.manifest,
          "Bridge Product channel runtimes.linux-x64.manifest"
        ),
        manifestSha256: assertString(
          channel.runtimes?.["linux-x64"]?.manifestSha256,
          "Bridge Product channel runtimes.linux-x64.manifestSha256"
        ),
      },
    },
    signature:
      channel.signature && typeof channel.signature === "object"
        ? (channel.signature as RuntimeSignature)
        : { algorithm: "ed25519", value: "" },
  };
}

function signLegacyChannel(
  value: Omit<LegacyBridgeDesktopChannel, "signature">,
  privateKeyPem: string
): LegacyBridgeDesktopChannel {
  return {
    ...value,
    signature: {
      algorithm: "ed25519",
      value: sign(null, canonicalSigningPayload(value), createPrivateKey(privateKeyPem)).toString(
        "base64"
      ),
    },
  };
}

function parseCommand(argv: string[]): PrepareDesktopBridgeCandidateCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  let candidateDirectory = "";
  let productDirectory = "";
  let bridgeTag = "";
  let privateKeyPath = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (argument === "--candidate-dir") candidateDirectory = normalized[++index] ?? "";
    else if (argument === "--product-dir") productDirectory = normalized[++index] ?? "";
    else if (argument === "--bridge-tag") bridgeTag = normalized[++index] ?? "";
    else if (argument === "--private-key") privateKeyPath = normalized[++index] ?? "";
    else throw new Error(`Unknown Desktop bridge candidate option: ${argument ?? ""}`);
  }
  if (!candidateDirectory || !productDirectory || !bridgeTag || !privateKeyPath) {
    throw new Error("--candidate-dir, --product-dir, --bridge-tag, and --private-key are required");
  }
  return {
    candidateDirectory: resolve(candidateDirectory),
    productDirectory: resolve(productDirectory),
    bridgeTag: bridgeTag.trim(),
    privateKeyPath: resolve(privateKeyPath),
  };
}

export async function prepareDesktopBridgeCandidate(
  options: PrepareDesktopBridgeCandidateOptions
): Promise<void> {
  const candidateDirectory = resolve(options.candidateDirectory);
  const productDirectory = resolve(options.productDirectory);
  const modernChannelPath = resolve(candidateDirectory, "desktop-channel-modern.json");
  const modernSourcePath = (await isRegularFile(modernChannelPath))
    ? modernChannelPath
    : resolve(candidateDirectory, "desktop-channel.json");
  const modern = parseModernDesktopChannel(await readJson(modernSourcePath));
  const product = parseProductChannel(
    await readJson(resolve(productDirectory, "product-channel.json"))
  );

  if (modern.releaseTag !== options.bridgeTag) {
    throw new Error("Desktop bridge candidate releaseTag must match the immutable bridge tag");
  }
  if (`desktop-v${modern.version}` !== options.bridgeTag) {
    throw new Error("Desktop bridge candidate tag must match the Shell version");
  }
  if (product.releaseTag !== modern.factoryProduct.releaseTag) {
    throw new Error("Bridge Product releaseTag must match the packaged Factory Product provenance");
  }
  if (product.version !== modern.factoryProduct.version) {
    throw new Error("Bridge Product version must match the packaged Factory Product provenance");
  }

  const windowsManifestName = product.runtimes["win32-x64"].manifest;
  const linuxManifestName = product.runtimes["linux-x64"].manifest;
  const [windowsManifest, linuxManifest] = await Promise.all([
    readJson(resolve(productDirectory, windowsManifestName)).then(parseNetworkRuntimeManifest),
    readJson(resolve(productDirectory, linuxManifestName)).then(parseNetworkRuntimeManifest),
  ]);
  const windowsPackage = assertBasename(
    windowsManifest.packageFile,
    "Bridge Product win32-x64 packageFile"
  );
  const linuxPackage = assertBasename(
    linuxManifest.packageFile,
    "Bridge Product linux-x64 packageFile"
  );

  await Promise.all([
    copyAsset(resolve(productDirectory, "product-channel.json"), candidateDirectory),
    copyAsset(resolve(productDirectory, "coder-studio-cli.tgz"), candidateDirectory),
    copyAsset(resolve(productDirectory, windowsManifestName), candidateDirectory),
    copyAsset(resolve(productDirectory, linuxManifestName), candidateDirectory),
    copyAsset(resolve(productDirectory, windowsPackage), candidateDirectory),
    copyAsset(resolve(productDirectory, linuxPackage), candidateDirectory),
  ]);

  const legacy = signLegacyChannel(
    {
      schemaVersion: 1,
      channel: "stable",
      releaseTag: options.bridgeTag,
      generatedAt: modern.generatedAt,
      shell: {
        version: modern.shell.version,
        publishedAt: modern.shell.publishedAt,
        updaterMetadata: modern.shell.updaterMetadata,
        engineVersion: modern.shell.engineVersion,
        nodeVersion: modern.shell.nodeVersion,
        runtimeHostApiVersion: modern.shell.runtimeHostApiVersion,
        apiProtocolVersion: modern.shell.apiProtocolVersion,
        dataSchemaVersion: modern.shell.dataSchemaVersion,
      },
      runtimes: {
        "win32-x64": {
          version: product.runtimes["win32-x64"].version,
          publishedAt: product.runtimes["win32-x64"].publishedAt,
          manifest: windowsManifestName,
        },
        "linux-x64": {
          version: product.runtimes["linux-x64"].version,
          publishedAt: product.runtimes["linux-x64"].publishedAt,
          manifest: linuxManifestName,
        },
      },
    },
    options.privateKeyPem
  );

  await Promise.all([
    writeFile(
      resolve(candidateDirectory, "desktop-channel-modern.json"),
      `${JSON.stringify(modern, null, 2)}\n`
    ),
    writeFile(
      resolve(candidateDirectory, "desktop-channel.json"),
      `${JSON.stringify(legacy, null, 2)}\n`
    ),
  ]);

  success(
    `Prepared bridge candidate assets in ${candidateDirectory} against Product ${product.releaseTag}`
  );
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const privateKeyPem = await readFile(command.privateKeyPath, "utf8");
  await prepareDesktopBridgeCandidate({
    candidateDirectory: command.candidateDirectory,
    productDirectory: command.productDirectory,
    bridgeTag: command.bridgeTag,
    privateKeyPem,
  });
}

if (isDirectExecution(import.meta.url)) {
  main().catch((candidateError) => {
    error(candidateError instanceof Error ? candidateError.message : String(candidateError));
    process.exit(1);
  });
}
