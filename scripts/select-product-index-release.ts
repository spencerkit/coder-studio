import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeJsonFileAtomic } from "../packages/desktop/src/atomic-json-file.js";
import { parseDesktopBuildInfo } from "../packages/desktop/src/build-info.js";
import {
  listCompatibleProductReleases,
  listProductReleases,
  type ProductCompatibilityHost,
  parseProductIndex,
} from "../packages/desktop/src/product-index.js";
import { compareVersions } from "../packages/desktop/src/runtime-manifest.js";
import { error, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const DEFAULT_PRODUCT_INDEX_URL =
  "https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-index.json";

export interface SelectProductIndexReleaseOptions {
  indexFile: string;
  buildInfoFile: string;
  publicKeyPem: string;
  outputFile: string;
  requiredVersion?: string;
  previousToVersion?: string;
  productIndexUrl?: string;
}

interface SelectProductIndexReleaseCommand
  extends Omit<SelectProductIndexReleaseOptions, "publicKeyPem" | "productIndexUrl"> {
  publicKeyFile: string;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

function compatibilityHost(
  buildInfo: ReturnType<typeof parseDesktopBuildInfo>
): ProductCompatibilityHost {
  if (
    !buildInfo.engineVersion ||
    !buildInfo.nodeVersion ||
    !buildInfo.runtimeHostApiVersion ||
    !buildInfo.apiProtocolVersion ||
    !buildInfo.dataSchemaVersion
  ) {
    throw new Error("Desktop build info does not declare complete Runtime capabilities");
  }
  return {
    shellVersion: buildInfo.shellVersion,
    engineVersion: buildInfo.engineVersion,
    nodeVersion: buildInfo.nodeVersion,
    runtimeHostApiVersion: buildInfo.runtimeHostApiVersion,
    apiProtocolVersion: buildInfo.apiProtocolVersion,
    dataSchemaVersion: buildInfo.dataSchemaVersion,
  };
}

export async function selectProductIndexRelease(
  options: SelectProductIndexReleaseOptions
): Promise<ReturnType<typeof listCompatibleProductReleases>[number]> {
  if (options.requiredVersion && options.previousToVersion) {
    throw new Error("A required Product version cannot be combined with --previous-to-version");
  }
  const index = parseProductIndex(
    await readJson(options.indexFile),
    options.publicKeyPem,
    options.productIndexUrl ?? DEFAULT_PRODUCT_INDEX_URL
  );
  const buildInfo = parseDesktopBuildInfo(await readJson(options.buildInfoFile));
  const compatible = listCompatibleProductReleases(index, compatibilityHost(buildInfo));
  const selected = options.requiredVersion
    ? compatible.find((release) => release.version === options.requiredVersion)
    : options.previousToVersion
      ? listProductReleases(index).find(
          (release) => compareVersions(release.version, options.previousToVersion as string) < 0
        )
      : compatible[0];
  if (!selected) {
    if (options.previousToVersion) {
      throw new Error(
        `No accepted Product Runtime immediately precedes ${options.previousToVersion}`
      );
    }
    const qualifier = options.requiredVersion ? ` ${options.requiredVersion}` : "";
    throw new Error(
      `No accepted Product Runtime${qualifier} is compatible with Desktop Shell ${buildInfo.shellVersion}`
    );
  }
  await writeJsonFileAtomic(resolve(options.outputFile), selected);
  return selected;
}

function readArgumentValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseSelectProductIndexReleaseCommand(
  argvValue: string[]
): SelectProductIndexReleaseCommand {
  const argv = argvValue[0] === "--" ? argvValue.slice(1) : argvValue;
  let indexFile = "";
  let buildInfoFile = "";
  let publicKeyFile = "";
  let outputFile = "";
  let requiredVersion: string | undefined;
  let previousToVersion: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--index") indexFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--build-info") {
      buildInfoFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--public-key") {
      publicKeyFile = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--output") outputFile = readArgumentValue(argv, ++index, argument);
    else if (argument === "--version") {
      requiredVersion = readArgumentValue(argv, ++index, argument);
    } else if (argument === "--previous-to-version") {
      previousToVersion = readArgumentValue(argv, ++index, argument);
    } else throw new Error(`Unknown Product index selection option: ${argument ?? ""}`);
  }
  if (!indexFile || !buildInfoFile || !publicKeyFile || !outputFile) {
    throw new Error("--index, --build-info, --public-key, and --output are required");
  }
  return {
    indexFile: resolve(indexFile),
    buildInfoFile: resolve(buildInfoFile),
    publicKeyFile: resolve(publicKeyFile),
    outputFile: resolve(outputFile),
    ...(requiredVersion ? { requiredVersion } : {}),
    ...(previousToVersion ? { previousToVersion } : {}),
  };
}

async function main(): Promise<void> {
  const command = parseSelectProductIndexReleaseCommand(process.argv.slice(2));
  const publicKeyPem = await readFile(command.publicKeyFile, "utf8");
  const selected = await selectProductIndexRelease({ ...command, publicKeyPem });
  success(`Selected Product Runtime ${selected.version} (${selected.releaseTag})`);
}

if (isDirectExecution(import.meta.url)) {
  main().catch((selectionError) => {
    error(selectionError instanceof Error ? selectionError.message : String(selectionError));
    process.exit(1);
  });
}
