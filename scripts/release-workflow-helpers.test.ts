import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareCandidateAssets,
  parseReleaseWorkflowCommand,
  verifyExistingPromotionRecord,
  verifyReleaseDigests,
  writeCandidateIdentityOutputs,
  writePromotionRecord,
} from "./release-workflow-helpers.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  delete process.env.GITHUB_RUN_ID;
  delete process.env.GITHUB_RUN_ATTEMPT;
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-release-workflow-"));
  roots.push(root);
  return root;
}

async function writeProductCandidate(root: string, marker = "candidate") {
  await Promise.all([
    writeFile(join(root, "product-channel.json"), `${marker}-channel\n`),
    writeFile(join(root, "coder-studio-runtime-win32-x64.manifest.json"), `${marker}-windows\n`),
    writeFile(
      join(root, "coder-studio-server-runtime-linux-x64.manifest.json"),
      `${marker}-linux\n`
    ),
  ]);
}

describe("release workflow helpers", () => {
  it("parses compare-assets and write-promotion-record commands", () => {
    expect(
      parseReleaseWorkflowCommand([
        "compare-assets",
        "--channel",
        "product",
        "--expected-root",
        "release/product-candidate",
        "--actual-root",
        "release/existing-candidate",
      ])
    ).toEqual({
      kind: "compare-assets",
      channel: "product",
      expectedRoot: "release/product-candidate",
      actualRoot: "release/existing-candidate",
    });
    expect(
      parseReleaseWorkflowCommand([
        "write-promotion-record",
        "--channel",
        "desktop",
        "--workflow",
        "desktop-release",
        "--output-file",
        "release/desktop-promotion/record/promotion.json",
        "--version",
        "0.1.4",
        "--candidate-tag",
        "desktop-v0.1.4",
        "--candidate-commit",
        "abc123",
        "--artifact-digests",
        '{"desktop-channel.json":"deadbeef"}',
        "--final-pointer-digest",
        "deadbeef",
      ])
    ).toMatchObject({
      kind: "write-promotion-record",
      channel: "desktop",
      workflow: "desktop-release",
    });
  });

  it("compares immutable candidate assets and verifies digest maps", async () => {
    const expectedRoot = await fixtureRoot();
    const actualRoot = await fixtureRoot();
    const outputRoot = await fixtureRoot();
    await writeProductCandidate(expectedRoot);
    await writeProductCandidate(actualRoot);

    compareCandidateAssets("product", expectedRoot, actualRoot);

    const outputFile = join(outputRoot, "github-output.txt");
    const digests = writeCandidateIdentityOutputs({
      channel: "product",
      candidateRoot: actualRoot,
      outputFile,
      candidateTag: "v0.5.13",
      candidateCommit: "8d4499215ec080dbec242e403a5140acc7399bb0",
      npmIntegrity: "sha512-example",
    });
    verifyReleaseDigests("product", actualRoot, JSON.stringify(digests));

    const output = await readFile(outputFile, "utf8");
    expect(output).toContain("candidate_tag=v0.5.13");
    expect(output).toContain("product_channel_sha256=");
    expect(output).toContain("windows_manifest_sha256=");
    expect(output).toContain("linux_manifest_sha256=");
    expect(output).toContain("npm_integrity=sha512-example");
  });

  it("rejects immutable candidate asset mismatches", async () => {
    const expectedRoot = await fixtureRoot();
    const actualRoot = await fixtureRoot();
    await writeProductCandidate(expectedRoot, "expected");
    await writeProductCandidate(actualRoot, "actual");

    expect(() => compareCandidateAssets("product", expectedRoot, actualRoot)).toThrow(
      "Immutable Product release asset differs: coder-studio-runtime-win32-x64.manifest.json"
    );
  });

  it("writes and reuses matching promotion records", async () => {
    const root = await fixtureRoot();
    const outputFile = join(root, "promotion.json");
    const copiedFile = join(root, "copied-promotion.json");
    process.env.GITHUB_RUN_ID = "12345";
    process.env.GITHUB_RUN_ATTEMPT = "2";

    const promotion = writePromotionRecord({
      channel: "desktop",
      workflow: "desktop-release",
      outputFile,
      version: "0.1.4",
      candidateTag: "desktop-v0.1.4",
      candidateCommit: "8d4499215ec080dbec242e403a5140acc7399bb0",
      artifactDigests: '{"desktop-channel.json":"deadbeef"}',
      previousPointerDigest: "",
      finalPointerDigest: "deadbeef",
    });
    expect(promotion.acceptanceRun).toEqual({
      workflow: "desktop-release",
      runId: "12345",
      attempt: 2,
    });

    const reused = verifyExistingPromotionRecord({
      channel: "desktop",
      existingRecord: outputFile,
      outputFile: copiedFile,
      version: "0.1.4",
      candidateTag: "desktop-v0.1.4",
      candidateCommit: "8d4499215ec080dbec242e403a5140acc7399bb0",
      artifactDigests: '{"desktop-channel.json":"deadbeef"}',
      finalPointerDigest: "deadbeef",
    });
    expect(reused.finalPointerDigest).toBe("deadbeef");
    await expect(readFile(copiedFile, "utf8")).resolves.toContain('"channel": "desktop"');
  });
});
