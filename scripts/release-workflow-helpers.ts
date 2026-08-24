import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { error } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export type ReleaseChannelKind = "product" | "desktop";

type CompareAssetsCommand = {
  kind: "compare-assets";
  channel: ReleaseChannelKind;
  expectedRoot: string;
  actualRoot: string;
};

type WriteCandidateOutputsCommand = {
  kind: "write-candidate-outputs";
  channel: ReleaseChannelKind;
  candidateRoot: string;
  outputFile: string;
  candidateTag: string;
  candidateCommit: string;
  npmIntegrity?: string;
};

type VerifyDigestsCommand = {
  kind: "verify-digests";
  channel: ReleaseChannelKind;
  actualRoot: string;
  expectedDigests: string;
};

type VerifyExistingPromotionRecordCommand = {
  kind: "verify-existing-promotion-record";
  channel: ReleaseChannelKind;
  existingRecord: string;
  outputFile: string;
  version: string;
  candidateTag: string;
  candidateCommit: string;
  artifactDigests: string;
  finalPointerDigest: string;
};

type WritePromotionRecordCommand = {
  kind: "write-promotion-record";
  channel: ReleaseChannelKind;
  workflow: string;
  outputFile: string;
  version: string;
  candidateTag: string;
  candidateCommit: string;
  artifactDigests: string;
  previousPointerDigest?: string;
  finalPointerDigest: string;
};

type ReleaseWorkflowCommand =
  | CompareAssetsCommand
  | WriteCandidateOutputsCommand
  | VerifyDigestsCommand
  | VerifyExistingPromotionRecordCommand
  | WritePromotionRecordCommand;

const PRODUCT_RUNTIME_KEYS = [
  "product-channel.json",
  "coder-studio-runtime-win32-x64.manifest.json",
  "coder-studio-server-runtime-linux-x64.manifest.json",
] as const;

function readChannelLabel(channel: ReleaseChannelKind): string {
  return channel === "product" ? "Product" : "Desktop";
}

function readRequired(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readChannel(value: string | undefined): ReleaseChannelKind {
  if (value === "product" || value === "desktop") return value;
  throw new Error(`Unknown release workflow channel: ${value ?? ""}`);
}

function parseOptionArguments(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unknown release workflow option: ${argument ?? ""}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options.set(argument, value);
    index += 1;
  }
  return options;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readReleaseFiles(root: string): string[] {
  return readdirSync(resolve(root), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "promotion.json")
    .map((entry) => entry.name)
    .sort();
}

function readArtifactDigests(root: string): Record<string, string> {
  return Object.fromEntries(
    readReleaseFiles(root).map((name) => [name, sha256File(join(resolve(root), name))])
  );
}

function normalizeDigestEntries(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([name, digest]) => {
        if (typeof digest !== "string") {
          throw new Error(`Digest for ${name} must be a string`);
        }
        return [name, digest] as const;
      })
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function parseArtifactDigests(value: string): Record<string, string> {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Artifact digests must be a JSON object");
  }
  return normalizeDigestEntries(parsed as Record<string, unknown>);
}

export function compareCandidateAssets(
  channel: ReleaseChannelKind,
  expectedRoot: string,
  actualRoot: string
): void {
  const label = readChannelLabel(channel);
  const expected = readReleaseFiles(expectedRoot);
  const actual = readReleaseFiles(actualRoot);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Immutable ${label} release asset set differs from the candidate bundle`);
  }
  for (const name of expected) {
    if (
      sha256File(join(resolve(expectedRoot), name)) !== sha256File(join(resolve(actualRoot), name))
    ) {
      throw new Error(`Immutable ${label} release asset differs: ${name}`);
    }
  }
}

type CandidateIdentityOptions = Omit<WriteCandidateOutputsCommand, "kind">;

export function writeCandidateIdentityOutputs(
  options: CandidateIdentityOptions
): Record<string, string> {
  const digests = readArtifactDigests(options.candidateRoot);
  if (options.channel === "product") {
    for (const key of PRODUCT_RUNTIME_KEYS) {
      if (!digests[key]) throw new Error(`Missing Product candidate artifact digest: ${key}`);
    }
    if (!options.npmIntegrity) {
      throw new Error("Product candidate identity requires npm integrity");
    }
  } else if (!digests["desktop-channel.json"]) {
    throw new Error("Missing Desktop candidate artifact digest: desktop-channel.json");
  }

  const lines =
    options.channel === "product"
      ? [
          `candidate_tag=${options.candidateTag}`,
          `product_channel_sha256=${digests["product-channel.json"]}`,
          `windows_manifest_sha256=${digests["coder-studio-runtime-win32-x64.manifest.json"]}`,
          `linux_manifest_sha256=${digests["coder-studio-server-runtime-linux-x64.manifest.json"]}`,
          `npm_integrity=${options.npmIntegrity}`,
          `artifact_digests=${JSON.stringify(digests)}`,
          `candidate_commit=${options.candidateCommit}`,
          "",
        ]
      : [
          `candidate_tag=${options.candidateTag}`,
          `desktop_channel_sha256=${digests["desktop-channel.json"]}`,
          `artifact_digests=${JSON.stringify(digests)}`,
          `candidate_commit=${options.candidateCommit}`,
          "",
        ];
  appendFileSync(resolve(options.outputFile), lines.join("\n"));
  return digests;
}

export function verifyReleaseDigests(
  channel: ReleaseChannelKind,
  actualRoot: string,
  expectedDigestsValue: string
): void {
  const expectedDigests = parseArtifactDigests(expectedDigestsValue);
  const actualNames = readReleaseFiles(actualRoot);
  const expectedNames = Object.keys(expectedDigests).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Immutable ${readChannelLabel(channel)} digest mismatch: release asset set`);
  }
  for (const [name, digest] of Object.entries(expectedDigests)) {
    const actualDigest = sha256File(join(resolve(actualRoot), name));
    if (actualDigest !== digest) {
      throw new Error(`Immutable ${readChannelLabel(channel)} digest mismatch: ${name}`);
    }
  }
}

type PromotionRecord = {
  schemaVersion: 1;
  channel: ReleaseChannelKind;
  version: string;
  commit: string;
  candidateTag: string;
  artifactDigests: Record<string, string>;
  acceptanceRun: {
    workflow: string;
    runId: string;
    attempt: number;
  };
  previousPointerDigest: string | null;
  finalPointerDigest: string;
  promotedAt: string;
};

type VerifyPromotionRecordOptions = Omit<VerifyExistingPromotionRecordCommand, "kind">;

export function verifyExistingPromotionRecord(
  options: VerifyPromotionRecordOptions
): PromotionRecord {
  const existing = JSON.parse(
    readFileSync(resolve(options.existingRecord), "utf8")
  ) as PromotionRecord;
  const expectedDigests = parseArtifactDigests(options.artifactDigests);
  const matches =
    existing.schemaVersion === 1 &&
    existing.channel === options.channel &&
    existing.version === options.version &&
    existing.commit === options.candidateCommit &&
    existing.candidateTag === options.candidateTag &&
    JSON.stringify(normalizeDigestEntries(existing.artifactDigests)) ===
      JSON.stringify(expectedDigests) &&
    existing.finalPointerDigest === options.finalPointerDigest;
  if (!matches) {
    throw new Error(
      `Existing ${readChannelLabel(options.channel)} promotion record differs from accepted identity`
    );
  }
  mkdirSync(dirname(resolve(options.outputFile)), { recursive: true });
  copyFileSync(resolve(options.existingRecord), resolve(options.outputFile));
  return existing;
}

type WritePromotionRecordOptions = Omit<WritePromotionRecordCommand, "kind">;

export function writePromotionRecord(options: WritePromotionRecordOptions): PromotionRecord {
  const promotion: PromotionRecord = {
    schemaVersion: 1,
    channel: options.channel,
    version: options.version,
    commit: options.candidateCommit,
    candidateTag: options.candidateTag,
    artifactDigests: parseArtifactDigests(options.artifactDigests),
    acceptanceRun: {
      workflow: options.workflow,
      runId: process.env.GITHUB_RUN_ID ?? "",
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? "0"),
    },
    previousPointerDigest: options.previousPointerDigest || null,
    finalPointerDigest: options.finalPointerDigest,
    promotedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(resolve(options.outputFile)), { recursive: true });
  writeFileSync(resolve(options.outputFile), `${JSON.stringify(promotion, null, 2)}\n`);
  return promotion;
}

export function parseReleaseWorkflowCommand(argv: string[]): ReleaseWorkflowCommand {
  const [kind, ...args] = argv;
  const options = parseOptionArguments(args);
  switch (kind) {
    case "compare-assets":
      return {
        kind,
        channel: readChannel(options.get("--channel")),
        expectedRoot: readRequired(options.get("--expected-root"), "--expected-root"),
        actualRoot: readRequired(options.get("--actual-root"), "--actual-root"),
      };
    case "write-candidate-outputs":
      return {
        kind,
        channel: readChannel(options.get("--channel")),
        candidateRoot: readRequired(options.get("--candidate-root"), "--candidate-root"),
        outputFile: readRequired(options.get("--output-file"), "--output-file"),
        candidateTag: readRequired(options.get("--candidate-tag"), "--candidate-tag"),
        candidateCommit: readRequired(options.get("--candidate-commit"), "--candidate-commit"),
        npmIntegrity: options.get("--npm-integrity"),
      };
    case "verify-digests":
      return {
        kind,
        channel: readChannel(options.get("--channel")),
        actualRoot: readRequired(options.get("--actual-root"), "--actual-root"),
        expectedDigests: readRequired(options.get("--expected-digests"), "--expected-digests"),
      };
    case "verify-existing-promotion-record":
      return {
        kind,
        channel: readChannel(options.get("--channel")),
        existingRecord: readRequired(options.get("--existing-record"), "--existing-record"),
        outputFile: readRequired(options.get("--output-file"), "--output-file"),
        version: readRequired(options.get("--version"), "--version"),
        candidateTag: readRequired(options.get("--candidate-tag"), "--candidate-tag"),
        candidateCommit: readRequired(options.get("--candidate-commit"), "--candidate-commit"),
        artifactDigests: readRequired(options.get("--artifact-digests"), "--artifact-digests"),
        finalPointerDigest: readRequired(
          options.get("--final-pointer-digest"),
          "--final-pointer-digest"
        ),
      };
    case "write-promotion-record":
      return {
        kind,
        channel: readChannel(options.get("--channel")),
        workflow: readRequired(options.get("--workflow"), "--workflow"),
        outputFile: readRequired(options.get("--output-file"), "--output-file"),
        version: readRequired(options.get("--version"), "--version"),
        candidateTag: readRequired(options.get("--candidate-tag"), "--candidate-tag"),
        candidateCommit: readRequired(options.get("--candidate-commit"), "--candidate-commit"),
        artifactDigests: readRequired(options.get("--artifact-digests"), "--artifact-digests"),
        previousPointerDigest: options.get("--previous-pointer-digest"),
        finalPointerDigest: readRequired(
          options.get("--final-pointer-digest"),
          "--final-pointer-digest"
        ),
      };
    default:
      throw new Error(`Unknown release workflow command: ${kind ?? ""}`);
  }
}

async function main(): Promise<void> {
  const command = parseReleaseWorkflowCommand(process.argv.slice(2));
  switch (command.kind) {
    case "compare-assets":
      compareCandidateAssets(command.channel, command.expectedRoot, command.actualRoot);
      return;
    case "write-candidate-outputs":
      writeCandidateIdentityOutputs(command);
      return;
    case "verify-digests":
      verifyReleaseDigests(command.channel, command.actualRoot, command.expectedDigests);
      return;
    case "verify-existing-promotion-record":
      verifyExistingPromotionRecord(command);
      return;
    case "write-promotion-record":
      writePromotionRecord(command);
      return;
  }
}

if (isDirectExecution(import.meta.url)) {
  main().catch((releaseWorkflowError) => {
    error(
      releaseWorkflowError instanceof Error
        ? releaseWorkflowError.message
        : String(releaseWorkflowError)
    );
    process.exit(1);
  });
}
