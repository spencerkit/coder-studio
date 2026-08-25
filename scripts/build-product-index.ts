import { createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeJsonFileAtomic } from "../packages/desktop/src/atomic-json-file.js";
import {
  type ProductChannel,
  parseProductChannel,
} from "../packages/desktop/src/product-channel.js";
import {
  type ProductIndex,
  type ProductIndexRelease,
  parseProductIndex,
} from "../packages/desktop/src/product-index.js";
import { compareVersions } from "../packages/desktop/src/runtime-manifest.js";
import {
  type CanonicalJson,
  canonicalizeJson,
  canonicalSigningPayload,
} from "../packages/desktop/src/signed-json.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const DEFAULT_PRODUCT_CHANNEL_URL =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json";
const DEFAULT_PRODUCT_INDEX_URL =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-index.json";

export interface BuildProductIndexOptions {
  candidateChannelFile: string;
  existingIndexFile?: string;
  previousChannelFile?: string;
  publicKeyPem: string;
  privateKeyPem: string;
  generatedAt?: string;
  outputFile: string;
  productChannelUrl?: string;
  productIndexUrl?: string;
}

interface ProductIndexCommand {
  candidateChannelFile: string;
  existingIndexFile?: string;
  previousChannelFile?: string;
  publicKeyFile: string;
  privateKeyFile: string;
  generatedAt?: string;
  outputFile: string;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function toIndexRelease(channel: ProductChannel): ProductIndexRelease {
  const windowsPublishedAt = channel.runtimes["win32-x64"].publishedAt;
  if (windowsPublishedAt !== channel.runtimes["linux-x64"].publishedAt) {
    throw new Error("Product channel Runtime publication timestamps must match");
  }
  return {
    version: channel.version,
    releaseTag: channel.releaseTag,
    publishedAt: windowsPublishedAt,
    minShellVersion: channel.minShellVersion,
    requirements: channel.requirements,
    runtimes: {
      "win32-x64": {
        manifest: channel.runtimes["win32-x64"].manifest,
        manifestSha256: channel.runtimes["win32-x64"].manifestSha256,
      },
      "linux-x64": {
        manifest: channel.runtimes["linux-x64"].manifest,
        manifestSha256: channel.runtimes["linux-x64"].manifestSha256,
      },
    },
  };
}

function releaseIdentity(release: ProductIndexRelease): string {
  return canonicalizeJson(release as unknown as CanonicalJson);
}

function mergeRelease(
  releases: ProductIndexRelease[],
  candidate: ProductIndexRelease
): { releases: ProductIndexRelease[]; alreadyPresent: boolean } {
  const sameVersion = releases.find((release) => release.version === candidate.version);
  const sameTag = releases.find((release) => release.releaseTag === candidate.releaseTag);
  if (sameVersion || sameTag) {
    if (
      sameVersion &&
      sameTag &&
      sameVersion === sameTag &&
      releaseIdentity(sameVersion) === releaseIdentity(candidate)
    ) {
      return { releases, alreadyPresent: true };
    }
    throw new Error(
      `Product index release identity conflicts with ${candidate.version} (${candidate.releaseTag})`
    );
  }
  return {
    releases: [...releases, candidate].sort((left, right) =>
      compareVersions(left.version, right.version)
    ),
    alreadyPresent: false,
  };
}

export async function buildProductIndex(options: BuildProductIndexOptions): Promise<ProductIndex> {
  const productChannelUrl = options.productChannelUrl ?? DEFAULT_PRODUCT_CHANNEL_URL;
  const productIndexUrl = options.productIndexUrl ?? DEFAULT_PRODUCT_INDEX_URL;
  const candidate = parseProductChannel(
    await readJson(resolve(options.candidateChannelFile)),
    options.publicKeyPem,
    productChannelUrl
  );
  const candidateRelease = toIndexRelease(candidate);

  let existing: ProductIndex | null = null;
  let releases: ProductIndexRelease[] = [];
  if (options.existingIndexFile) {
    existing = parseProductIndex(
      await readJson(resolve(options.existingIndexFile)),
      options.publicKeyPem,
      productIndexUrl
    );
    releases = existing.releases;
  } else if (options.previousChannelFile) {
    const previous = parseProductChannel(
      await readJson(resolve(options.previousChannelFile)),
      options.publicKeyPem,
      productChannelUrl
    );
    releases = [toIndexRelease(previous)];
  }

  const merged = mergeRelease(releases, candidateRelease);
  const latestVersion = [...merged.releases].sort((left, right) =>
    compareVersions(right.version, left.version)
  )[0]?.version;
  if (!latestVersion) throw new Error("Product index must contain at least one release");
  if (latestVersion !== candidateRelease.version) {
    throw new Error("The accepted Product candidate must be the highest indexed version");
  }
  if (existing && merged.alreadyPresent) {
    await writeJsonFileAtomic(resolve(options.outputFile), existing);
    return existing;
  }

  const unsigned: Omit<ProductIndex, "signature"> = {
    schemaVersion: 1,
    channel: "product-index",
    generatedAt: options.generatedAt ?? candidate.generatedAt,
    latestVersion,
    releases: merged.releases,
  };
  const index: ProductIndex = {
    ...unsigned,
    signature: {
      algorithm: "ed25519",
      value: sign(
        null,
        canonicalSigningPayload(unsigned),
        createPrivateKey(options.privateKeyPem)
      ).toString("base64"),
    },
  };
  const outputFile = resolve(options.outputFile);
  await writeJsonFileAtomic(outputFile, index);
  return parseProductIndex(await readJson(outputFile), options.publicKeyPem, productIndexUrl);
}

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseProductIndexCommand(argvValue: string[]): ProductIndexCommand {
  const argv = argvValue[0] === "--" ? argvValue.slice(1) : argvValue;
  let candidateChannelFile = "";
  let existingIndexFile: string | undefined;
  let previousChannelFile: string | undefined;
  let publicKeyFile = "";
  let privateKeyFile = "";
  let generatedAt: string | undefined;
  let outputFile = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--candidate-channel") {
      candidateChannelFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--existing-index") {
      existingIndexFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--previous-channel") {
      previousChannelFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--public-key") {
      publicKeyFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--private-key") {
      privateKeyFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--generated-at") {
      generatedAt = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--output") {
      outputFile = readArgumentValue(argv, ++index, argument);
    } else {
      throw new Error(`Unknown Product index option: ${argument ?? ""}`);
    }
  }
  if (!candidateChannelFile || !publicKeyFile || !privateKeyFile || !outputFile) {
    throw new Error("--candidate-channel, --public-key, --private-key, and --output are required");
  }
  return {
    candidateChannelFile: resolve(candidateChannelFile),
    ...(existingIndexFile ? { existingIndexFile: resolve(existingIndexFile) } : {}),
    ...(previousChannelFile ? { previousChannelFile: resolve(previousChannelFile) } : {}),
    publicKeyFile: resolve(publicKeyFile),
    privateKeyFile: resolve(privateKeyFile),
    ...(generatedAt ? { generatedAt } : {}),
    outputFile: resolve(outputFile),
  };
}

async function main(): Promise<void> {
  const command = parseProductIndexCommand(process.argv.slice(2));
  const [publicKeyPem, privateKeyPem] = await Promise.all([
    readFile(command.publicKeyFile, "utf8"),
    readFile(command.privateKeyFile, "utf8"),
  ]);
  await buildProductIndex({ ...command, publicKeyPem, privateKeyPem });
  success(`Signed Product index written to ${command.outputFile}`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((indexError) => {
    error(indexError instanceof Error ? indexError.message : String(indexError));
    process.exit(1);
  });
}
