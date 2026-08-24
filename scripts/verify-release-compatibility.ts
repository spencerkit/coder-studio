import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProductChannel } from "../packages/desktop/src/product-channel.js";
import {
  parseChannelTimestamp,
  parseReleaseCapabilities,
  readChannelString,
} from "../packages/desktop/src/release-channel.js";
import { compareVersions, parseRuntimeManifest } from "../packages/desktop/src/runtime-manifest.js";
import {
  canonicalSigningPayload,
  verifyEd25519Payload,
} from "../packages/desktop/src/signed-json.js";
import { ROOT_DIR } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

type CompatibilityTarget = "native" | "wsl";

interface CompatibilityDesktopChannel {
  releaseTag: string;
  version: string;
  shell: {
    version: string;
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function parseCompatibilityDesktopChannel(
  value: unknown,
  publicKeyPem: string
): CompatibilityDesktopChannel {
  if (!value || typeof value !== "object") throw new Error("Desktop channel must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Desktop channel schema");
  const kind = readChannelString(candidate.channel, "Desktop channel kind");
  if (kind !== "desktop" && kind !== "stable") {
    throw new Error("Desktop channel kind is unsupported");
  }
  const releaseTag = readChannelString(candidate.releaseTag, "Desktop channel releaseTag");
  parseChannelTimestamp(candidate.generatedAt, "Desktop channel generatedAt");
  if (!candidate.shell || typeof candidate.shell !== "object") {
    throw new Error("Desktop channel shell must be an object");
  }
  const shellValue = candidate.shell as Record<string, unknown>;
  const shell = {
    version: readChannelString(shellValue.version, "Desktop channel shell.version"),
    ...parseReleaseCapabilities(shellValue, "Desktop channel shell"),
  };
  parseChannelTimestamp(shellValue.publishedAt, "Desktop channel shell.publishedAt");
  const version =
    kind === "desktop"
      ? readChannelString(candidate.version, "Desktop channel version")
      : shell.version;
  if (kind === "desktop" && version !== shell.version) {
    throw new Error("Desktop channel Shell must use the Desktop version");
  }
  if (
    !verifyEd25519Payload(canonicalSigningPayload(candidate), candidate.signature, publicKeyPem)
  ) {
    throw new Error("Desktop channel signature is invalid");
  }
  return {
    releaseTag,
    version: shell.version,
    shell,
  };
}

export function verifyReleaseCompatibility(): void {
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const productTag = requiredEnvironment("PRODUCT_TAG");
  const desktopTag = requiredEnvironment("DESKTOP_TAG");
  const target = requiredEnvironment("TARGET") as CompatibilityTarget;
  if (target !== "native" && target !== "wsl") {
    throw new Error(`Unsupported compatibility target: ${target}`);
  }
  const publicKeyPem = requiredEnvironment("CODER_STUDIO_RUNTIME_PUBLIC_KEY");
  const productChannelSha256 = requiredEnvironment("PRODUCT_CHANNEL_SHA256");
  const desktopChannelSha256 = requiredEnvironment("DESKTOP_CHANNEL_SHA256");
  const windowsManifestSha256 = requiredEnvironment("WINDOWS_MANIFEST_SHA256");
  const linuxManifestSha256 = requiredEnvironment("LINUX_MANIFEST_SHA256");
  const compatibilityRoot = resolve(ROOT_DIR, "release/compatibility");
  const productChannelPath = resolve(compatibilityRoot, "product/product-channel.json");
  const desktopChannelPath = resolve(compatibilityRoot, "desktop/desktop-channel.json");
  const productChannelUrl = `https://github.com/${repository}/releases/download/${productTag}/product-channel.json`;
  const product = parseProductChannel(
    readJson(productChannelPath),
    publicKeyPem,
    productChannelUrl
  );
  const desktop = parseCompatibilityDesktopChannel(readJson(desktopChannelPath), publicKeyPem);

  if (product.releaseTag !== productTag) {
    throw new Error("Product channel does not match the explicit immutable release tag");
  }
  if (desktop.releaseTag !== desktopTag) {
    throw new Error("Desktop channel does not match the explicit immutable release tag");
  }

  const runtimeTarget = target === "wsl" ? "linux-x64" : "win32-x64";
  const manifestName =
    target === "wsl"
      ? "coder-studio-server-runtime-linux-x64.manifest.json"
      : "coder-studio-runtime-win32-x64.manifest.json";
  const expectedManifestSha256 = target === "wsl" ? linuxManifestSha256 : windowsManifestSha256;
  const manifest = parseRuntimeManifest(
    readJson(resolve(compatibilityRoot, "product", manifestName))
  );

  if (product.runtimes[runtimeTarget].manifest !== manifestName) {
    throw new Error(`Product channel does not identify the ${runtimeTarget} manifest`);
  }
  if (product.runtimes[runtimeTarget].manifestSha256 !== expectedManifestSha256) {
    throw new Error(`Product channel ${runtimeTarget} manifestSha256 differs from accepted bytes`);
  }
  if (manifest.runtimeVersion !== product.version) {
    throw new Error("Product Runtime version does not match the Product channel");
  }
  if (compareVersions(desktop.shell.version, product.minShellVersion) < 0) {
    throw new Error("Desktop Shell is older than the Product minimum Shell version");
  }

  const expectedCapabilities = {
    requiredEngineVersion: desktop.shell.engineVersion,
    requiredNodeVersion: desktop.shell.nodeVersion,
    runtimeHostApiVersion: desktop.shell.runtimeHostApiVersion,
    apiProtocolVersion: desktop.shell.apiProtocolVersion,
    dataSchemaVersion: desktop.shell.dataSchemaVersion,
  };
  for (const [field, expected] of Object.entries(expectedCapabilities)) {
    if (manifest[field as keyof typeof manifest] !== expected) {
      throw new Error(`${target} Product Runtime ${field} is incompatible with Desktop`);
    }
  }
  const productRequirements = {
    requiredEngineVersion: product.requirements.engineVersion,
    requiredNodeVersion: product.requirements.nodeVersion,
    runtimeHostApiVersion: product.requirements.runtimeHostApiVersion,
    apiProtocolVersion: product.requirements.apiProtocolVersion,
    dataSchemaVersion: product.requirements.dataSchemaVersion,
  };
  if (JSON.stringify(productRequirements) !== JSON.stringify(expectedCapabilities)) {
    throw new Error("Product channel requirements are incompatible with Desktop");
  }

  const reportPath = resolve(ROOT_DIR, `release/compatibility-report/${target}.json`);
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        target,
        product: {
          version: product.version,
          tag: productTag,
          channelSha256: productChannelSha256,
          manifestSha256: expectedManifestSha256,
        },
        desktop: {
          version: desktop.version,
          tag: desktopTag,
          channelSha256: desktopChannelSha256,
        },
        compatible: true,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

if (isDirectExecution(import.meta.url)) {
  verifyReleaseCompatibility();
}
