import {
  parseChannelTimestamp,
  parseReleaseCapabilities,
  readChannelSha256,
  readChannelString,
  resolveVersionedReleaseAsset,
} from "./release-channel.js";
import type { RuntimeSignature } from "./runtime-manifest.js";
import { canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

interface DesktopChannelManifestIdentity {
  manifest: string;
  manifestSha256: string;
}

export interface DesktopChannel {
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
  wslEngine: DesktopChannelManifestIdentity & {
    version: string;
    nodeVersion: string;
  };
  factoryProduct: {
    version: string;
    releaseTag: string;
    runtimes: Record<"win32-x64" | "linux-x64", DesktopChannelManifestIdentity>;
  };
  signature: RuntimeSignature;
}

export function resolveDesktopChannelUrl(env: NodeJS.ProcessEnv, compiledUrl: string): string {
  const override = env.CODER_STUDIO_DESKTOP_CHANNEL_URL?.trim();
  if (env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1" && override) {
    return new URL(override).toString();
  }
  const compiled = compiledUrl.trim();
  return compiled ? new URL(compiled).toString() : "";
}

export function resolveDesktopRuntimePublicKey(
  env: NodeJS.ProcessEnv,
  compiledKey: string,
  readKeyFile: (path: string) => string
): string {
  const keyPath = env.CODER_STUDIO_DESKTOP_PUBLIC_KEY_FILE?.trim();
  if (env.CODER_STUDIO_DESKTOP_ACCEPTANCE !== "1" || !keyPath) {
    return compiledKey.trim();
  }
  const key = readKeyFile(keyPath).trim();
  if (!key) throw new Error("Desktop acceptance public key file is empty");
  return key;
}

export function shouldForceAcceptanceRuntimeHealthFailure(
  env: NodeJS.ProcessEnv,
  source: "factory" | "active" | "pending",
  runtimeVersion: string
): boolean {
  return (
    env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1" &&
    source === "pending" &&
    env.CODER_STUDIO_DESKTOP_FAIL_RUNTIME_VERSION?.trim() === runtimeVersion
  );
}

function parseManifestIdentity(
  value: unknown,
  label: string,
  channelUrl: string,
  releaseTag: string
): DesktopChannelManifestIdentity {
  if (!value || typeof value !== "object") throw new Error(`${label} must be an object`);
  const candidate = value as Record<string, unknown>;
  const identity = {
    manifest: readChannelString(candidate.manifest, `${label}.manifest`),
    manifestSha256: readChannelSha256(candidate.manifestSha256, `${label}.manifestSha256`),
  };
  resolveVersionedReleaseAsset(channelUrl, releaseTag, identity.manifest);
  return identity;
}

export function parseDesktopChannel(
  value: unknown,
  publicKeyPem: string,
  channelUrl: string,
  options: { allowUnsigned?: boolean } = {}
): DesktopChannel {
  if (!value || typeof value !== "object") throw new Error("Desktop channel must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Desktop channel schema");
  if (candidate.channel !== "desktop") throw new Error("Desktop channel kind is unsupported");
  const version = readChannelString(candidate.version, "Desktop channel version");
  const releaseTag = readChannelString(candidate.releaseTag, "Desktop channel releaseTag");
  if (!candidate.shell || typeof candidate.shell !== "object") {
    throw new Error("Desktop channel shell must be an object");
  }
  const shellValue = candidate.shell as Record<string, unknown>;
  const shellCapabilities = parseReleaseCapabilities(shellValue, "Desktop channel shell");
  const shell = {
    version: readChannelString(shellValue.version, "Desktop channel shell.version"),
    publishedAt: parseChannelTimestamp(shellValue.publishedAt, "Desktop channel shell.publishedAt"),
    updaterMetadata: readChannelString(
      shellValue.updaterMetadata,
      "Desktop channel shell.updaterMetadata"
    ),
    installer: readChannelString(shellValue.installer, "Desktop channel shell.installer"),
    ...shellCapabilities,
  };
  if (shell.version !== version) {
    throw new Error("Desktop channel Shell must use the Desktop version");
  }
  resolveVersionedReleaseAsset(channelUrl, releaseTag, shell.updaterMetadata);
  resolveVersionedReleaseAsset(channelUrl, releaseTag, shell.installer);

  if (!candidate.wslEngine || typeof candidate.wslEngine !== "object") {
    throw new Error("Desktop channel wslEngine must be an object");
  }
  const wslEngineValue = candidate.wslEngine as Record<string, unknown>;
  const wslEngine = {
    version: readChannelString(wslEngineValue.version, "Desktop channel wslEngine.version"),
    nodeVersion: readChannelString(
      wslEngineValue.nodeVersion,
      "Desktop channel wslEngine.nodeVersion"
    ),
    ...parseManifestIdentity(wslEngineValue, "Desktop channel wslEngine", channelUrl, releaseTag),
  };
  if (wslEngine.version !== shell.engineVersion || wslEngine.nodeVersion !== shell.nodeVersion) {
    throw new Error("Desktop channel Windows and WSL Engines must use the same versions");
  }

  if (!candidate.factoryProduct || typeof candidate.factoryProduct !== "object") {
    throw new Error("Desktop channel factoryProduct must be an object");
  }
  const factoryValue = candidate.factoryProduct as Record<string, unknown>;
  const factoryReleaseTag = readChannelString(
    factoryValue.releaseTag,
    "Desktop channel factoryProduct.releaseTag"
  );
  if (!factoryValue.runtimes || typeof factoryValue.runtimes !== "object") {
    throw new Error("Desktop channel factoryProduct.runtimes must be an object");
  }
  const factoryRuntimes = factoryValue.runtimes as Record<string, unknown>;
  const factoryProduct = {
    version: readChannelString(factoryValue.version, "Desktop channel factoryProduct.version"),
    releaseTag: factoryReleaseTag,
    runtimes: {
      "win32-x64": parseManifestIdentity(
        factoryRuntimes["win32-x64"],
        "Desktop channel factoryProduct.win32-x64",
        channelUrl,
        factoryReleaseTag
      ),
      "linux-x64": parseManifestIdentity(
        factoryRuntimes["linux-x64"],
        "Desktop channel factoryProduct.linux-x64",
        channelUrl,
        factoryReleaseTag
      ),
    },
  };

  const channel: DesktopChannel = {
    schemaVersion: 1,
    channel: "desktop",
    version,
    releaseTag,
    generatedAt: parseChannelTimestamp(candidate.generatedAt, "Desktop channel generatedAt"),
    shell,
    wslEngine,
    factoryProduct,
    signature: candidate.signature as RuntimeSignature,
  };
  if (
    !options.allowUnsigned &&
    !verifyEd25519Payload(canonicalSigningPayload(channel), channel.signature, publicKeyPem)
  ) {
    throw new Error("Desktop channel signature is invalid");
  }
  return channel;
}
