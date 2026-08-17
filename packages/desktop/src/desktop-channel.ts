import { normalizeUtcTimestamp } from "./build-info.js";
import { isSafeRuntimeRelativePath, type RuntimeSignature } from "./runtime-manifest.js";
import { canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

export interface DesktopChannelRuntime {
  version: string;
  publishedAt: string;
  manifest: string;
}

export interface DesktopChannel {
  schemaVersion: 1;
  channel: "stable" | "prerelease";
  releaseTag: string;
  generatedAt: string;
  shell: {
    version: string;
    publishedAt: string;
    updaterMetadata: "latest.yml" | "modern.yml";
    engineVersion: string;
    nodeVersion: string;
    runtimeHostApiVersion: number;
    apiProtocolVersion: number;
    dataSchemaVersion: number;
  };
  runtimes: Record<"win32-x64" | "linux-x64", DesktopChannelRuntime>;
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

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Desktop channel ${label} must be a non-empty string`);
  }
  return value.trim();
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`Desktop channel ${label} must be a positive integer`);
  }
  return value as number;
}

function parseRuntime(value: unknown, label: string): DesktopChannelRuntime {
  if (!value || typeof value !== "object") {
    throw new Error(`Desktop channel ${label} Runtime must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  return {
    version: readString(candidate.version, `${label}.version`),
    publishedAt: normalizeUtcTimestamp(candidate.publishedAt, `${label}.publishedAt`),
    manifest: readString(candidate.manifest, `${label}.manifest`),
  };
}

export function resolveChannelAsset(indexUrl: string, relativePath: string): string {
  if (!isSafeRuntimeRelativePath(relativePath) || relativePath.includes("/")) {
    throw new Error("Desktop channel asset path is unsafe");
  }
  const index = new URL(indexUrl);
  const asset = new URL(relativePath, index);
  if (asset.origin !== index.origin || asset.username || asset.password) {
    throw new Error("Desktop channel asset changed origin");
  }
  return asset.toString();
}

export function parseDesktopChannel(
  value: unknown,
  publicKeyPem: string,
  indexUrl: string,
  options: { allowUnsigned?: boolean } = {}
): DesktopChannel {
  if (!value || typeof value !== "object") throw new Error("Desktop channel must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Desktop channel schema");
  if (candidate.channel !== "stable" && candidate.channel !== "prerelease") {
    throw new Error("Desktop channel kind is unsupported");
  }
  if (!candidate.shell || typeof candidate.shell !== "object") {
    throw new Error("Desktop channel shell must be an object");
  }
  if (!candidate.runtimes || typeof candidate.runtimes !== "object") {
    throw new Error("Desktop channel runtimes must be an object");
  }
  const shellValue = candidate.shell as Record<string, unknown>;
  if (shellValue.updaterMetadata !== "latest.yml" && shellValue.updaterMetadata !== "modern.yml") {
    throw new Error("Desktop channel updaterMetadata is unsupported");
  }
  const runtimeValues = candidate.runtimes as Record<string, unknown>;
  const windows = parseRuntime(runtimeValues["win32-x64"], "win32-x64");
  const linux = parseRuntime(runtimeValues["linux-x64"], "linux-x64");
  if (windows.version !== linux.version) {
    throw new Error("Desktop channel Runtimes must use the same product version");
  }
  resolveChannelAsset(indexUrl, windows.manifest);
  resolveChannelAsset(indexUrl, linux.manifest);

  const channel: DesktopChannel = {
    schemaVersion: 1,
    channel: candidate.channel,
    releaseTag: readString(candidate.releaseTag, "releaseTag"),
    generatedAt: normalizeUtcTimestamp(candidate.generatedAt, "generatedAt"),
    shell: {
      version: readString(shellValue.version, "shell.version"),
      publishedAt: normalizeUtcTimestamp(shellValue.publishedAt, "shell.publishedAt"),
      updaterMetadata: shellValue.updaterMetadata,
      engineVersion: readString(shellValue.engineVersion, "shell.engineVersion"),
      nodeVersion: readString(shellValue.nodeVersion, "shell.nodeVersion"),
      runtimeHostApiVersion: readPositiveInteger(
        shellValue.runtimeHostApiVersion,
        "shell.runtimeHostApiVersion"
      ),
      apiProtocolVersion: readPositiveInteger(
        shellValue.apiProtocolVersion,
        "shell.apiProtocolVersion"
      ),
      dataSchemaVersion: readPositiveInteger(
        shellValue.dataSchemaVersion,
        "shell.dataSchemaVersion"
      ),
    },
    runtimes: { "win32-x64": windows, "linux-x64": linux },
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
