import {
  assertSafeReleaseAssetName,
  assertSafeReleaseTag,
  parseChannelTimestamp,
  parseReleaseCapabilities,
  type ReleaseCapabilities,
  readChannelSha256,
  readChannelString,
  resolveVersionedReleaseAsset,
} from "./release-channel.js";
import type { RuntimeSignature } from "./runtime-manifest.js";
import { canonicalSigningPayload, verifyEd25519Payload } from "./signed-json.js";

export interface ProductChannelRuntime {
  version: string;
  publishedAt: string;
  manifest: string;
  manifestSha256: string;
}

export type ProductRuntimeTarget = "win32-x64" | "linux-x64";

export interface FactoryProductProvenance {
  schemaVersion: 1;
  version: string;
  releaseTag: string;
  runtimes: Record<
    ProductRuntimeTarget,
    Pick<ProductChannelRuntime, "manifest" | "manifestSha256">
  >;
}

export interface ProductChannel {
  schemaVersion: 1;
  channel: "product";
  version: string;
  releaseTag: string;
  generatedAt: string;
  minShellVersion: string;
  requirements: ReleaseCapabilities;
  runtimes: Record<"win32-x64" | "linux-x64", ProductChannelRuntime>;
  signature: RuntimeSignature;
}

export function resolveProductChannelUrl(env: NodeJS.ProcessEnv, compiledUrl: string): string {
  const override = env.CODER_STUDIO_PRODUCT_CHANNEL_URL?.trim();
  if (env.CODER_STUDIO_DESKTOP_ACCEPTANCE === "1" && override) {
    return new URL(override).toString();
  }
  const compiled = compiledUrl.trim();
  return compiled ? new URL(compiled).toString() : "";
}

export function parseFactoryProductProvenance(value: unknown): FactoryProductProvenance {
  if (!value || typeof value !== "object") throw new Error("Factory Product must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Factory Product schema");
  const version = readChannelString(candidate.version, "Factory Product version");
  const releaseTag = readChannelString(candidate.releaseTag, "Factory Product releaseTag");
  assertSafeReleaseTag(releaseTag);
  if (!candidate.runtimes || typeof candidate.runtimes !== "object") {
    throw new Error("Factory Product runtimes must be an object");
  }
  const runtimes = candidate.runtimes as Record<string, unknown>;
  const parseIdentity = (target: ProductRuntimeTarget) => {
    const value = runtimes[target];
    if (!value || typeof value !== "object") {
      throw new Error(`Factory Product ${target} is missing`);
    }
    const identity = value as Record<string, unknown>;
    const manifest = readChannelString(identity.manifest, `Factory Product ${target}.manifest`);
    assertSafeReleaseAssetName(manifest);
    return {
      manifest,
      manifestSha256: readChannelSha256(
        identity.manifestSha256,
        `Factory Product ${target}.manifestSha256`
      ),
    };
  };
  return {
    schemaVersion: 1,
    version,
    releaseTag,
    runtimes: {
      "win32-x64": parseIdentity("win32-x64"),
      "linux-x64": parseIdentity("linux-x64"),
    },
  };
}

function parseRuntime(
  value: unknown,
  label: string,
  channelUrl: string,
  releaseTag: string
): ProductChannelRuntime {
  if (!value || typeof value !== "object") {
    throw new Error(`Product channel ${label} Runtime must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const runtime = {
    version: readChannelString(candidate.version, `Product channel ${label}.version`),
    publishedAt: parseChannelTimestamp(
      candidate.publishedAt,
      `Product channel ${label}.publishedAt`
    ),
    manifest: readChannelString(candidate.manifest, `Product channel ${label}.manifest`),
    manifestSha256: readChannelSha256(
      candidate.manifestSha256,
      `Product channel ${label}.manifestSha256`
    ),
  };
  resolveVersionedReleaseAsset(channelUrl, releaseTag, runtime.manifest);
  return runtime;
}

export function parseProductChannel(
  value: unknown,
  publicKeyPem: string,
  channelUrl: string,
  options: { allowUnsigned?: boolean } = {}
): ProductChannel {
  if (!value || typeof value !== "object") throw new Error("Product channel must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) throw new Error("Unsupported Product channel schema");
  if (candidate.channel !== "product") throw new Error("Product channel kind is unsupported");
  const version = readChannelString(candidate.version, "Product channel version");
  const releaseTag = readChannelString(candidate.releaseTag, "Product channel releaseTag");
  if (!candidate.runtimes || typeof candidate.runtimes !== "object") {
    throw new Error("Product channel runtimes must be an object");
  }
  const runtimeValues = candidate.runtimes as Record<string, unknown>;
  const windows = parseRuntime(runtimeValues["win32-x64"], "win32-x64", channelUrl, releaseTag);
  const linux = parseRuntime(runtimeValues["linux-x64"], "linux-x64", channelUrl, releaseTag);
  if (windows.version !== version || linux.version !== version) {
    throw new Error("Product channel Runtimes must use the same Product version");
  }
  if (windows.publishedAt !== linux.publishedAt) {
    throw new Error("Product channel Runtimes must use the same publication time");
  }
  const channel: ProductChannel = {
    schemaVersion: 1,
    channel: "product",
    version,
    releaseTag,
    generatedAt: parseChannelTimestamp(candidate.generatedAt, "Product channel generatedAt"),
    minShellVersion: readChannelString(
      candidate.minShellVersion,
      "Product channel minShellVersion"
    ),
    requirements: parseReleaseCapabilities(candidate.requirements, "Product channel requirements"),
    runtimes: { "win32-x64": windows, "linux-x64": linux },
    signature: candidate.signature as RuntimeSignature,
  };
  if (
    !options.allowUnsigned &&
    !verifyEd25519Payload(canonicalSigningPayload(channel), channel.signature, publicKeyPem)
  ) {
    throw new Error("Product channel signature is invalid");
  }
  return channel;
}
