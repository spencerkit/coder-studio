import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface WorkflowStep {
  id?: string;
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface WorkflowJob {
  uses?: string;
  needs?: string | string[];
  if?: string;
  environment?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  with?: Record<string, unknown>;
  strategy?: { matrix?: Record<string, unknown> };
  secrets?: Record<string, string> | "inherit";
  steps?: WorkflowStep[];
}

interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, WorkflowJob>;
}

const workflowsRoot = resolve(import.meta.dirname, "../.github/workflows");

function workflowPath(name: string): string {
  return resolve(workflowsRoot, name);
}

function loadWorkflow(name: string): Workflow {
  return parse(readFileSync(workflowPath(name), "utf8")) as Workflow;
}

function jobText(job: WorkflowJob): string {
  return JSON.stringify(job);
}

function step(job: WorkflowJob, name: string): WorkflowStep | undefined {
  return (job.steps ?? []).find((candidate) => candidate.name === name);
}

describe("repository verification workflows", () => {
  it("keeps repository CI fast and reusable", () => {
    const workflow = loadWorkflow("ci.yml");
    expect(workflow.on).toEqual({
      workflow_call: null,
      pull_request: null,
      push: { branches: ["main"] },
    });
    expect(Object.keys(workflow.jobs).sort()).toEqual(["verify", "windows-runtime-verify"].sort());
    expect(step(workflow.jobs.verify, "Run type checks")?.run).toBe("pnpm ci:typecheck");
  });

  it("uses split Product and Desktop artifact commands in Desktop verification", () => {
    const workflow = loadWorkflow("desktop-verify.yml");
    const source = readFileSync(workflowPath("desktop-verify.yml"), "utf8");
    const pullRequest = workflow.on.pull_request as { paths: string[] };

    expect(pullRequest.paths).toContain("packages/desktop/**");
    expect(pullRequest.paths).toContain("packages/cli/**");
    expect(source).toContain("pnpm release:artifacts stage-product");
    expect(source).toContain("--components win-runtime");
    expect(source).toContain("--components wsl-runtime");
    expect(source).toContain("pnpm release:artifacts stage-desktop");
    expect(source).toContain("--components windows");
    expect(source).toContain("--components wsl-engine");
    expect(source).toContain("pnpm release:artifacts validate-product");
    expect(source).toContain("pnpm release:artifacts validate-desktop");
    expect(source).not.toContain("desktop:artifacts");
    expect(source).not.toContain("--release-kind");
    expect(source).not.toContain("--previous-release-directory");
  });
});

describe("Product publication workflow", () => {
  it("triggers only for Product version releases and supports idempotent recovery", () => {
    const workflow = loadWorkflow("product-release.yml");
    const push = workflow.on.push as { branches: string[]; paths: string[] };
    const dispatch = workflow.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };

    expect(push).toEqual({
      branches: ["main"],
      paths: ["packages/cli/package.json"],
    });
    expect(dispatch.inputs).toEqual({
      candidate_tag: {
        description: "Existing immutable Product candidate tag to resume",
        required: false,
        default: "",
        type: "string",
      },
      final_dist_tag: {
        description: "Final npm dist-tag advanced after acceptance",
        required: true,
        default: "latest",
        type: "string",
      },
    });
    expect(workflow.concurrency).toEqual({
      group: "product-production",
      "cancel-in-progress": false,
    });
    expect(step(workflow.jobs.prepare, "Resolve immutable Product identity")?.run).toContain(
      'if [[ -n "${REQUESTED_CANDIDATE_TAG}" ]]'
    );
    expect(JSON.stringify(workflow.on)).not.toContain("run_id");
    expect(existsSync(workflowPath("publish.yml"))).toBe(false);
  });

  it("builds one immutable Product candidate and gates automatic promotion on every acceptance", () => {
    const workflow = loadWorkflow("product-release.yml");
    const jobs = workflow.jobs;
    expect(Object.keys(jobs)).toEqual([
      "prepare",
      "windows-runtime",
      "wsl-runtime",
      "publish-candidate",
      "accept-cli",
      "accept-runtime",
      "compatibility",
      "promote",
    ]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(jobs["windows-runtime"].needs).toBe("prepare");
    expect(jobs["wsl-runtime"].needs).toBe("prepare");
    expect(jobs["publish-candidate"].needs).toEqual(["prepare", "windows-runtime", "wsl-runtime"]);
    expect(jobs["accept-cli"].needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs["accept-runtime"].needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs.compatibility.needs).toEqual(["prepare", "publish-candidate"]);
    expect(jobs.promote.needs).toEqual([
      "prepare",
      "publish-candidate",
      "accept-cli",
      "accept-runtime",
      "compatibility",
    ]);
    expect(jobs.promote.if).toBe("success()");
    expect(jobs.promote.environment).toBeUndefined();

    const publish = jobs["publish-candidate"];
    const publishText = jobText(publish);
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write" });
    expect(publishText).toContain("pnpm --dir ./packages/cli pack --json");
    expect(publishText).toContain("pnpm validate:cli-package");
    expect(publishText).toContain("pnpm release:channel product");
    expect(publishText).toContain("pnpm release:artifacts validate-product");
    expect(publishText).toContain("pnpm publish");
    expect(publishText).toContain("ACCEPTANCE_DIST_TAG");
    expect(publishText).toContain("gh release create");
    expect(publishText).toContain("--prerelease --latest=false");
    expect(publishText).toContain("--compare-tarball");
    expect(step(publish, "Record accepted candidate identity")?.run).toContain(
      'entry.name !== "promotion.json"'
    );
    expect(publish.outputs?.candidate_commit).toBeDefined();
    expect(publishText).not.toContain("desktop-channel.json");
    expect(publishText).not.toContain("Coder-Studio-Setup");
    expect(publishText).not.toContain("desktop-release");

    expect(jobText(jobs["accept-cli"])).toContain("pnpm acceptance:cli:update");
    expect(jobText(jobs["accept-runtime"])).toContain("pnpm acceptance:runtime:verify");
    expect(jobText(jobs["accept-runtime"])).toContain("sha256sum");
    expect(jobs["accept-runtime"].strategy?.matrix?.target).toEqual(["native", "wsl"]);
    expect(jobs.compatibility.uses).toBe("./.github/workflows/compatibility-acceptance.yml");
    expect(jobs.compatibility.with).toMatchObject({
      product_tag: "${{ needs.publish-candidate.outputs.candidate_tag }}",
      product_channel_sha256: "${{ needs.publish-candidate.outputs.product_channel_sha256 }}",
      windows_manifest_sha256: "${{ needs.publish-candidate.outputs.windows_manifest_sha256 }}",
      linux_manifest_sha256: "${{ needs.publish-candidate.outputs.linux_manifest_sha256 }}",
      desktop_tag: "${{ needs.prepare.outputs.desktop_tag }}",
      desktop_channel_sha256: "${{ needs.prepare.outputs.desktop_channel_sha256 }}",
    });
  });

  it("promotes npm before Product release and pointer, verifies, then cleans the temporary tag", () => {
    const workflow = loadWorkflow("product-release.yml");
    const promote = workflow.jobs.promote;
    const steps = promote.steps ?? [];
    const immutableIndex = steps.findIndex(
      (candidate) => candidate.name === "Verify accepted immutable Product bytes"
    );
    const npmIndex = steps.findIndex(
      (candidate) => candidate.name === "Advance final npm dist-tag"
    );
    const releaseIndex = steps.findIndex(
      (candidate) => candidate.name === "Promote Product versioned release"
    );
    const pointerIndex = steps.findIndex(
      (candidate) => candidate.name === "Advance signed Product stable pointer"
    );
    const verifyIndex = steps.findIndex(
      (candidate) => candidate.name === "Verify promoted Product"
    );
    const cleanupIndex = steps.findIndex(
      (candidate) => candidate.name === "Remove temporary npm dist-tag"
    );
    const recordIndex = steps.findIndex(
      (candidate) => candidate.name === "Record Product promotion"
    );

    expect(immutableIndex).toBeGreaterThan(-1);
    expect(npmIndex).toBeGreaterThan(immutableIndex);
    expect(releaseIndex).toBeGreaterThan(npmIndex);
    expect(pointerIndex).toBeGreaterThan(releaseIndex);
    expect(verifyIndex).toBeGreaterThan(pointerIndex);
    expect(cleanupIndex).toBeGreaterThan(verifyIndex);
    expect(recordIndex).toBeGreaterThan(cleanupIndex);
    expect(steps[immutableIndex]?.run).toContain("Immutable Product digest mismatch");
    expect(steps[releaseIndex]?.run).toContain("--prerelease=false --latest=false");
    expect(steps[pointerIndex]?.run).toContain("product-stable");
    expect(steps[pointerIndex]?.run).toContain("product-channel.json");
    expect(steps[cleanupIndex]?.run).toContain("npm dist-tag rm");
    expect(steps[recordIndex]?.run).toContain("promotion.json");
    expect(steps[recordIndex]?.run).toContain("previousPointerDigest");
    expect(steps[recordIndex]?.run).toContain("finalPointerDigest");
    expect(steps[recordIndex]?.run).toContain("acceptanceRun");
    expect(steps[recordIndex]?.run).toContain("Existing Product promotion record");
    expect(jobText(promote)).not.toMatch(/pnpm (build|dist)/);
    expect(steps.map((candidate) => candidate.run ?? "").join("\n")).not.toMatch(
      /gh release upload[^\n]*(?:runtime|product-channel\.json)[^\n]*--clobber/
    );
  });
});

describe("reusable compatibility acceptance", () => {
  it("requires explicit immutable Product and Desktop identities", () => {
    const workflow = loadWorkflow("compatibility-acceptance.yml");
    const call = workflow.on.workflow_call as {
      inputs: Record<string, { type: string; required: boolean }>;
    };

    expect(call.inputs).toEqual({
      product_tag: { type: "string", required: true },
      product_channel_sha256: { type: "string", required: true },
      windows_manifest_sha256: { type: "string", required: true },
      linux_manifest_sha256: { type: "string", required: true },
      desktop_tag: { type: "string", required: true },
      desktop_channel_sha256: { type: "string", required: true },
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("downloads only tag-pinned assets, checks digests, and never builds or publishes", () => {
    const workflow = loadWorkflow("compatibility-acceptance.yml");
    const verify = workflow.jobs.verify;
    const text = jobText(verify);
    const download = step(verify, "Download immutable Product and Desktop metadata")?.run;

    expect(Object.keys(workflow.jobs)).toEqual(["verify"]);
    expect(verify.strategy?.matrix?.target).toEqual(["native", "wsl"]);
    expect(download).toContain('gh release download "${PRODUCT_TAG}"');
    expect(download).toContain('gh release download "${DESKTOP_TAG}"');
    expect(text).toContain("PRODUCT_CHANNEL_SHA256");
    expect(text).toContain("WINDOWS_MANIFEST_SHA256");
    expect(text).toContain("LINUX_MANIFEST_SHA256");
    expect(text).toContain("DESKTOP_CHANNEL_SHA256");
    expect(text).toContain("sha256sum");
    expect(text).toContain("manifestSha256");
    expect(text).toContain("compatibility-report");
    expect(text).not.toContain("releases/latest");
    expect(text).not.toContain("product-stable");
    expect(text).not.toContain("desktop-stable");
    expect(text).not.toMatch(/pnpm (build|dist|publish)|gh release (create|edit|upload)/);
  });
});
